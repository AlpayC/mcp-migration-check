#!/usr/bin/env node
/**
 * Bundle the rule engine into the skill as `scripts/mcpcheck.mjs`.
 *
 * The skill has to run on whatever machine the agent is on, so it can't assume
 * an npm install ever happened. The bundle flattens packages/core into one
 * .mjs that only needs Node — that keeps packages/core the single source of
 * truth while the skill stays self-contained.
 */
import { resolve } from "node:path";
import { bundleEngine, repoRoot } from "./bundle-engine.mjs";

const outfile = await bundleEngine(
  resolve(repoRoot, "skill/mcp-migration/scripts/mcpcheck.mjs"),
);
console.log(`\nBundled → ${outfile}`);
