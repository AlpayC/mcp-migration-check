/**
 * Shared data model for the migration checker.
 *
 * The design intent: probing a live endpoint and scanning source code both
 * produce a normalized `RuleContext`. Rules never talk to the network or the
 * filesystem themselves — they only read the context. That keeps the rules
 * pure, deterministic, and trivial to unit-test.
 */

export type Severity = "critical" | "warning" | "info";

export interface Finding {
  ruleId: string;
  title: string;
  severity: Severity;
  /** What was actually observed that triggered this finding. */
  detail: string;
  /** Concrete remediation guidance. */
  fix: string;
  /** Pointer into the canonical spec so the user can verify the rule. */
  specRef: string;
  /** Additional authoritative references (e.g. per-SDK repos). */
  references?: string[];
  /** "live endpoint" or a `file:line` reference for source findings. */
  location?: string;
}

export interface Grade {
  score: number;
  letter: "A" | "B" | "C" | "D" | "F";
}

export type CheckMode = "live" | "source";

export interface CheckResult {
  target: string;
  mode: CheckMode;
  findings: Finding[];
  grade: Grade;
  checkedAt: string;
  /** True when the target could not be inspected at all (e.g. unreachable). */
  inconclusive?: boolean;
  note?: string;
}

/**
 * Which protocol era a server serves, in the spec's own vocabulary
 * (`2026-07-28/basic/versioning#terminology`):
 *
 * - `modern`  — per-request `_meta`, no handshake. Current.
 * - `legacy`  — `initialize` handshake only. The revision left it behind.
 * - `dual`    — both. Explicitly allowed: a dual-era server "MAY serve both
 *               eras concurrently on the same endpoint", picking per request.
 *               This is a *current* server being kind to old clients, and it
 *               is not a finding.
 * - `unknown` — nothing answered in a way that identified either era.
 */
export type ServerEra = "modern" | "legacy" | "dual" | "unknown";

/** Package ecosystem that declared an MCP SDK dependency. */
export type Ecosystem = "npm" | "cargo" | "go"; // extensible: "pypi" | "nuget"

/**
 * Cargo section a dependency was declared under.
 *
 * The distinction is not cosmetic: a crate under `dev-dependencies` never ships,
 * and one under `workspace.dependencies` need not be used by any member. A
 * finding has to say which it read, or the reader cannot judge it.
 */
export type CargoSection = "dependencies" | "dev-dependencies" | "workspace.dependencies";

/**
 * Which protocol era a Go module requirement resolves to.
 *
 * `unknown` is a first-class answer, not a failure. A `replace`d module, a
 * pseudo-version and a `+incompatible` tag all name something whose protocol
 * support the version string does not describe, and the house rule is to stay
 * quiet rather than guess — see `classifyGoSdkVersion`.
 */
export type GoSdkLine = "legacy" | "modern" | "unknown";

/** A single declared MCP SDK dependency, normalized across manifest kinds. */
export interface SdkDependency {
  ecosystem: Ecosystem;
  /** Package/crate/module path as declared, e.g. "rmcp" or "github.com/mark3labs/mcp-go". */
  name: string;
  /** Raw version constraint as written: "^1.17.0", "3", "3.1.4", "v1.6.1". */
  constraint: string;
  /** Manifest that declared it, relative to scan root — feeds Finding.location. */
  manifest: string; // "package.json" | "Cargo.toml" | "go.mod"
  /** Cargo feature flags, when the manifest expresses them. */
  features?: string[];
  /** Cargo section it was declared under; absent for npm and Go. */
  section?: CargoSection;
  /** Line within `manifest`, so a Go finding can point at `go.mod:12`. */
  line?: number;
  /**
   * Go: the requirement carried `// indirect`.
   *
   * Not the same as a Cargo dev-dependency, and the difference matters. `//
   * indirect` is an assertion the toolchain maintains: no package in this
   * module imports it. So it is not this project's SDK choice, it is a
   * transitive pin — reporting it would tell a maintainer to change a line
   * that `go mod tidy` will rewrite anyway.
   */
  indirect?: boolean;
  /**
   * Go: a `replace` directive redirects this module.
   *
   * `constraint` then describes something the build does not use, so the
   * requirement is classified `unknown` and reported by nothing.
   */
  replaced?: boolean;
  /** Go: which protocol era `constraint` resolves to. Absent for npm and Cargo. */
  sdkLine?: GoSdkLine;
}

/** Normalized observations from probing a running MCP server over HTTP. */
export interface ProbeContext {
  reachable: boolean;
  /** Join of the modern and legacy probes — see `ServerEra`. */
  era: ServerEra;
  /** Versions named by `server/discover` or an UnsupportedProtocolVersionError. */
  supportedVersions: string[];
  /**
   * Whether `server/discover` answered. The revision says servers **MUST**
   * implement it. `null` means we could not tell (unreachable, or auth-walled).
   */
  discoverImplemented: boolean | null;
  /** A modern, `_meta`-carrying request was served with a modern result. */
  modernRequestsServed: boolean;
  /** Server answered the legacy `initialize` handshake. Compatibility, not drift. */
  respondsToLegacyInitialize: boolean;
  /** Protocol version echoed by the legacy handshake, when it answered. */
  legacyProtocolVersion: string | null;
  /**
   * Server minted or echoed `Mcp-Session-Id` on a *modern* request. The
   * revision says it MUST NOT: "ignore it, and do not mint or echo session
   * IDs". This is the session finding that means something.
   */
  sessionIdOnModernRequest: boolean;
  /** Session id issued for the legacy handshake only — how v1 sessions work. */
  sessionIdOnLegacyHandshake: boolean;
  /** Capabilities the server advertised, from whichever surface answered. */
  advertisedCapabilities: string[];
  /** Which surface those capabilities came from, so rules can weigh them. */
  capabilitiesEra: "modern" | "legacy" | null;
  /** Server demanded authentication (401 / WWW-Authenticate). */
  authRequired: boolean;
  /** `/.well-known/oauth-protected-resource` was served (OAuth 2.1 posture). */
  oauthResourceMetadata: boolean;
  rawError?: string;
}

export interface SourceMatch {
  file: string;
  line: number;
  text: string;
}

export type PythonSdkLine = "legacy" | "modern" | "unknown";

/** A direct dependency on the official Python SDK found in project metadata. */
export interface PythonSdkRequirement {
  /** Manifest path relative to the scanned repository. */
  file: string;
  line: number;
  /** The complete requirement as written, e.g. `mcp[cli]>=1.28,<2`. */
  requirement: string;
  /** Version portion only, e.g. `>=1.28,<2`; empty means unconstrained. */
  specifier: string;
  /** Whether the constraint can be assigned to one SDK major with confidence. */
  sdkLine: PythonSdkLine;
}

/** Normalized observations from statically scanning a repository. */
export interface SourceContext {
  /**
   * Keyed by signal name, e.g. `sessionId`, `logging`, `sampling`, `roots`.
   *
   * `modernEra` is the counterweight to the legacy signals: source that also
   * handles per-request `_meta` or implements `server/discover` is dual-era,
   * and a legacy signal beside it is compatibility rather than drift.
   */
  matches: Record<string, SourceMatch[]>;
  /** Declared `@modelcontextprotocol/sdk` version (the v1 line), or null. */
  sdkVersion: string | null;
  /** Direct `mcp` dependencies found in Python project metadata. */
  pythonSdkRequirements?: PythonSdkRequirement[];
  /**
   * MCP SDK dependencies read from `Cargo.toml` and `go.mod`; npm goes through
   * `sdkVersion` and Python through `pythonSdkRequirements`.
   */
  sdkDependencies?: SdkDependency[];
  /**
   * Every `go.mod` found under the scan root, whether or not it declares an
   * MCP module.
   *
   * Module ownership needs all of them. Deriving it from `sdkDependencies`
   * alone made a nested module that happens to declare no MCP SDK invisible,
   * and its files were then attributed to the parent module — which produced a
   * finding naming a transport in a directory the parent does not own.
   */
  goManifests?: string[];
  filesScanned: number;
}

export interface RuleContext {
  live?: ProbeContext;
  source?: SourceContext;
}

export interface Rule {
  id: string;
  title: string;
  severity: Severity;
  specRef: string;
  /** Additional authoritative references (e.g. per-SDK repos for multi-crate rules). */
  references?: string[];
  /** Returns a Finding when the rule fires, otherwise null. */
  evaluate(ctx: RuleContext): Finding | null;
}
