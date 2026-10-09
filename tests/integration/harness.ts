import {spawn, type ChildProcess} from "node:child_process";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";

/**
 * Integration harness: a REAL chain, not a mock.
 *
 * Anvil is a real EVM with real transactions, real receipts and real reverts,
 * so everything these tests assert about contract enforcement is genuine. What
 * it is NOT is Arc: the chain id differs, USDC here is a deployed 6-decimal
 * mock rather than Arc's native predeploy, and gas is paid in ETH rather than
 * USDC. Those differences are listed in the integration report rather than
 * glossed, and nothing here should be read as "verified on Arc".
 */

const ROOT = join(import.meta.dirname, "..", "..");
const ANVIL_PORT = 8545;
const ANVIL_RPC = `http://127.0.0.1:${ANVIL_PORT}`;

/** Anvil's first two deterministic accounts. Test-only, publicly known keys. */
export const OPERATOR_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
export const AGENT_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

export const LOCAL_CHAIN_ID = 31337;

export const localChain = defineChain({
  id: LOCAL_CHAIN_ID,
  name: "Anvil",
  nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
  rpcUrls: {default: {http: [ANVIL_RPC]}},
});

function artifact(path: string): {abi: unknown[]; bytecode: Hex} {
  const json = JSON.parse(readFileSync(join(ROOT, "contracts", "out", path), "utf8"));
  return {abi: json.abi, bytecode: json.bytecode.object as Hex};
}

export interface Deployment {
  anvil: ChildProcess;
  publicClient: PublicClient;
  operator: WalletClient;
  operatorAddress: Address;
  agentAddress: Address;
  usdc: Address;
  factory: Address;
  vault: Address;
  weatherRecipient: Address;
  researchRecipient: Address;
  usdcDecimals: number;
}

async function waitForRpc(timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(ANVIL_RPC, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "eth_chainId", params: []}),
      });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Anvil did not become ready on ${ANVIL_RPC}`);
}

const ERC20 = parseAbi([
  "function mint(address,uint256)",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

const VAULT = parseAbi([
  "function deposit(uint256)",
  "function createSession(address,uint128,uint128,uint64,address[])",
  "function balance() view returns (uint256)",
]);

const FACTORY = parseAbi([
  "function createVault(address,bytes32) returns (address)",
  "function vaultsOf(address) view returns (address[])",
]);

/** Spin up Anvil, deploy the system, fund it and authorise a session. */
export async function deployLocalStack(options: {
  maxPerTx: bigint;
  dailyLimit: bigint;
  funding: bigint;
  sessionSeconds: number;
}): Promise<Deployment> {
  const anvil = spawn(
    join(process.env.HOME ?? "", ".foundry", "bin", "anvil"),
    ["--port", String(ANVIL_PORT), "--silent"],
    {stdio: "ignore"},
  );
  await waitForRpc();

  const publicClient = createPublicClient({
    chain: localChain,
    transport: http(ANVIL_RPC),
  }) as PublicClient;

  const operatorAccount = privateKeyToAccount(OPERATOR_KEY);
  const agentAddress = privateKeyToAccount(AGENT_KEY).address;
  const operator = createWalletClient({
    account: operatorAccount,
    chain: localChain,
    transport: http(ANVIL_RPC),
  });

  const deploy = async (name: string, args: unknown[]): Promise<Address> => {
    const {abi, bytecode} = artifact(name);
    const hash = await operator.deployContract({
      abi: abi as never,
      bytecode,
      args: args as never,
      account: operatorAccount,
      chain: localChain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({hash});
    if (!receipt.contractAddress) throw new Error(`Deploy of ${name} produced no address`);
    return getAddress(receipt.contractAddress);
  };

  const usdc = await deploy("MockUSDC.sol/MockUSDC.json", []);
  const factory = await deploy("AgentVaultFactory.sol/AgentVaultFactory.json", [usdc]);

  // Read decimals from the token rather than assuming 6 — the system must work
  // from the token's own answer, not a hardcoded constant.
  const usdcDecimals = Number(
    await publicClient.readContract({address: usdc, abi: ERC20, functionName: "decimals"}),
  );

  const send = async (to: Address, abi: unknown, functionName: string, args: unknown[]) => {
    const hash = await operator.writeContract({
      address: to,
      abi: abi as never,
      functionName,
      args: args as never,
      account: operatorAccount,
      chain: localChain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({hash});
    if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
    return receipt;
  };

  await send(factory, FACTORY, "createVault", [operatorAccount.address, `0x${"00".repeat(32)}`]);
  const vaults = (await publicClient.readContract({
    address: factory,
    abi: FACTORY,
    functionName: "vaultsOf",
    args: [operatorAccount.address],
  })) as Address[];
  const vault = vaults[vaults.length - 1];
  if (!vault) throw new Error("factory produced no vault");

  // Operator funds the vault: mint -> approve -> deposit.
  await send(usdc, ERC20, "mint", [operatorAccount.address, options.funding]);
  await send(usdc, ERC20, "approve", [vault, options.funding]);
  await send(vault, VAULT, "deposit", [options.funding]);

  // Two distinct recipients so allowlist scoping is testable. Anvil's
  // deterministic accounts #2 and #3 — valid, checksummed, and not the agent.
  const weatherRecipient = getAddress("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
  const researchRecipient = getAddress("0x90F79bf6EB2c4f870365E785982E1f101E93b906");

  const latest = await publicClient.getBlock();
  const expiresAt = Number(latest.timestamp) + options.sessionSeconds;

  await send(vault, VAULT, "createSession", [
    agentAddress,
    options.maxPerTx,
    options.dailyLimit,
    BigInt(expiresAt),
    [weatherRecipient, researchRecipient],
  ]);

  // The agent key needs native gas to send its own transactions.
  await operator.sendTransaction({
    account: operatorAccount,
    chain: localChain,
    to: agentAddress,
    value: 10n ** 18n,
  });

  return {
    anvil,
    publicClient,
    operator,
    operatorAddress: operatorAccount.address,
    agentAddress,
    usdc,
    factory,
    vault,
    weatherRecipient,
    researchRecipient,
    usdcDecimals,
  };
}

export function teardown(d: Deployment | undefined): void {
  d?.anvil.kill("SIGKILL");
}

/** Start the real paid-service HTTP process against the local chain. */
export async function startService(
  d: Deployment,
  port: number,
  payoutAddress: Address,
): Promise<ChildProcess> {
  const proc = spawn("node", [join(ROOT, "apps", "service", "src", "index.ts")], {
    env: {
      ...process.env,
      SERVICE_PORT: String(port),
      ARC_CHAIN_ID: String(LOCAL_CHAIN_ID),
      ARC_NETWORK_NAME: "Anvil",
      ARC_RPC_URL: ANVIL_RPC,
      ARC_EXPLORER_URL: "http://localhost/explorer",
      USDC_ADDRESS: d.usdc,
      USDC_DECIMALS: String(d.usdcDecimals),
      SERVICE_PAYOUT_ADDRESS: payoutAddress,
      EXPECTED_VAULT_ADDRESS: d.vault,
      SERVICE_PRICE_USDC: "0.01",
    },
    stdio: "ignore",
  });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return proc;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill("SIGKILL");
  throw new Error(`Service did not start on port ${port}`);
}

export {ANVIL_RPC};
