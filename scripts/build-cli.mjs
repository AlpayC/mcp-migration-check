#!/usr/bin/env node
/**
 * Bundle the rule engine into the npm package as `bin/mcpcheck.mjs`.
 *
 * `npx mcp-migration-check <url>` is the lowest-friction way to run this, and
 * that argument only holds if the download is small and installs nothing: the
 * published package is this one generated file and a README, with an empty
 * dependency tree.
 *
 * Like the skill's copy, the output is committed. Both are generated, and CI
 * fails if either has drifted from packages/core — see the `engine` job.
 */
import { resolve } from "node:path";
import { bundleEngine, repoRoot } from "./bundle-engine.mjs";

const outfile = await bundleEngine(resolve(repoRoot, "packages/cli/bin/mcpcheck.mjs"));
console.log(`\nBundled → ${outfile}`);
