/** @type {import('next').NextConfig} */
const nextConfig = {
  // Import the workspace core package as TypeScript source.
  transpilePackages: ["@mcpcheck/core"],
  reactStrictMode: true,
  // No custom `webpack` block on purpose. Next 16 builds with Turbopack by
  // default and fails outright if it finds one. The alias that used to live
  // here existed only to map `.js` specifiers onto `.ts` sources; packages/core
  // now uses Bundler resolution, so the specifiers are extensionless and
  // Turbopack resolves them natively.
};
export default nextConfig;

// Lets `next dev` see the Cloudflare bindings the Worker will have in
// production, so local development and the deployed runtime agree.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
