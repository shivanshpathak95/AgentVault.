import {timingSafeEqual} from "node:crypto";
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {
  addressUrl,
  formatNativeGasUsdc,
  fromBaseUnits,
  redactSecrets,
  redactUrl,
  verifyNetwork,
} from "@agentvault/shared";
import {ActivityLog} from "./activity.ts";
import {PaymentIdempotencyStore} from "./idempotency.ts";
import {QuoteLedger} from "./quotes.ts";
import {runAgent} from "./agent/loop.ts";
import type {ToolContext} from "./agent/tools.ts";
import {createSessionSigner} from "./chain/session-signer.ts";
import {loadConfig} from "./config.ts";
import {listServices, loadRegistry} from "./registry.ts";
import {createServiceClient} from "./service-client.ts";

/**
 * Agent runtime.
 *
 * Server-side only, and that is a security boundary rather than a deployment
 * detail: the session private key lives in this process and is never sent to a
 * browser, never logged, and never placed in the model's context.
 *
 *   GET  /health
 *   GET  /api/status     vault + session state
 *   GET  /api/services   the agent's configured registry
 *   GET  /api/activity   structured payment log
 *   POST /api/run        { prompt } -> transcript + final answer
 *
 * Config is validated at boot, before anything listens, so a missing variable
 * is a named crash rather than a surprise mid-payment.
 */

const config = loadConfig();
const registry = loadRegistry();
const activity = new ActivityLog();
const idempotency = new PaymentIdempotencyStore();
const quotes = new QuoteLedger();
const signer = createSessionSigner(config.chain, config.sessionPrivateKey, config.vaultAddress);
const serviceClient = createServiceClient(config.serviceBaseUrl);

// Refuse to start against the wrong chain, a token with unexpected decimals,
// or an address that is not a vault for that token.
await verifyNetwork(signer.publicClient, config.chain, config.vaultAddress);

const toolContext: ToolContext = {config, signer, registry, activity, serviceClient, idempotency, quotes};

const isLoopbackBind =
  config.host === "127.0.0.1" || config.host === "::1" || config.host === "localhost";

/** Host header (with optional port) names a loopback address. */
function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

/** Constant-time compare, so the token cannot be recovered by timing. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > 64 * 1024) throw new Error("Request body too large.");
    chunks.push(buf);
  }
  if (total === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body is not valid JSON.");
  }
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  void (async () => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // ---- Browser-origin defences -------------------------------------------
    //
    // SECURITY: binding to loopback does not stop a malicious page open in the
    // operator's own browser. Previously every response carried
    // `Access-Control-Allow-Origin: *` and the body parser ignored
    // content-type, so any website could send a no-preflight `text/plain` POST
    // to http://127.0.0.1:8787/api/run and make this process spend.
    //
    //  - CORS is granted only to configured console origins.
    //  - A browser request carrying a foreign Origin is refused outright.
    //  - Spending requests must be application/json, which forces a CORS
    //    preflight that a foreign origin cannot pass.
    //  - On loopback, the Host header must be loopback too, which defeats DNS
    //    rebinding (attacker.com resolving to 127.0.0.1).
    const origin = req.headers.origin?.replace(/\/+$/, "");
    const originAllowed = origin !== undefined && config.allowedOrigins.includes(origin);
    if (originAllowed) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("access-control-allow-headers", "content-type, authorization");
      res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    }
    res.setHeader("vary", "Origin");

    if (origin !== undefined && !originAllowed) {
      sendJson(res, 403, {error: "Origin not allowed."});
      return;
    }

    if (isLoopbackBind && !isLoopbackHost(req.headers.host)) {
      sendJson(res, 403, {error: "Host not allowed."});
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (req.method === "GET" && path === "/health") {
        sendJson(res, 200, {
          ok: true,
          chainId: config.chain.chainId,
          vault: config.vaultAddress,
          sessionKey: signer.address,
          model: config.anthropicModel,
        });
        return;
      }

      if (req.method === "GET" && path === "/api/services") {
        sendJson(res, 200, {services: listServices(registry)});
        return;
      }

      if (req.method === "GET" && path === "/api/activity") {
        const limit = Number(url.searchParams.get("limit") ?? 50);
        sendJson(res, 200, {entries: activity.list(Number.isFinite(limit) ? limit : 50)});
        return;
      }

      if (req.method === "GET" && path === "/api/status") {
        const decimals = config.chain.usdcDecimals;
        const [session, balance, remaining, paused, gas] = await Promise.all([
          signer.getSession(),
          signer.vaultBalance(),
          signer.remainingDailyAllowance(),
          signer.isPaused(),
          signer.gasBalance(),
        ]);

        sendJson(res, 200, {
          chain: {id: config.chain.chainId, name: config.chain.name},
          vault: config.vaultAddress,
          sessionKey: signer.address,
          sessionKeyExplorer: addressUrl(config.chain, signer.address),
          token: config.chain.usdcAddress,
          paused,
          sessionExists: session.exists,
          revoked: session.revoked,
          balance: fromBaseUnits(balance, decimals),
          maxPerTx: fromBaseUnits(session.maxPerTx, decimals),
          dailyLimit: fromBaseUnits(session.dailyLimit, decimals),
          dailyRemaining: fromBaseUnits(remaining, decimals),
          expiresAt: Number(session.expiresAt),
          gasBalanceNative: gas.toString(),
        });
        return;
      }

      if (req.method === "POST" && path === "/api/run") {
        // Privileged: this path signs and broadcasts payments.
        if (config.apiToken) {
          const header = req.headers.authorization ?? "";
          const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
          if (!timingSafeEqualStr(supplied, config.apiToken)) {
            sendJson(res, 401, {error: "Unauthorized."});
            return;
          }
        }
        if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
          sendJson(res, 415, {error: "Content-Type must be application/json."});
          return;
        }
        const body = await readJson(req);
        const prompt = (body as {prompt?: unknown} | null)?.prompt;
        if (typeof prompt === "string" && prompt.length > 4000) {
          sendJson(res, 413, {error: "Prompt too long (max 4000 characters)."});
          return;
        }
        if (typeof prompt !== "string" || prompt.trim() === "") {
          sendJson(res, 400, {error: 'Missing "prompt".'});
          return;
        }

        const result = await runAgent(toolContext, prompt.trim());
        sendJson(res, 200, {...result, activity: activity.list(20)});
        return;
      }

      sendJson(res, 404, {error: "Not found."});
    } catch (err) {
      // Never echo the RPC URL: hosted endpoints embed API keys in it.
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, {error: redactSecrets(message, config.chain.rpcUrl)});
    }
  })();
});

server.listen(config.port, config.host, () => {
  console.log(`agent      http://${config.host}:${config.port}`);
  console.log(
    `auth       ${config.apiToken ? "bearer token required on /api/run" : "none (loopback only)"}`,
  );
  console.log(`chain      ${config.chain.name} (${config.chain.chainId})`);
  console.log(`vault      ${config.vaultAddress}`);
  console.log(`session    ${signer.address}`);
  console.log(`model      ${config.anthropicModel}`);
  console.log(`services   ${config.serviceBaseUrl}`);
  for (const s of listServices(registry)) {
    console.log(`  ${s.id.padEnd(9)} ${s.priceUsdc} USDC -> ${s.recipient}`);
  }

  // The session key pays its own gas in native USDC. An unfunded key fails
  // every payment for a reason that has nothing to do with policy — a
  // confusing way to lose an hour during a demo.
  void signer
    .gasBalance()
    .then((bal) => {
      console.log(`gas        ${formatNativeGasUsdc(bal)}`);
      if (bal === 0n) {
        console.warn(
          `\n!  Session key holds no native USDC for gas. Every pay() will fail to submit.\n` +
            `   Send a small amount of USDC to ${signer.address} on ${config.chain.name}.\n`,
        );
      }
    })
    .catch((err: unknown) => {
      console.warn(`!  Could not read gas balance from ${redactUrl(config.chain.rpcUrl)}.`);
      void err;
    });
});
