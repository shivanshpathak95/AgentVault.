import {agentVaultAbi, arcChain, type ChainConfig} from "@agentvault/shared";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";

/**
 * Explicit shape rather than an inferred one: viem's client generics are not
 * portable across package boundaries (TS2742), and naming the surface here also
 * keeps the Phase-2 relayer swap honest — a signed-intent implementation has to
 * satisfy this same interface.
 */
export interface SessionSigner {
  /** The session key's address. This is the only part the model ever sees. */
  address: Address;
  publicClient: PublicClient;
  pay(token: Address, to: Address, amountBaseUnits: bigint, intentHash: Hex): Promise<Hex>;
  /** `[allowed, RejectionReason]` — the reason is the uint8 enum value. */
  preview(
    token: Address,
    to: Address,
    amountBaseUnits: bigint,
  ): Promise<readonly [boolean, number]>;
  gasBalance(): Promise<bigint>;
}

/**
 * The session signer — the agent's entire authority, in one place.
 *
 * This module holds the only secret the agent runtime possesses. That key can
 * call exactly one contract function, `pay`, and only within the policy the
 * operator signed on chain. It cannot widen a limit, add a recipient, withdraw,
 * or transfer ownership: those functions are `onlyOwner` and this is not the
 * owner.
 *
 * The key is deliberately kept behind this boundary and never enters the model's
 * context — the LLM only ever sees the session *address*. (Threat T-17.)
 *
 * PHASE 2: when signed intents land, this becomes a signer that produces an
 * EIP-712 `PaymentIntent` for a relayer to submit, and the agent stops needing
 * gas at all. Callers of `createSessionSigner` should not need to change.
 */
export function createSessionSigner(
  config: ChainConfig,
  privateKey: Hex,
  vault: Address,
): SessionSigner {
  const chain = arcChain(config);
  const account = privateKeyToAccount(privateKey);

  const publicClient: PublicClient = createPublicClient({chain, transport: http(config.rpcUrl)});
  const walletClient = createWalletClient({account, chain, transport: http(config.rpcUrl)});

  return {
    address: account.address,
    publicClient,

    /** Submit a payment. Reverts carry the policy reason; callers must decode it. */
    async pay(
      token: Address,
      to: Address,
      amountBaseUnits: bigint,
      intentHash: Hex,
    ): Promise<Hex> {
      return walletClient.writeContract({
        address: vault,
        abi: agentVaultAbi,
        functionName: "pay",
        args: [token, to, amountBaseUnits, intentHash],
      });
    },

    /** Free, read-only policy check. Never a grant of authority — `pay` re-checks. */
    async preview(token: Address, to: Address, amountBaseUnits: bigint) {
      return publicClient.readContract({
        address: vault,
        abi: agentVaultAbi,
        functionName: "previewPay",
        args: [account.address, token, to, amountBaseUnits],
      }) as Promise<readonly [boolean, number]>;
    },

    /** Native USDC held by the session key, for GAS only — not spendable value. */
    async gasBalance(): Promise<bigint> {
      return publicClient.getBalance({address: account.address});
    },
  };
}
