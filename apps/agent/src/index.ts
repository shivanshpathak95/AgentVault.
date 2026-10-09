import {createServer} from "node:http";
import {formatNativeGasUsdc} from "@agentvault/shared";
import {createSessionSigner} from "./chain/session-signer.ts";
import {loadConfig} from "./config.ts";

/**
 * Agent runtime entry point.
 *
 * Config is loaded and validated at boot, before anything listens, so a missing
 * or malformed variable is a named crash rather than a surprise at the moment a
 * payment is attempted.
 *
 * PHASE 4 adds: POST /run (prompt → SSE transcript), GET /status.
 */
const config = loadConfig();
const signer = createSessionSigner(config.chain, config.sessionPrivateKey, config.vaultAddress);

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, {"content-type": "application/json"});
    res.end(
      JSON.stringify({
        ok: true,
        chainId: config.chain.chainId,
        vault: config.vaultAddress,
        sessionKey: signer.address,
        model: config.anthropicModel,
      }),
    );
    return;
  }

  res.writeHead(404, {"content-type": "application/json"});
  res.end(JSON.stringify({error: "not found"}));
});

server.listen(config.port, () => {
  console.log(`agent      http://localhost:${config.port}`);
  console.log(`chain      ${config.chain.name} (${config.chain.chainId})`);
  console.log(`vault      ${config.vaultAddress}`);
  console.log(`session    ${signer.address}`);
  console.log(`model      ${config.anthropicModel}`);

  // The session key pays its own gas in native USDC. An unfunded key fails every
  // payment for a reason that has nothing to do with policy, which is a
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
