import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  CargoSection,
  GoSdkLine,
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

const SCANNABLE = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".go", ".rs"]);
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
  // Go vendoring lives here too, and a vendored tree contains the SDK's own
  // source — scanning it reports the SDK's compatibility code as the project's.
  "vendor",
  // Go module and build caches, when someone points GOPATH/GOMODCACHE inside
  // the repository. Same reasoning as `.venv`.
  ".gocache",
  ".gomodcache",
]);

const SIGNAL_PATTERNS: Record<string, RegExp> = {
  initialize:
    /InitializeRequest|oninitialized|on_initialized|notifications\/initialized|["']initialize["']|["']initialized["']|\bInitializedHandler\b|\bmcp\.Initialized(?:Params|Request)\b|\.InitializeParams\(\)|\b(?:Add|On)(?:Before|After)Initialize\b/,
  sessionId:
    /[Mm]cp-[Ss]ession-[Ii]d|mcpSessionId|mcp_session_id|get_session_id|session_id_generator|stateless_http\s*=\s*False|\bsessionId\b|\bGetSessionID\s*[:=]|SessionIdManager|\bHeader(?:Key)?SessionID\b/,
  logging:
    /["']logging["']|LoggingLevel|LoggingMessageNotification|send_log_message|\b(?:ctx|context)\.(?:debug|info|warning|error|critical|log)\s*\(|\blogging\b\s*:\s*\{|\bLoggingMessageParams\b|\bNewLoggingHandler\b|\bSendLogMessageToClient\b|\bserver\.WithLogging\s*\(/,
  sampling:
    /["']sampling["']|createMessage|create_message|SamplingMessage|\bsampling\b\s*:\s*\{|\bCreateMessage(?:Params|Result|Request|Handler)\b|\b(?:EnableSampling|RequestSampling|WithSamplingHandler)\b/,
  roots:
    /["']roots["']|ListRootsRequest|RootsCapability|list_roots|\broots\b\s*:\s*\{|\bListRoots(?:Params|Result)\b|\b(?:AddRoots|RemoveRoots|RequestRoots|WithRootsHandler)\b|\bserver\.WithRoots\s*\(/,
  /**
   * Go: a streamable-HTTP server is being configured.
   *
   * Only meaningful next to `goStatelessOptIn`. The official Go SDK refuses to
   * serve `2026-07-28` over this transport unless it is stateless, so the pair
   * "HTTP transport present, stateless opt-in absent" is what MCP011 reads. A
   * stdio server matches neither and is modern on the SDK version alone.
   */
  goStreamableHttp:
    // No leading `\b`: the official constructor is `NewStreamableHTTPHandler`,
    // and a boundary before `Streamable` cannot match inside it. Requiring one
    // let the exact case this signal exists for slip through — a server that
    // passes `nil` options never names `StreamableHTTPOptions` at all, so the
    // handler call is the only thing to see.
    /StreamableHTTP(?:Handler|Options|Server)\b|\bStreamableServerTransport\b/,
  /**
   * Go: the stateless opt-in, in either SDK's spelling.
   *
   * NOT modern-era evidence on its own — `StreamableHTTPOptions.Stateless` has
   * existed since go-sdk v1.3.1, long before the revision. It is only ever read
   * as the absence-check above.
   */
  goStatelessOptIn:
    /\bStateless\s*:\s*true\b|\.Stateless\s*=\s*true\b|\bWithStateLess\s*\(|\bStatelessSessionIdManager\b/,
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
   * Deliberately narrow, and it must stay that way. The four `_meta` keys are
   * ENUMERATED rather than matched by prefix, and the difference is load
   * bearing: the *legacy* mark3labs SDK (mcp-go v0.58.0, `mcp/tasks.go`)
   * already defines `io.modelcontextprotocol/related-task`. Loosening this to
   * the bare prefix would read a legacy Go server as modern and silence MCP001
   * on it. A dependency on the v2 npm packages counts too — that line has no
   * legacy mode to be confused with.
   *
   * The Go alternatives are the exported names that appear only in the modern
   * SDKs (`MetaKeyProtocolVersion…`, `ProtocolVersion20260728`,
   * `mcp.DiscoverResult`, `subscriptions/listen`). The date literal must be
   * QUOTED — a bare `2026-07-28` in a `// TODO: migrate` comment must not
   * silence the checker. And note what is deliberately absent: no
   * `protocolVersion2026…` pattern, because go-sdk v1.6.0/v1.6.1 declare an
   * unused `protocolVersion20260630` and such a pattern would misfire on the
   * legacy line.
   *
   * For Go this regex is the smaller half of the story. A modern Go server
   * frequently spells nothing modern at all — the SDK answers `server/discover`
   * internally — so `go.mod` carries the evidence instead. See the feed in
   * `scanSource`.
   */
  modernEra:
    /io\.modelcontextprotocol\/(protocolVersion|clientCapabilities|clientInfo|serverInfo)|["']server\/discover["']|@modelcontextprotocol\/(server|client|core)\b|\bfrom\s+mcp\.server\s+import\s+[^#\n]*\bMCPServer\b|\bfrom\s+mcp\.server\.mcpserver(?:\.[A-Za-z_][\w.]*)?\s+import\b|\bMetaKey(?:ProtocolVersion|ClientInfo|ServerInfo|ClientCapabilities|SubscriptionID)\b|\bProtocolVersion20260728\b|\bmcp\.Discover(?:Params|Result)\b|["']subscriptions\/listen["']|["']2026-07-28["']/,
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

  const sdkDependencies = [
    ...(await readCargoDependencies(dir)),
    ...(await readGoModDependencies(dir, maxBytes, maxFiles)),
  ];

  // Go needs this feed more than any other ecosystem, because a modern Go
  // server usually spells nothing modern in its own source: the SDK answers
  // `server/discover` internally, and `examples/server/hello/main.go` is
  // byte-identical between go-sdk v1.6.1 and v1.7.0. Without the manifest as
  // evidence, every Go repository would be scored as though it had never
  // migrated — which is the exact failure `modernEra` exists to prevent.
  //
  // The gate is what keeps that from over-correcting. The official SDK's
  // streamable HTTP transport serves `2026-07-28` only when it is configured
  // stateless — `SupportsProtocolVersion` returns `t.Stateless && …` — so a
  // stateful HTTP server on v1.7.0 genuinely cannot serve a modern client and
  // must not be handed the counterweight. That is the case MCP011 reports, and
  // the two have to agree. A stdio server matches no HTTP signal and is modern
  // on its module version alone, which is correct: stdio does not implement
  // the version-restricting interface at all.
  const goHttpWithoutStateless =
    matches.goStreamableHttp.length > 0 && matches.goStatelessOptIn.length === 0;
  for (const dep of sdkDependencies) {
    if (dep.ecosystem !== "go" || dep.sdkLine !== "modern") continue;
    if (dep.indirect || dep.replaced) continue;
    if (goHttpWithoutStateless) continue;
    matches.modernEra.push({
      file: dep.manifest,
      line: dep.line ?? 0,
      text: `${dep.name} ${dep.constraint}`,
    });
  }

  return { matches, sdkVersion: pkg.sdkVersion, pythonSdkRequirements, filesScanned, sdkDependencies };
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
  const manifests = await collectMatchingFiles(dir, isPythonDependencyFile, maxFiles);
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

/** Crates this project recognises as MCP server frameworks. */
const MCP_CRATES = new Set(["rmcp", "rust-mcp-sdk", "tower-mcp"]);

/** Dependency sections a root manifest can declare. */
const CARGO_SECTIONS = new Set<CargoSection>([
  "dependencies",
  "dev-dependencies",
  "workspace.dependencies",
]);

/**
 * Split a section header into the dependency section it belongs to and, for the
 * sub-table form, the crate it configures.
 *
 * `[dependencies]`      -> { section: "dependencies", crate: null }
 * `[dependencies.rmcp]` -> { section: "dependencies", crate: "rmcp" }
 * `[package]`, `[target.'cfg(unix)'.dependencies]` -> null
 *
 * The last dot separates the crate, so `[workspace.dependencies.rmcp]` splits
 * correctly even though the section name itself contains one.
 */
function parseCargoSection(
  header: string,
): { section: CargoSection; crate: string | null } | null {
  const inner = header.replace(/^\[|\]$/g, "").trim();
  if (CARGO_SECTIONS.has(inner as CargoSection)) {
    return { section: inner as CargoSection, crate: null };
  }
  const dot = inner.lastIndexOf(".");
  if (dot === -1) return null;
  const section = inner.slice(0, dot).trim();
  if (!CARGO_SECTIONS.has(section as CargoSection)) return null;
  const crate = inner.slice(dot + 1).trim();
  return crate ? { section: section as CargoSection, crate } : null;
}

/** Feature flags out of a `features = ["a", "b"]` fragment. */
function parseCargoFeatures(body: string): string[] {
  const match = body.match(/features\s*=\s*\[([^\]]*)\]/);
  if (!match) return [];
  const features: string[] = [];
  for (const part of match[1].split(",")) {
    const feature = part.trim().replace(/^"|"$/g, "");
    if (feature) features.push(feature);
  }
  return features;
}

/**
 * Parse MCP-relevant crate dependencies from `Cargo.toml` content.
 *
 * Pure, line-oriented, dependency-free: no TOML crate may be added because the
 * skill bundle must stay lean. Only the three MCP framework crates are emitted;
 * `mcp-server` (stale) and `rig-core` (not an MCP framework) are skipped.
 *
 * Handled:
 * - Sections `[dependencies]`, `[dev-dependencies]`, `[workspace.dependencies]`,
 *   with whitespace inside the brackets
 * - Inline string: `rmcp = "3.1.4"`
 * - Inline table: `rmcp = { version = "3", features = ["sse"] }`, on one line or
 *   wrapped across several
 * - Sub-table: `[dependencies.rmcp]` with `version` and `features` as keys
 *
 * Ignored: any other crate name, `workspace = true`, renamed dependencies,
 * target-specific sections (`[target.*.dependencies]`), and dependencies with
 * no quoted version (e.g. `{ git = "…" }`).
 */
export function parseCargoToml(content: string): SdkDependency[] {
  const lines = content.split(/\r?\n/);
  const deps: SdkDependency[] = [];

  let section: CargoSection | null = null;
  let subTable: { crate: string; body: string } | null = null;

  const push = (crate: string, body: string, declaredIn: CargoSection) => {
    if (!MCP_CRATES.has(crate)) return;
    const version = body.match(/version\s*=\s*"([^"]*)"/);
    if (!version) return;
    const features = parseCargoFeatures(body);
    deps.push({
      ecosystem: "cargo",
      name: crate,
      constraint: version[1],
      manifest: "Cargo.toml",
      section: declaredIn,
      ...(features.length ? { features } : {}),
    });
  };

  // A sub-table stays open until the next header or the end of the file.
  const closeSubTable = () => {
    if (subTable && section) push(subTable.crate, subTable.body, section);
    subTable = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (trimmed.startsWith("[")) {
      closeSubTable();
      const parsed = parseCargoSection(trimmed);
      section = parsed ? parsed.section : null;
      if (parsed?.crate) subTable = { crate: parsed.crate, body: "" };
      continue;
    }
    if (!section) continue;
    if (subTable) {
      subTable.body += `${trimmed}\n`;
      continue;
    }

    const entry = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!entry) continue;
    const name = entry[1];
    if (!MCP_CRATES.has(name)) continue;

    let rhs = entry[2].trim();
    // An inline table may wrap across lines. Read on until it closes, but stop
    // at the next header so an unterminated table cannot swallow the file.
    if (rhs.startsWith("{") && !rhs.includes("}")) {
      while (i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (next.startsWith("[")) break;
        i++;
        rhs += ` ${next}`;
        if (next.includes("}")) break;
      }
    }

    if (rhs.startsWith("{")) {
      push(name, rhs, section);
      continue;
    }
    const inlineVersion = rhs.match(/^"([^"]*)"$/);
    if (inlineVersion) push(name, `version = "${inlineVersion[1]}"`, section);
  }

  closeSubTable();
  return deps;
}

async function readCargoDependencies(dir: string): Promise<SdkDependency[]> {
  try {
    const raw = await fs.readFile(path.join(dir, "Cargo.toml"), "utf8");
    return parseCargoToml(raw);
  } catch {
    return [];
  }
}

/**
 * Go MCP modules this project recognises, mapped to the first release that
 * speaks `2026-07-28`.
 *
 * READ THIS BEFORE CHANGING THE NUMBERS. Go did not cross the protocol break
 * the way the other SDKs did. There is no `github.com/modelcontextprotocol/
 * go-sdk/v2` — the proxy 404s it — and there never was a package rename. The
 * official SDK crossed inside its v1 line, at the v1.6.1 -> v1.7.0 *minor*.
 * A major-version threshold, which is the shape MCP007, MCP009 and MCP010 all
 * use, would therefore never fire here. That is exactly the mistake MCP007
 * made in the other direction when it recommended a `@modelcontextprotocol/sdk`
 * 2.x that has never existed, so the threshold is a full release triple.
 *
 * Verified 2026-09-03 against the module proxy and the module source:
 * go-sdk v1.6.1 `mcp/shared.go` still says `protocolVersion20251125`; v1.7.0
 * says `latestProtocolVersion = protocolVersion20260728`. mark3labs mcp-go
 * v0.58.0 says `LATEST_PROTOCOL_VERSION = "2025-11-25"`; v1.0.0 says
 * `ProtocolVersion20260728`.
 *
 * Modules deliberately absent: `metoro-io/mcp-golang`, `ThinkInAIXYZ/go-mcp`,
 * `riza-io/mcp-go`, `strowk/foxy-contexts`. None has a release speaking this
 * revision, so "upgrade" would be advice with no target — the same reasoning
 * that keeps `rig-core` out of `MCP_CRATES`.
 */
const MCP_GO_MODULES: Record<string, [number, number, number]> = {
  "github.com/modelcontextprotocol/go-sdk": [1, 7, 0],
  "github.com/mark3labs/mcp-go": [1, 0, 0],
};

/**
 * A Go pseudo-version — a synthesised version naming a commit.
 *
 * Three shapes exist and the separator before the timestamp differs between
 * them, which is easy to get wrong: `v0.0.0-20260801000000-abcdef123456` with
 * no prior tag, `v1.6.2-0.20260801000000-abcdef123456` after a release tag,
 * and `v1.7.0-pre.1.0.20260801000000-abcdef123456` after a pre-release. Hence
 * `[-.]` rather than `-`; matching only the first shape would let the other
 * two be read as ordinary releases.
 */
const GO_PSEUDO_VERSION = /[-.]\d{14}-[0-9a-f]{12}$/;

/**
 * Which protocol era a Go module requirement resolves to.
 *
 * The comparison is on the RELEASE TRIPLE, and the pre-release suffix is
 * deliberately discarded. Strict semver puts `v1.7.0-pre.1` below `v1.7.0`,
 * but that pre-release already carries `protocolVersion20260728` — it is the
 * release the announcement told people to test. Comparing triples calls it
 * modern and still calls `v1.6.0-pre.1` legacy, which is what the source says
 * of both.
 *
 * Everything that names something other than a release returns `unknown`, and
 * `unknown` produces no finding and no modern-era evidence. A pseudo-version
 * identifies a commit, not a protocol era; `+incompatible` and anything
 * unparseable say even less. Guessing here would cost a false positive, and
 * this project has already paid for one of those.
 */
export function classifyGoSdkVersion(module: string, version: string): GoSdkLine {
  const threshold = MCP_GO_MODULES[module];
  if (!threshold) return "unknown";

  const raw = version.trim();
  if (!raw || raw.endsWith("+incompatible") || GO_PSEUDO_VERSION.test(raw)) return "unknown";

  const parsed = raw.match(/^v(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
  if (!parsed) return "unknown";

  const triple = [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])];
  for (let i = 0; i < 3; i++) {
    if (triple[i] !== threshold[i]) return triple[i] < threshold[i] ? "legacy" : "modern";
  }
  return "modern";
}

/** Strip a `//` comment, reporting whether it marked the line `// indirect`. */
function stripGoComment(line: string): { text: string; indirect: boolean } {
  const at = line.indexOf("//");
  if (at === -1) return { text: line.trim(), indirect: false };
  return {
    text: line.slice(0, at).trim(),
    indirect: /(^|\s)indirect(\s|$)/.test(line.slice(at + 2)),
  };
}

/**
 * Parse MCP-relevant module requirements from `go.mod` content.
 *
 * Pure, line-oriented, dependency-free — no TOML/Go-mod parser may be added,
 * because the skill bundle has to stay lean. Same contract as
 * `parseCargoToml`: only the recognised modules are emitted.
 *
 * Handled:
 * - `require github.com/x/y v1.2.3` on one line
 * - `require ( … )` blocks, with comments and blank lines inside
 * - `// indirect`, recorded rather than dropped
 * - `replace`, in both the block and single-line forms, which marks the module
 *   `replaced` — see below
 *
 * Ignored, because none of them declares what this module builds against:
 * `exclude`, `retract`, `module`, `go`, `toolchain`.
 *
 * A `replace` is the one that would otherwise produce a confident lie. It can
 * redirect the build to a fork or a local directory whose protocol support the
 * required version says nothing about, so a replaced module is reported by
 * nothing at all rather than reported wrongly.
 */
export function parseGoMod(content: string): SdkDependency[] {
  const lines = content.split(/\r?\n/);
  const deps: SdkDependency[] = [];
  const replaced = new Set<string>();

  type GoBlock = "require" | "replace" | "exclude" | "retract";
  let block: GoBlock | null = null;

  const noteReplace = (text: string): void => {
    // `replace a => b v1.0.0` and `replace a v1.2.3 => ./local` both name the
    // replaced module first.
    const module = text.split(/\s+/)[0];
    if (module) replaced.add(module);
  };

  const noteRequire = (text: string, lineNo: number, indirect: boolean): void => {
    const entry = text.match(/^(\S+)\s+(\S+)$/);
    if (!entry) return;
    const [, name, constraint] = entry;
    if (!(name in MCP_GO_MODULES)) return;
    deps.push({
      ecosystem: "go",
      name,
      constraint,
      manifest: "go.mod",
      line: lineNo,
      sdkLine: classifyGoSdkVersion(name, constraint),
      ...(indirect ? { indirect: true } : {}),
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const { text, indirect } = stripGoComment(lines[i]);
    if (!text) continue;

    if (block) {
      if (text === ")") {
        block = null;
      } else if (block === "require") {
        noteRequire(text, i + 1, indirect);
      } else if (block === "replace") {
        noteReplace(text);
      }
      continue;
    }

    const opened = text.match(/^(require|replace|exclude|retract)\s*\($/);
    if (opened) {
      block = opened[1] as GoBlock;
      continue;
    }

    const single = text.match(/^(require|replace|exclude|retract)\s+(.*)$/);
    if (!single) continue;
    if (single[1] === "require") noteRequire(single[2].trim(), i + 1, indirect);
    else if (single[1] === "replace") noteReplace(single[2].trim());
  }

  // A `replace` anywhere in the file overrides the requirement wherever it was
  // written, so this has to be applied after the whole file has been read.
  for (const dep of deps) {
    if (!replaced.has(dep.name)) continue;
    dep.replaced = true;
    dep.sdkLine = "unknown";
  }

  return deps;
}

/**
 * Collect Go module requirements from every `go.mod` under the scan root.
 *
 * Unlike `Cargo.toml`, this walks: a Go repository routinely keeps its server
 * in a nested module, and reading only the root would miss it entirely. The
 * Python collector already walks for the same reason. `go.work` is not read —
 * see the limitation noted in the README.
 */
async function readGoModDependencies(
  dir: string,
  maxBytes: number,
  maxFiles: number,
): Promise<SdkDependency[]> {
  const manifests = await collectMatchingFiles(dir, (name) => name === "go.mod", maxFiles);
  const found: SdkDependency[] = [];
  for (const manifest of manifests) {
    const content = await readIfSmallEnough(manifest, maxBytes);
    if (content === null) continue;
    const relative = path.relative(dir, manifest);
    for (const dep of parseGoMod(content)) found.push({ ...dep, manifest: relative });
  }
  return found;
}

/**
 * Read a file, or return null if it is too large, not a regular file, or
 * unreadable.
 *
 * The handle is opened once and both stat and read go through it, so nothing
 * can be swapped underneath between the two.
 *
 * The `isFile()` check is not redundant with the walk. A FIFO reports size 0,
 * so the size guard waves it through and `readFile` then blocks until some
 * writer appears — forever, in practice. A repository containing a fifo named
 * `pipe.go` hung `mcpcheck --source`, and therefore the GitHub Action, with no
 * timeout anywhere above to break it.
 */
async function readIfSmallEnough(
  file: string,
  maxBytes: number,
): Promise<string | null> {
  let handle: import("node:fs/promises").FileHandle | undefined;
  try {
    handle = await fs.open(file, "r");
    const stat = await handle.stat();
    if (!stat.isFile()) return null;
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
      } else if (e.isFile() && SCANNABLE.has(path.extname(e.name))) {
        // `isFile()` is the guard, not `!isDirectory()`. A symlink is neither,
        // and following one leaves the tree being scanned: `escape.go ->
        // ../../secrets.env` was read and its lines reported as
        // `escape.go:2`, i.e. content from outside the repository attributed
        // to a path inside it. Sockets and FIFOs are excluded here for the
        // same reason `readIfSmallEnough` re-checks — see there.
        //
        // Symlinked *directories* are already skipped by the branch above,
        // which is what keeps the walk from looping. Do not "fix" that into
        // following them.
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out;
}

/**
 * Walk the tree for manifests whose basename `match` accepts.
 *
 * One walker for Python's several dependency files and Go's `go.mod`, because
 * three copies of the same recursion drifted apart once already — only the
 * source-file walk kept the ignore list current.
 *
 * `entry.isFile()` rather than `!entry.isDirectory()`, for the reason spelled
 * out in `collectFiles`: a symlinked `go.mod` would otherwise be read from
 * outside the tree being scanned.
 */
async function collectMatchingFiles(
  dir: string,
  match: (name: string) => boolean,
  cap: number,
): Promise<string[]> {
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
      } else if (entry.isFile() && match(entry.name)) {
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out;
}
