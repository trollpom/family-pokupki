import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Netlify's OpenNext adapter consumes .next, not Vinext's Cloudflare dist/.
  // Vinext keeps using vite.config.ts and the original Worker bindings.
  webpack(config, { webpack }) {
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(
      /^cloudflare:workers$/,
      path.resolve("lib/netlify/runtime-env.ts"),
    ));
    return config;
  },
  serverExternalPackages: ["@netlify/blobs"],
};

export default nextConfig;
