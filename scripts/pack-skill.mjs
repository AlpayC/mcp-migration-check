#!/usr/bin/env node
/**
 * Zip the skill directory into `dist/mcp-migration.skill`.
 *
 * A `.skill` file is just a zip of the skill folder; Claude shows an install
 * button for that extension. Node has no zip writer in its standard library,
 * so this shells out — but which tool, and with which quirks, differs per
 * platform:
 *
 * - `zip` exists on most Linux images and is the straightforward choice.
 * - PowerShell's `Compress-Archive` refuses any extension but `.zip` and
 *   writes entry names with backslashes, which is not what the zip spec says
 *   and trips extractors on other platforms. Do not use it.
 * - `bsdtar` ships with Windows 10+ and macOS and writes spec-compliant
 *   forward slashes, but picks its format from the file extension and does not
 *   recognise `.skill` — left alone it silently produces an uncompressed tar.
 *
 * So: `zip` when present, otherwise `bsdtar` writing a `.zip` that is renamed
 * afterwards. Both paths are verified below rather than trusted.
 */
import { execFileSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = resolve(root, "skill");
const outDir = resolve(root, "dist");
const out = resolve(outDir, "mcp-migration.skill");

mkdirSync(outDir, { recursive: true });
rmSync(out, { force: true });

function has(cmd) {
  try {
    execFileSync(cmd, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (has("zip")) {
  execFileSync("zip", ["-r", "-q", out, "mcp-migration"], {
    cwd: skillRoot,
    stdio: "inherit",
  });
} else if (has("tar")) {
  const zip = `${out}.zip`;
  rmSync(zip, { force: true });
  execFileSync(
    "tar",
    ["-a", "-c", "-f", zip, "-C", skillRoot, "mcp-migration"],
    { stdio: "inherit" },
  );
  renameSync(zip, out);
} else {
  console.error("Neither `zip` nor `tar` is available - cannot build the .skill file.");
  process.exit(1);
}

/*
 * Both archivers pick their format from the file extension, and both have
 * silently produced the wrong one during development. Check the result rather
 * than the exit code: a `.skill` that is not a zip fails at install time, far
 * away from this script and with a much worse error message.
 */
const fd = openSync(out, "r");
const magic = Buffer.alloc(4);
readSync(fd, magic, 0, 4, 0);
closeSync(fd);

const isZip = magic[0] === 0x50 && magic[1] === 0x4b;
if (!isZip) {
  console.error(
    `${out} is not a zip archive (magic bytes ${magic.toString("hex")}). Refusing to ship it.`,
  );
  process.exit(1);
}

console.log(`Packed -> ${out}`);
