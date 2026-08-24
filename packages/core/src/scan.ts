import { promises as fs } from "node:fs";
import path from "node:path";
import type { SourceContext, SourceMatch } from "./types";

/**
 * Static source scan.
 *
 * Heuristic by nature: it greps source for the patterns that correlate with
 * the 2026-07-28 breaking changes. It will not catch dynamically-constructed
 * capability names, and it can over-match on comments — findings from a source
 * scan are signals to review, not proof. A live probe is more authoritative
 * for runtime behavior; the two complement each other.
 */

const SCANNABLE = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".go"]);
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", ".next", "out", "build"]);

const SIGNAL_PATTERNS: Record<string, RegExp> = {
  initialize: /InitializeRequest|oninitialized|["']initialize["']|["']initialized["']/,
  sessionId: /[Mm]cp-[Ss]ession-[Ii]d|mcpSessionId|\bsessionId\b/,
  logging: /["']logging["']|LoggingLevel|\blogging\b\s*:\s*\{/,
  sampling: /["']sampling["']|createMessage|SamplingMessage|\bsampling\b\s*:\s*\{/,
  roots: /["']roots["']|ListRootsRequest|RootsCapability|\broots\b\s*:\s*\{/,
  /**
   * Evidence that the repository speaks the current revision.
   *
   * This is the signal that keeps a legacy match from being read as drift. A
   * server can support both eras, and the ones that do are usually the
   * well-maintained ones — without something to weigh against `initialize`,
   * every dual-era codebase grades as if it had never migrated.
   *
   * Deliberately narrow: the `io.modelcontextprotocol/` prefix and
   * `server/discover` only exist in `2026-07-28`, so a match is hard evidence.
   * A dependency on the v2 SDK packages counts too — that line has no legacy
   * mode to be confused with.
   */
  modernEra:
    /io\.modelcontextprotocol\/(protocolVersion|clientCapabilities|clientInfo|serverInfo)|["']server\/discover["']|@modelcontextprotocol\/(server|client|core)\b/,
};

export interface ScanOptions {
  maxFiles?: number;
  maxBytesPerFile?: number;
}

export async function scanSource(
  dir: string,
  opts: ScanOptions = {},
): Promise<SourceContext> {
  const maxFiles = opts.maxFiles ?? 5000;
  const maxBytes = opts.maxBytesPerFile ?? 1_000_000;

  const matches: Record<string, SourceMatch[]> = {};
  for (const key of Object.keys(SIGNAL_PATTERNS)) matches[key] = [];

  let filesScanned = 0;
  const files = await collectFiles(dir, maxFiles);

  for (const file of files) {
    // Size check and read go through one file handle rather than stat-then-open.
    // Two separate paths are a time-of-check/time-of-use race: the file that
    // gets read need not be the file that was measured.
    const content = await readIfSmallEnough(file, maxBytes);
    if (content === null) continue;
    filesScanned++;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const [signal, re] of Object.entries(SIGNAL_PATTERNS)) {
        if (re.test(line)) {
          matches[signal].push({
            file: path.relative(dir, file),
            line: i + 1,
            text: line.trim().slice(0, 200),
          });
        }
      }
    }
  }

  const pkg = await readPackageJson(dir);
  // A dependency on the v2 packages is modern-era evidence even when no source
  // line matched — a freshly generated server may not spell any of the `_meta`
  // keys out literally.
  for (const name of pkg.modernPackages) {
    matches.modernEra.push({ file: "package.json", line: 0, text: name });
  }

  return { matches, sdkVersion: pkg.sdkVersion, filesScanned };
}

/** v2 ships under these names; none of them has a legacy mode. */
const MODERN_PACKAGES = [
  "@modelcontextprotocol/server",
  "@modelcontextprotocol/client",
  "@modelcontextprotocol/core",
];

/**
 * Read what `package.json` says about which SDK line this project is on.
 *
 * `@modelcontextprotocol/sdk` *is* the v1 line — it tops out at 1.30.0 and
 * speaks the pre-2026-07-28 protocol. The v2 SDK ships under different names
 * entirely, so the presence of a dependency is the signal, not the number
 * after it — in both directions.
 */
async function readPackageJson(
  dir: string,
): Promise<{ sdkVersion: string | null; modernPackages: string[] }> {
  try {
    const raw = await fs.readFile(path.join(dir, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    const deps = { ...pkg.devDependencies, ...pkg.dependencies };
    const dep = deps["@modelcontextprotocol/sdk"];
    return {
      sdkVersion: typeof dep === "string" ? dep : null,
      modernPackages: MODERN_PACKAGES.filter((name) => typeof deps[name] === "string"),
    };
  } catch {
    return { sdkVersion: null, modernPackages: [] };
  }
}

/**
 * Read a file, or return null if it is too large or unreadable.
 *
 * The handle is opened once and both stat and read go through it, so nothing
 * can be swapped underneath between the two.
 */
async function readIfSmallEnough(
  file: string,
  maxBytes: number,
): Promise<string | null> {
  let handle: import("node:fs/promises").FileHandle | undefined;
  try {
    handle = await fs.open(file, "r");
    const stat = await handle.stat();
    if (stat.size > maxBytes) return null;
    return await handle.readFile("utf8");
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function collectFiles(dir: string, cap: number): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    if (out.length >= cap) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= cap) return;
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) continue;
        await walk(full);
      } else if (SCANNABLE.has(path.extname(e.name))) {
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out;
}
