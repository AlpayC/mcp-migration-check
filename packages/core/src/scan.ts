import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  PythonSdkLine,
  PythonSdkRequirement,
  SdkDependency,
  SourceContext,
  SourceMatch,
} from "./types";

/**
 * Static source scan.
 *
 * Heuristic by nature: it greps source for the patterns that correlate with
 * the 2026-07-28 breaking changes. It will not catch dynamically-constructed
 * capability names, and it can over-match on comments — findings from a source
 * scan are signals to review, not proof. A live probe is more authoritative
 * for runtime behavior; the two complement each other.
 */

const SCANNABLE = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".go", ".rs", ".toml"]);
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "out",
  "build",
  // Python environments and tool caches can contain tens of thousands of
  // third-party files. Scanning them both exhausts the file cap and reports
  // the SDK's own compatibility code as if it belonged to the project.
  ".venv",
  "venv",
  "env",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  // Rust build and vendoring directories.
  "target",
  ".cargo",
  "vendor",
]);

const SIGNAL_PATTERNS: Record<string, RegExp> = {
  initialize: /InitializeRequest|oninitialized|on_initialized|ClientLifecycleMode::Initialize|notifications\/initialized|["']initialize["']|["']initialized["']/,
  sessionId:
    /[Mm]cp-[Ss]ession-[Ii]d|mcpSessionId|with_stateful_mode|stateful_mode|with_legacy_session_mode|Last-Event-ID|SseServer|sse_support|mcp_session_id|get_session_id|session_id_generator|stateless_http\s*=\s*False|\bsessionId\b/,
  logging:
    /["']logging["']|LoggingLevel|LoggingMessageNotification|send_log_message|\b(?:ctx|context)\.(?:debug|info|warning|error|critical|log)\s*\(|\blogging\b\s*:\s*\{/,
  sampling:
    /["']sampling["']|createMessage|create_message|SamplingMessage|\bsampling\b\s*:\s*\{/,
  roots:
    /["']roots["']|ListRootsRequest|RootsCapability|list_roots|\broots\b\s*:\s*\{/,
  /** The official Python SDK's v1 high-level server import. */
  pythonV1Sdk:
    /\bfrom\s+mcp\.server\.fastmcp(?:\.[A-Za-z_][\w.]*)?\s+import\b|\bimport\s+mcp\.server\.fastmcp\b/,
  /** Any official Python SDK server import; its major comes from metadata. */
  pythonServerSdk:
    /\bfrom\s+mcp\.server(?:\.[A-Za-z_]\w*)*\s+import\b|\bimport\s+mcp\.server(?:\.[A-Za-z_]\w*)*\b/,
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
    /io\.modelcontextprotocol\/(protocolVersion|clientCapabilities|clientInfo|serverInfo)|["']server\/discover["']|@modelcontextprotocol\/(server|client|core)\b|\bfrom\s+mcp\.server\s+import\s+[^#\n]*\bMCPServer\b|\bfrom\s+mcp\.server\.mcpserver(?:\.[A-Za-z_][\w.]*)?\s+import\b/,
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

  const pythonSdkRequirements = await readPythonSdkRequirements(dir, maxBytes, maxFiles);
  // Python kept one package name across the major transition, so unlike the
  // TypeScript SDK the constraint — not the name — establishes modernity.
  for (const req of pythonSdkRequirements) {
    if (req.sdkLine !== "modern") continue;
    matches.modernEra.push({
      file: req.file,
      line: req.line,
      text: req.requirement,
    });
  }

  return { matches, sdkVersion: pkg.sdkVersion, pythonSdkRequirements, filesScanned, sdkDependencies: await readCargoDependencies(dir) };
}

/**
 * Classify a Python `mcp` version constraint without pretending to be a full
 * PEP 440 / Poetry resolver.
 *
 * Only constraints that force one side of the 2.x boundary are classified.
 * `>=1.28`, `*`, URLs, and compound alternatives remain `unknown`: the
 * installed version or lockfile would be needed to say which line they use.
 */
export function classifyPythonSdkSpecifier(specifier: string): PythonSdkLine {
  const value = specifier.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  if (!value || value === "*" || value.includes("||") || /^@|^(git|https?|file):/i.test(value)) {
    return "unknown";
  }

  const singleMajor = value.match(/^(?:\^|~=|~)?\s*[vV]?(\d+)(?:\.\d+)*(?:\.\*)?(?:[a-z]+\d*)?$/i);
  if (singleMajor) return Number(singleMajor[1]) >= 2 ? "modern" : "legacy";

  const clauses = value.split(",").map((part) => part.trim()).filter(Boolean);
  for (const clause of clauses) {
    const exact = clause.match(/^(?:===|==)\s*[vV]?(\d+)(?:\.\d+)*(?:\.\*)?(?:[a-z]+\d*)?$/i);
    if (exact) return Number(exact[1]) >= 2 ? "modern" : "legacy";

    const compatible = clause.match(/^(?:~=|\^|~)\s*[vV]?(\d+)/);
    if (compatible) return Number(compatible[1]) >= 2 ? "modern" : "legacy";
  }

  // An upper bound below 2 is the most common deliberate v1 pin:
  // `mcp>=1.28,<2`. It cannot resolve to a modern SDK.
  for (const clause of clauses) {
    const upper = clause.match(/^(<|<=)\s*[vV]?(\d+)(?:\.(\d+))?/);
    if (!upper) continue;
    const major = Number(upper[2]);
    if (major < 2 || (major === 2 && upper[1] === "<" && Number(upper[3] ?? 0) === 0)) {
      return "legacy";
    }
  }

  // A lower bound at 2.x or later cannot install the legacy SDK. `>1` is not
  // enough: it still admits 1.x releases, so it intentionally stays unknown.
  for (const clause of clauses) {
    const lower = clause.match(/^>=\s*[vV]?(\d+)/);
    if (lower && Number(lower[1]) >= 2) return "modern";
  }

  return "unknown";
}

/** Parse one supported Python dependency file from already-loaded text. */
export function parsePythonSdkRequirements(
  file: string,
  content: string,
): PythonSdkRequirement[] {
  const name = path.basename(file).toLowerCase();
  if (name === "pyproject.toml") return parsePyproject(file, content);
  if (name === "pipfile") return parsePipfile(file, content);
  if (name === "setup.cfg") return parseSetupCfg(file, content);
  if (/^requirements(?:[-_.].*)?\.(?:txt|in)$/.test(name)) {
    return parseRequirementsFile(file, content);
  }
  return [];
}

function parsePyproject(file: string, content: string): PythonSdkRequirement[] {
  const found: PythonSdkRequirement[] = [];
  const lines = content.split(/\r?\n/);
  let section = "";
  let dependencyArray = false;

  for (let i = 0; i < lines.length; i++) {
    const line = stripTomlComment(lines[i]);
    const heading = line.match(/^\s*\[([^\]]+)]\s*$/);
    if (heading) {
      section = heading[1].trim().toLowerCase();
      dependencyArray = false;
      continue;
    }

    const arraySection =
      section === "project.optional-dependencies" ||
      section === "dependency-groups" ||
      section === "tool.pdm.dev-dependencies";

    if (dependencyArray) {
      addQuotedRequirements(found, file, i + 1, line);
      if (hasTomlArrayClose(line)) dependencyArray = false;
      continue;
    }

    const projectDependencies =
      section === "project" && /^\s*dependencies\s*=\s*\[/.test(line);
    const groupedDependencies = arraySection && /^\s*[^=]+\s*=\s*\[/.test(line);
    if (projectDependencies || groupedDependencies) {
      addQuotedRequirements(found, file, i + 1, line);
      dependencyArray = !hasTomlArrayClose(line);
      continue;
    }

    if (
      section === "tool.poetry.dependencies" ||
      /^tool\.poetry\.group\.[^.]+\.dependencies$/.test(section)
    ) {
      const assignment = line.match(/^\s*["']?mcp["']?\s*=\s*(.+)$/i);
      if (!assignment) continue;
      const value = assignment[1].trim();
      const tableVersion = value.match(/\bversion\s*=\s*["']([^"']+)["']/i);
      const scalarVersion = value.match(/^["']([^"']+)["']/);
      const specifier = tableVersion?.[1] ?? scalarVersion?.[1] ?? "";
      addRequirement(found, file, i + 1, `mcp${specifier}`);
    }
  }

  return found;
}

function parsePipfile(file: string, content: string): PythonSdkRequirement[] {
  const found: PythonSdkRequirement[] = [];
  const lines = content.split(/\r?\n/);
  let section = "";
  for (let i = 0; i < lines.length; i++) {
    const line = stripTomlComment(lines[i]);
    const heading = line.match(/^\s*\[([^\]]+)]\s*$/);
    if (heading) {
      section = heading[1].trim().toLowerCase();
      continue;
    }
    if (section !== "packages" && section !== "dev-packages") continue;
    const assignment = line.match(/^\s*["']?mcp["']?\s*=\s*(.+)$/i);
    if (!assignment) continue;
    const value = assignment[1].trim();
    const tableVersion = value.match(/\bversion\s*=\s*["']([^"']+)["']/i);
    const scalarVersion = value.match(/^["']([^"']+)["']/);
    const specifier = tableVersion?.[1] ?? scalarVersion?.[1] ?? "";
    addRequirement(found, file, i + 1, `mcp${specifier}`);
  }
  return found;
}

function parseSetupCfg(file: string, content: string): PythonSdkRequirement[] {
  const found: PythonSdkRequirement[] = [];
  const lines = content.split(/\r?\n/);
  let section = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+#.*$/, "");
    const heading = line.match(/^\s*\[([^\]]+)]\s*$/);
    if (heading) {
      section = heading[1].trim().toLowerCase();
      continue;
    }
    if (section !== "options" && section !== "options.extras_require") continue;
    addRequirement(found, file, i + 1, line.trim());
  }
  return found;
}

function parseRequirementsFile(file: string, content: string): PythonSdkRequirement[] {
  const found: PythonSdkRequirement[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    // A comment in a direct URL may contain `#sha256=...`; only a hash after
    // whitespace is a requirements-file comment.
    const line = lines[i].replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("-")) continue;
    addRequirement(found, file, i + 1, line);
  }
  return found;
}

function addQuotedRequirements(
  out: PythonSdkRequirement[],
  file: string,
  line: number,
  text: string,
): void {
  for (const match of text.matchAll(/(["'])(.*?)\1/g)) {
    addRequirement(out, file, line, match[2]);
  }
}

function addRequirement(
  out: PythonSdkRequirement[],
  file: string,
  line: number,
  raw: string,
): void {
  const requirement = raw.trim();
  const match = requirement.match(/^mcp(?:\s*\[[^\]]+])?\s*(.*)$/i);
  if (!match) return;

  // Do not confuse similarly named distributions such as `mcp-types` or
  // `mcp-agent` with the official SDK package.
  const remainder = match[1].trim();
  if (/^[-_.A-Za-z0-9]/.test(remainder)) return;

  const specifier = remainder.split(";", 1)[0].trim();
  out.push({
    file,
    line,
    requirement,
    specifier,
    sdkLine: classifyPythonSdkSpecifier(specifier),
  });
}

function stripTomlComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if ((char === '"' || char === "'") && line[i - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
    } else if (char === "#" && quote === null) {
      return line.slice(0, i);
    }
  }
  return line;
}

function hasTomlArrayClose(line: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if ((char === '"' || char === "'") && line[i - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
    } else if (char === "]" && quote === null) {
      return true;
    }
  }
  return false;
}

async function readPythonSdkRequirements(
  dir: string,
  maxBytes: number,
  maxFiles: number,
): Promise<PythonSdkRequirement[]> {
  const manifests = await collectPythonDependencyFiles(dir, maxFiles);
  const found: PythonSdkRequirement[] = [];
  for (const manifest of manifests) {
    const content = await readIfSmallEnough(manifest, maxBytes);
    if (content === null) continue;
    const relative = path.relative(dir, manifest);
    found.push(...parsePythonSdkRequirements(relative, content));
  }
  return found;
}

function isPythonDependencyFile(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === "pyproject.toml" ||
    lower === "pipfile" ||
    lower === "setup.cfg" ||
    /^requirements(?:[-_.].*)?\.(?:txt|in)$/.test(lower)
  );
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
 * Read MCP-relevant crate dependencies from a `Cargo.toml`.
 *
 * Dependency-free, line-oriented parse: no TOML crate may be added because the
 * skill bundle must stay lean. Only the three MCP framework crates are emitted;
 * `mcp-server` (stale) and `rig-core` (not an MCP framework) are skipped. Both
 * the inline-string form (`rmcp = "3.1.4"`) and the table form
 * (`rmcp = { version = "3", features = [...] }`) are handled. Tolerant like
 * `readSdkVersion`: a missing or unparseable manifest yields `[]`.
 */
async function readCargoDependencies(dir: string): Promise<SdkDependency[]> {
  const ALLOWED = new Set(["rmcp", "rust-mcp-sdk", "tower-mcp"]);
  try {
    const raw = await fs.readFile(path.join(dir, "Cargo.toml"), "utf8");
    const lines = raw.split(/\r?\n/);
    const deps: SdkDependency[] = [];
    let inTable = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("[")) {
        inTable =
          trimmed === "[dependencies]" ||
          trimmed === "[dev-dependencies]" ||
          trimmed === "[workspace.dependencies]";
        continue;
      }
      if (!inTable) continue;
      const m = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
      if (!m) continue;
      const name = m[1];
      if (!ALLOWED.has(name)) continue;
      const rhs = m[2].trim();
      let constraint = "";
      const features: string[] = [];
      if (rhs.startsWith("{")) {
        const v = rhs.match(/version\s*=\s*"([^"]*)"/);
        if (v) constraint = v[1];
        const f = rhs.match(/features\s*=\s*\[([^\]]*)\]/);
        if (f) {
          for (const part of f[1].split(",")) {
            const feat = part.trim().replace(/^"|"$/g, "");
            if (feat) features.push(feat);
          }
        }
      } else {
        const v = rhs.match(/^"([^"]*)"$/);
        if (v) constraint = v[1];
      }
      if (!constraint) continue;
      deps.push({
        ecosystem: "cargo",
        name,
        constraint,
        manifest: "Cargo.toml",
        ...(features.length ? { features } : {}),
      });
    }
    return deps;
  } catch {
    return [];
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

async function collectPythonDependencyFiles(dir: string, cap: number): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    if (out.length >= cap) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= cap) return;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(full);
      } else if (isPythonDependencyFile(entry.name)) {
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out;
}
