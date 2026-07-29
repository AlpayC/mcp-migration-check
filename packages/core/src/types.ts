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

/** Normalized observations from probing a running MCP server over HTTP. */
export interface ProbeContext {
  reachable: boolean;
  /** Server echoed an `Mcp-Session-Id` response header (pre-stateless model). */
  sessionIdHeaderPresent: boolean;
  /** Server responded to the legacy `initialize` handshake. */
  respondsToInitialize: boolean;
  /** Capabilities the server advertised in its initialize response. */
  advertisedCapabilities: string[];
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

/** Normalized observations from statically scanning a repository. */
export interface SourceContext {
  /** Keyed by signal name, e.g. `sessionId`, `logging`, `sampling`, `roots`. */
  matches: Record<string, SourceMatch[]>;
  /** Detected `@modelcontextprotocol/sdk` version, or null if not found. */
  sdkVersion: string | null;
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
  /** Returns a Finding when the rule fires, otherwise null. */
  evaluate(ctx: RuleContext): Finding | null;
}
