import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @golai/domain is published as TypeScript source rather than compiled output, so
  // that the app and the server share one definition of the rules with no build step
  // between them (ADR 0009). Next has to be told to run it through its own compiler.
  transpilePackages: ["@golai/domain"],
};

export default nextConfig;
