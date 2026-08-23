/**
 * Bundle the rule engine into a single dependency-free ESM file.
 *
 * Two artifacts ship a copy of the engine — the skill and the npm CLI — and
 * neither can assume an `npm install` for this repository ever happened on the
 * machine running it. They differ only in where the file lands, so the esbuild
 * configuration lives here once: a second copy of it is a second place for the
 * two artifacts to quietly disagree about the rules.
 */
import { build } from "esbuild";
import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Bundle `packages/core`'s CLI entry to `outfile` and make it executable. */
export async function bundleEngine(outfile) {
  await mkdir(dirname(outfile), { recursive: true });

  await build({
    entryPoints: [resolve(repoRoot, "packages/core/src/check-entry.ts")],
    outfile,
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    // No shebang in check-entry.ts — the bundler adds it here, and having both
    // would put a `#!` on line 2 of the output, which Node rejects.
    banner: { js: "#!/usr/bin/env node" },
    // packages/core uses extensionless relative specifiers (Bundler
    // resolution), so esbuild just needs to know to try `.ts` first.
    resolveExtensions: [".ts", ".js"],
    logLevel: "info",
  });

  await chmod(outfile, 0o755);
  return outfile;
}
