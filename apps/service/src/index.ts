import {createServer} from "node:http";
import {
  ConfigError,
  parseChainConfig,
  requiredAddress,
  toBaseUnits,
  type ChainConfig,
} from "@agentvault/shared";
import type {Address} from "viem";

/**
 * The paid demo service.
 *
 * A deliberately independent third party: it trusts neither the agent nor the
 * operator console, and settles invoices only against on-chain events it reads
 * itself (see verify.ts).
 *
 * PHASE 4 adds the two routes:
 *   GET  /report            → 402 { invoiceId, priceUsdc, payTo }
 *   POST /report/redeem     → verify txHash on chain, then deliver
 */

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new ConfigError(`Missing required environment variable ${name}. See .env.example.`);
  return v;
}

interface ServiceConfig {
  port: number;
  chain: ChainConfig;
  payoutAddress: Address;
  priceBaseUnits: bigint;
  priceDisplay: string;
  expectedVault: Address;
}

const config: ServiceConfig = (() => {
  const chain = parseChainConfig({
    chainId: process.env.ARC_CHAIN_ID,
    name: process.env.NEXT_PUBLIC_ARC_NETWORK_NAME ?? "Arc",
    rpcUrl: process.env.ARC_RPC_URL,
    wsUrl: process.env.NEXT_PUBLIC_ARC_WS_URL,
    explorerUrl: process.env.NEXT_PUBLIC_ARC_EXPLORER_URL,
    usdcAddress: process.env.USDC_ADDRESS ?? process.env.NEXT_PUBLIC_USDC_ADDRESS,
    usdcDecimals: process.env.NEXT_PUBLIC_USDC_DECIMALS ?? "6",
  });

  const priceDisplay = required("SERVICE_PRICE_USDC");

  return {
    port: Number(process.env.SERVICE_PORT ?? 8788),
    chain,
    payoutAddress: requiredAddress(process.env.SERVICE_PAYOUT_ADDRESS, "SERVICE_PAYOUT_ADDRESS"),
    // Parsed through the shared helper so the service and the vault can never
    // disagree about what "12.50" means.
    priceBaseUnits: toBaseUnits(priceDisplay, chain.usdcDecimals),
    priceDisplay,
    expectedVault: requiredAddress(process.env.EXPECTED_VAULT_ADDRESS, "EXPECTED_VAULT_ADDRESS"),
  };
})();

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, {"content-type": "application/json"});
    res.end(
      JSON.stringify({
        ok: true,
        price: config.priceDisplay,
        payTo: config.payoutAddress,
        chainId: config.chain.chainId,
      }),
    );
    return;
  }

  res.writeHead(404, {"content-type": "application/json"});
  res.end(JSON.stringify({error: "not found"}));
});

server.listen(config.port, () => {
  console.log(`service    http://localhost:${config.port}`);
  console.log(`price      ${config.priceDisplay} USDC`);
  console.log(`payTo      ${config.payoutAddress}`);
  console.log(`vault      ${config.expectedVault}`);
  console.log(
    `\n   Reminder: ${config.payoutAddress} must be on the session's on-chain\n` +
      `   recipient allowlist, or every payment to it is refused by design.\n`,
  );
});
