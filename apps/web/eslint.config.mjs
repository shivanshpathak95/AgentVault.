import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

/**
 * ESLint flat config.
 *
 * `next lint` was removed in Next 16, so the project runs ESLint directly.
 * eslint-config-next 16 ships native flat configs, so no eslintrc compat shim
 * is needed.
 */
export default [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "eslint.config.mjs"],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
];
