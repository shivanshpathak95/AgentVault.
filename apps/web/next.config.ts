import type {NextConfig} from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @agentvault/shared ships TypeScript source rather than a build step, which
  // keeps the monorepo's inner loop fast during a short build.
  transpilePackages: ["@agentvault/shared"],
};

export default nextConfig;
