#!/usr/bin/env node
/**
 * Copy ABIs out of Foundry's build artifacts into packages/shared/src/abi.
 *
 * Hand-maintained ABIs drift from the contract, and in this project a drifted
 * ABI means the UI and the agent disagree with the enforcement layer about what
 * a policy is. Generating them removes that whole class of bug.
 *
 *   pnpm contracts:build && pnpm abi:sync
 */
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "packages", "shared", "src", "abi");

/** [artifact path relative to contracts/out, exported const name, output file] */
const TARGETS = [
  ["AgentVault.sol/AgentVault.json", "agentVaultAbi", "agentVault.ts"],
  ["AgentVaultFactory.sol/AgentVaultFactory.json", "agentVaultFactoryAbi", "agentVaultFactory.ts"],
  ["IERC20.sol/IERC20.json", "erc20Abi", "erc20.ts"],
];

mkdirSync(outDir, {recursive: true});

let wrote = 0;
for (const [artifact, exportName, file] of TARGETS) {
  const artifactPath = join(root, "contracts", "out", artifact);

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch (err) {
    console.error(
      `! could not read ${artifact} — run \`pnpm contracts:build\` first.\n  ${err.message}`,
    );
    process.exitCode = 1;
    continue;
  }

  const banner =
    `// GENERATED FILE — do not edit.\n` +
    `// Source: contracts/out/${artifact}\n` +
    `// Regenerate: pnpm contracts:build && pnpm abi:sync\n\n`;

  const body =
    `export const ${exportName} = ${JSON.stringify(parsed.abi, null, 2)} as const;\n`;

  writeFileSync(join(outDir, file), banner + body);
  console.log(`  ${file}  (${parsed.abi.length} entries)`);
  wrote++;
}

if (wrote === TARGETS.length) {
  // Explicit .ts extensions — the package is consumed as source, not built.
  const index = TARGETS.map(([, , file]) => `export * from "./${file}";`)
    .sort()
    .join("\n");
  writeFileSync(
    join(outDir, "index.ts"),
    `// GENERATED FILE — do not edit. Regenerate: pnpm abi:sync\n\n${index}\n`,
  );
  console.log(`ABIs synced to packages/shared/src/abi`);
}
