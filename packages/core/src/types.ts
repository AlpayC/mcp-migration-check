/**
 * Shared data model for the migration checker.
 *
 * The design intent: probing a live endpoint and scanning source code both
 * produce a normalized `RuleContext`. Rules never talk to the network or the
 * filesystem themselves — they only read the context. That keeps the rules
 * pure, deterministic, and trivial to unit-test.
 */

export type Severity = 'critical' | 'warning' | 'info';

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
  /** "live endpoint" or a `file:line` reference for source findings. */
  location?: string;
}

export interface Grade {
  score: number;
  letter: 'A' | 'B' | 'C' | 'D' | 'F';
}

export type CheckMode = 'live' | 'source';

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

/** Package ecosystem that declared an MCP SDK dependency. */
export type Ecosystem = 'npm' | 'cargo'; // extensible: "pypi" | "go" | "nuget"

/** A single declared MCP SDK dependency, normalized across manifest kinds. */
export interface SdkDependency {
  ecosystem: Ecosystem;
  /** Package/crate name as declared, e.g. "@modelcontextprotocol/sdk" or "rmcp". */
  name: string;
  /** Raw version constraint as written: "^1.17.0", "3", "3.1.4". */
  constraint: string;
  /** Manifest that declared it, relative to scan root — feeds Finding.location. */
  manifest: string; // "package.json" | "Cargo.toml"
  /** Cargo feature flags, when the manifest expresses them. */
  features?: string[];
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
  filesScanned: number;
  /** All MCP SDK dependencies found across every manifest kind (npm + cargo). */
  sdkDependencies?: SdkDependency[];
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
  /** Returns a Finding when the rule fires, otherwise null. */
  evaluate(ctx: RuleContext): Finding | null;
}
