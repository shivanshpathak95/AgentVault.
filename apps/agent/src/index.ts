import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {addressUrl, formatNativeGasUsdc, fromBaseUnits} from "@agentvault/shared";
import {ActivityLog} from "./activity.ts";
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
const signer = createSessionSigner(config.chain, config.sessionPrivateKey, config.vaultAddress);
const serviceClient = createServiceClient(config.serviceBaseUrl);

const toolContext: ToolContext = {config, signer, registry, activity, serviceClient};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
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

    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
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
        const body = await readJson(req);
        const prompt = (body as {prompt?: unknown} | null)?.prompt;
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
      sendJson(res, 500, {error: err instanceof Error ? err.message : String(err)});
    }
  })();
});

server.listen(config.port, () => {
  console.log(`agent      http://localhost:${config.port}`);
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
      console.warn(`!  Could not read gas balance from ${config.chain.rpcUrl}:`, err);
    });
});
