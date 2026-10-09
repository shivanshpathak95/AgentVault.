/**
 * @agentvault/shared
 *
 * The contract between the enforcement layer (Solidity), the operator console
 * (Next.js), the agent runtime (Node) and the paid service (Node).
 *
 * Anything three codebases must agree on lives here: the policy types, the
 * rejection reasons, USDC decimal handling, chain configuration, and the
 * generated ABIs. Three layers independently deciding what `maxPerTx` means is
 * exactly the bug class this project exists to eliminate.
 *
 * Shipped as TypeScript source rather than a build artifact — hence the explicit
 * .ts extensions below. See tsconfig.base.json.
 */

export * from "./types.ts";
export * from "./usdc.ts";
export * from "./env.ts";
export * from "./chain.ts";
export * from "./services.ts";
export * from "./revert.ts";
export * from "./abi/index.ts";
