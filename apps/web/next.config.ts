import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@tokenomics/tco-core", "@tokenomics/pricing-data"],
  serverExternalPackages: ["yaml", "@aws-sdk/client-pricing"],
};

export default nextConfig;
