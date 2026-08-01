#!/usr/bin/env node
/**
 * Bundle the rule engine into the skill as a single dependency-free ESM file.
 *
 * The skill has to run on whatever machine the agent is on, so it can't assume
 * an npm install ever happened. esbuild flattens packages/core into one .mjs
 * that only needs Node — that keeps packages/core the single source of truth
 * while the skill stays self-contained.
 */
import { build } from "esbuild";
import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(root, "skill/mcp-migration/scripts/mcpcheck.mjs");

await mkdir(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(root, "packages/core/src/check-entry.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  banner: { js: "#!/usr/bin/env node" },
  // packages/core uses extensionless relative specifiers (Bundler resolution),
  // so esbuild just needs to know to try `.ts` first.
  resolveExtensions: [".ts", ".js"],
  logLevel: "info",
});

await chmod(outfile, 0o755);
console.log(`\nBundled → ${outfile}`);
