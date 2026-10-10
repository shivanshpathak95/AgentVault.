import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {
  SERVICE_CATALOG,
  SERVICE_IDS,
  arcChain,
  redactSecrets,
  verifyNetwork,
  fromBaseUnits,
  isServiceId,
  toBaseUnits,
  type ServiceId,
  type ServiceQuote,
  type ServiceResult,
} from "@agentvault/shared";
import {createPublicClient, http as viemHttp, type Hex, type PublicClient} from "viem";
import {loadConfig} from "./config.ts";
import {execute} from "./handlers.ts";
import {optionalString, readJson, requireString, sendJson} from "./http.ts";
import {InvoiceStore} from "./invoices.ts";
import {verifyPayment} from "./verify.ts";

/**
 * The paid demo services — Weather (0.01 USDC) and Research (0.02 USDC).
 *
 * These are a deliberately independent third party. They trust neither the
 * agent nor the operator console: the only thing they believe is a settled
 * `PaymentExecuted` event they read from the chain themselves. An agent that
 * lies about having paid gets nothing.
 *
 * Flow per request:
 *
 *   POST /api/services/:id/quote   { param }              -> 402 + invoice
 *   (agent pays through the vault)
 *   POST /api/services/:id/invoke  { invoiceId, txHash }  -> verify -> result
 */

const config = loadConfig();
const invoices = new InvoiceStore();

const publicClient: PublicClient = createPublicClient({
  chain: arcChain(config.chain),
  transport: viemHttp(config.chain.rpcUrl),
});

// Refuse to start against the wrong chain, token or vault.
await verifyNetwork(publicClient, config.chain, config.expectedVault);

function catalogResponse() {
  return {
    payTo: config.payoutAddress,
    token: config.chain.usdcAddress,
    chainId: config.chain.chainId,
    services: SERVICE_IDS.map((id) => SERVICE_CATALOG[id]),
  };
}

async function handleQuote(
  res: ServerResponse,
  serviceId: ServiceId,
  body: unknown,
): Promise<void> {
  const descriptor = SERVICE_CATALOG[serviceId];
  const param = optionalString(body, descriptor.parameter.name) ?? optionalString(body, "param");

  if (!param) {
    sendJson(res, 400, {
      error: `Missing "${descriptor.parameter.name}". ${descriptor.parameter.description}`,
    });
    return;
  }

  invoices.prune();
  const invoice = invoices.issue(
    serviceId,
    param,
    descriptor.priceUsdc,
    toBaseUnits(descriptor.priceUsdc, config.chain.usdcDecimals),
  );

  const quote: ServiceQuote = {
    invoiceId: invoice.invoiceId,
    serviceId,
    priceUsdc: invoice.priceUsdc,
    token: config.chain.usdcAddress,
    payTo: config.payoutAddress,
    intentHash: invoice.intentHash,
    expiresAt: invoice.expiresAt,
  };

  // 402 Payment Required is the honest status code: the request is understood
  // and well-formed, it simply has not been paid for yet.
  sendJson(res, 402, quote);
}

async function handleInvoke(
  res: ServerResponse,
  serviceId: ServiceId,
  body: unknown,
): Promise<void> {
  let invoiceId: string;
  let txHash: string;
  try {
    invoiceId = requireString(body, "invoiceId");
    txHash = requireString(body, "txHash");
  } catch (err) {
    sendJson(res, 400, {error: err instanceof Error ? err.message : String(err)});
    return;
  }

  const invoice = invoices.get(invoiceId);
  if (!invoice) {
    sendJson(res, 404, {error: "Unknown or expired invoice. Request a new quote."});
    return;
  }
  if (invoice.serviceId !== serviceId) {
    sendJson(res, 400, {error: "This invoice was issued for a different service."});
    return;
  }
  if (invoice.redeemedTxHash) {
    sendJson(res, 409, {
      error: "This invoice has already been settled. One payment buys one result.",
      settledBy: invoice.redeemedTxHash,
    });
    return;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    sendJson(res, 400, {error: "txHash must be a 0x-prefixed 32-byte hash."});
    return;
  }
  if (invoices.isTxUsed(txHash as Hex)) {
    sendJson(res, 409, {error: "That transaction has already settled another invoice."});
    return;
  }

  // The actual gate. Everything above is bookkeeping; this is what makes the
  // service safe to run against an untrusted agent.
  let verification;
  try {
    verification = await verifyPayment(publicClient, {
      txHash: txHash as Hex,
      invoiceId: invoice.invoiceId,
      expectedChainId: config.chain.chainId,
      expectedVault: config.expectedVault,
      expectedToken: config.chain.usdcAddress,
      expectedRecipient: config.payoutAddress,
      expectedMinAmount: invoice.priceBaseUnits,
      expectedIntentHash: invoice.intentHash,
    });
  } catch (err) {
    // A verification that could not complete is not a verification that passed.
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 502, {
      error: `Could not verify payment on chain: ${redactSecrets(message, config.chain.rpcUrl)}`,
    });
    return;
  }

  if (!verification.ok) {
    sendJson(res, 402, {error: `Payment not accepted: ${verification.reason}`});
    return;
  }

  // Claim the invoice before doing the work, so two concurrent requests with
  // the same receipt cannot both be served.
  if (!invoices.redeem(invoice.invoiceId, txHash as Hex)) {
    sendJson(res, 409, {error: "This invoice was settled by a concurrent request."});
    return;
  }

  const result: ServiceResult = {
    serviceId,
    invoiceId: invoice.invoiceId,
    paidTxHash: txHash as Hex,
    paidUsdc: fromBaseUnits(verification.amount, config.chain.usdcDecimals),
    data: execute(serviceId, invoice.param),
  };

  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      event: "service.delivered",
      serviceId,
      invoiceId: invoice.invoiceId,
      txHash,
      paidUsdc: result.paidUsdc,
      payer: verification.payer,
    }),
  );

  sendJson(res, 200, result);
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  void (async () => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    try {
      if (req.method === "GET" && path === "/health") {
        sendJson(res, 200, {ok: true, chainId: config.chain.chainId, invoices: invoices.size});
        return;
      }

      if (req.method === "GET" && path === "/api/services") {
        sendJson(res, 200, catalogResponse());
        return;
      }

      const match = /^\/api\/services\/([a-z]+)\/(quote|invoke)$/.exec(path);
      if (req.method === "POST" && match) {
        const [, rawId, action] = match;
        if (!rawId || !isServiceId(rawId)) {
          sendJson(res, 404, {error: `Unknown service "${rawId}".`});
          return;
        }
        const body = await readJson(req);
        if (action === "quote") await handleQuote(res, rawId, body);
        else await handleInvoke(res, rawId, body);
        return;
      }

      sendJson(res, 404, {error: "Not found."});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, {error: redactSecrets(message, config.chain.rpcUrl)});
    }
  })();
});

server.listen(config.port, () => {
  console.log(`service    http://localhost:${config.port}`);
  console.log(`chain      ${config.chain.name} (${config.chain.chainId})`);
  console.log(`payTo      ${config.payoutAddress}`);
  console.log(`vault      ${config.expectedVault}`);
  for (const id of SERVICE_IDS) {
    console.log(`  ${id.padEnd(9)} ${SERVICE_CATALOG[id].priceUsdc} USDC`);
  }
  console.log(
    `\n   ${config.payoutAddress} must be on the session's on-chain recipient\n` +
      `   allowlist, or every payment to it is refused by design.\n`,
  );
});
