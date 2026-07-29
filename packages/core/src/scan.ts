import { promises as fs } from "node:fs";
import path from "node:path";
import type { SourceContext, SourceMatch } from "./types.js";

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
    let content: string;
    try {
      const stat = await fs.stat(file);
      if (stat.size > maxBytes) continue;
      content = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
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

  const sdkVersion = await readSdkVersion(dir);
  return { matches, sdkVersion, filesScanned };
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

async function readSdkVersion(dir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(dir, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    const dep =
      pkg.dependencies?.["@modelcontextprotocol/sdk"] ??
      pkg.devDependencies?.["@modelcontextprotocol/sdk"];
    return typeof dep === "string" ? dep : null;
  } catch {
    return null;
  }
}
