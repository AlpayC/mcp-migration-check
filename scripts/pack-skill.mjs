#!/usr/bin/env node
/**
 * Zip the skill directory into `dist/mcp-migration.skill`.
 *
 * A `.skill` file is just a zip of the skill folder; Claude shows an install
 * button for that extension. Written with Node's own zip-less approach via
 * `zlib` would be fiddly, so this shells out to whatever archiver exists —
 * `zip` on macOS/Linux, PowerShell's Compress-Archive on Windows.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = resolve(root, "skill/mcp-migration");
const outDir = resolve(root, "dist");
const out = resolve(outDir, "mcp-migration.skill");

mkdirSync(outDir, { recursive: true });
rmSync(out, { force: true });

const isWindows = process.platform === "win32";

if (isWindows) {
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${skillDir}' -DestinationPath '${out}' -Force`,
    ],
    { stdio: "inherit" },
  );
} else {
  execFileSync("zip", ["-r", "-q", out, "mcp-migration"], {
    cwd: resolve(root, "skill"),
    stdio: "inherit",
  });
}

console.log(`Packed → ${out}`);
