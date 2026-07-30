/** @type {import('next').NextConfig} */
const nextConfig = {
  // Import the workspace core package as TypeScript source.
  transpilePackages: ["@mcpcheck/core"],
  reactStrictMode: true,
  webpack: (config) => {
    // The core package uses NodeNext-style `.js` import specifiers that point
    // at `.ts` sources. Teach the bundler to resolve them.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
};
export default nextConfig;
