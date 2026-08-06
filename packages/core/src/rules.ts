import type { Finding, Rule, RuleContext, SourceMatch } from "./types";

/**
 * Rules for the MCP 2026-07-28 specification break.
 *
 * NOTE ON ACCURACY: each rule cites the spec page it derives from, and every
 * one of these URLs was verified to resolve. The spec is split across
 * subpages, not anchors on a single document — an earlier version of this file
 * pointed at `#lifecycle`, `#transport` and friends, which silently landed on
 * the overview page. If you add a rule, open the URL before committing it.
 *
 * Rules are intentionally data-first so adding, removing, or re-scoring one is
 * a small local edit — see the `rules` array at the bottom.
 */

const SPEC_BASE = "https://modelcontextprotocol.io/specification/2026-07-28";

/** Verified spec locations, keyed by the topic each rule cites. */
const SPEC = {
  changelog: `${SPEC_BASE}/changelog`,
  transport: `${SPEC_BASE}/basic/transports/streamable-http`,
  logging: `${SPEC_BASE}/server/utilities/logging`,
  sampling: `${SPEC_BASE}/client/sampling`,
  roots: `${SPEC_BASE}/client/roots`,
  authorization: `${SPEC_BASE}/basic/authorization`,
  // The spec site has no SDK section — SDK releases are announced separately.
  // This is the document that states which SDK line speaks which revision.
  sdk: "https://blog.modelcontextprotocol.io/posts/sdk-betas-2026-07-28/",
} as const;

/**
 * When each citation was last read and confirmed by hand.
 *
 * Two kinds of claim live in this file and they age differently. "The transport
 * removed Mcp-Session-Id" is anchored to a dated revision and does not rot.
 * "The sdk package has no 2.x" is a statement about a registry at a moment in
 * time, and it will be wrong eventually — quietly, which is exactly how the
 * original MCP007 came to recommend a version that never existed.
 *
 * So the report says when it last checked rather than implying it just did.
 * scripts/verify-spec-links.mjs re-reads every page on a schedule; this is the
 * date a human last looked.
 */
export const SPEC_VERIFIED_AT: Record<string, string> = {
  [SPEC.changelog]: "2026-08-01",
  [SPEC.transport]: "2026-08-01",
  [SPEC.logging]: "2026-08-01",
  [SPEC.sampling]: "2026-08-01",
  [SPEC.roots]: "2026-08-01",
  [SPEC.authorization]: "2026-08-01",
  // Checked against npm the following day, when the rename turned up.
  [SPEC.sdk]: "2026-08-02",
};

/** The oldest citation date — what a report should quote, not the newest. */
export const rulesVerifiedAt = Object.values(SPEC_VERIFIED_AT).sort()[0];

/** Pick the first source match for a signal, if any, for location reporting. */
function firstMatch(ctx: RuleContext, signal: string): SourceMatch | undefined {
  return ctx.source?.matches[signal]?.[0];
}

function loc(match?: SourceMatch): string | undefined {
  return match ? `${match.file}:${match.line}` : undefined;
}

export const rules: Rule[] = [
  {
    id: "MCP001",
    title: "Legacy initialize handshake",
    severity: "critical",
    specRef: SPEC.changelog,
    evaluate(ctx): Finding | null {
      const live = ctx.live?.respondsToInitialize;
      const src = firstMatch(ctx, "initialize");
      if (!live && !src) return null;
      return {
        ruleId: "MCP001",
        title: "Legacy initialize handshake",
        severity: "critical",
        detail: live
          ? "The server responded to the legacy `initialize` handshake. The 2026-07-28 model is stateless and does not use the session-establishing handshake."
          : "Source references the `initialize` lifecycle, which the stateless model removes.",
        fix: "Remove the initialize/initialized handshake. Treat each request as self-contained; move any per-session setup into request-scoped context.",
        specRef: SPEC.changelog,
        location: live ? "live endpoint" : loc(src),
      };
    },
  },
  {
    id: "MCP002",
    title: "Session-id dependence",
    severity: "critical",
    specRef: SPEC.transport,
    evaluate(ctx): Finding | null {
      const live = ctx.live?.sessionIdHeaderPresent;
      const src = firstMatch(ctx, "sessionId");
      if (!live && !src) return null;
      return {
        ruleId: "MCP002",
        title: "Session-id dependence",
        severity: "critical",
        detail: live
          ? "The server issued an `Mcp-Session-Id` header. Sessions are gone in the stateless model; sticky state tied to a session id will break behind a load balancer."
          : "Source relies on `Mcp-Session-Id` / session state. This is the classic hazard: in-memory state that silently breaks once requests no longer hit one instance.",
        fix: "Remove session-id routing. Servers that need cross-call state mint explicit handles and take them back as ordinary tool arguments; otherwise make handlers fully stateless.",
        specRef: SPEC.transport,
        location: live ? "live endpoint" : loc(src),
      };
    },
  },
  {
    id: "MCP003",
    title: "Deprecated logging capability",
    severity: "warning",
    specRef: SPEC.logging,
    evaluate(ctx): Finding | null {
      const live = ctx.live?.advertisedCapabilities.includes("logging");
      const src = firstMatch(ctx, "logging");
      if (!live && !src) return null;
      return {
        ruleId: "MCP003",
        title: "Deprecated logging capability",
        severity: "warning",
        detail: live
          ? "The server advertises the deprecated `logging` capability."
          : "Source registers the deprecated `logging` capability.",
        fix: "Remove the logging capability and its handlers. Log to stderr on stdio transports, or use OpenTelemetry for observability.",
        specRef: SPEC.logging,
        location: live ? "live endpoint" : loc(src),
      };
    },
  },
  {
    id: "MCP004",
    title: "Deprecated sampling capability",
    severity: "warning",
    specRef: SPEC.sampling,
    evaluate(ctx): Finding | null {
      const live = ctx.live?.advertisedCapabilities.includes("sampling");
      const src = firstMatch(ctx, "sampling");
      if (!live && !src) return null;
      return {
        ruleId: "MCP004",
        title: "Deprecated sampling capability",
        severity: "warning",
        detail: live
          ? "The server advertises/uses the deprecated `sampling` capability."
          : "Source references the deprecated `sampling` capability (createMessage).",
        fix: "Remove reliance on server-initiated sampling. Integrate directly with an LLM provider API, or return the raw material and let the client decide whether a model call is needed.",
        specRef: SPEC.sampling,
        location: live ? "live endpoint" : loc(src),
      };
    },
  },
  {
    id: "MCP005",
    title: "Deprecated roots capability",
    severity: "warning",
    specRef: SPEC.roots,
    evaluate(ctx): Finding | null {
      const live = ctx.live?.advertisedCapabilities.includes("roots");
      const src = firstMatch(ctx, "roots");
      if (!live && !src) return null;
      return {
        ruleId: "MCP005",
        title: "Deprecated roots capability",
        severity: "warning",
        detail: live
          ? "The server advertises/uses the deprecated `roots` capability."
          : "Source references the deprecated `roots` capability.",
        fix: "Remove the roots capability. Pass directories or files via tool parameters, resource URIs, or server configuration instead.",
        specRef: SPEC.roots,
        location: live ? "live endpoint" : loc(src),
      };
    },
  },
  {
    id: "MCP006",
    title: "Missing OAuth 2.1 resource-server posture",
    severity: "critical",
    specRef: SPEC.authorization,
    evaluate(ctx): Finding | null {
      // Only meaningful for a live, auth-guarded endpoint.
      if (!ctx.live?.reachable) return null;
      if (!ctx.live.authRequired) return null;
      if (ctx.live.oauthResourceMetadata) return null;
      return {
        ruleId: "MCP006",
        title: "Missing OAuth 2.1 resource-server posture",
        severity: "critical",
        detail:
          "The endpoint requires auth but serves no OAuth protected-resource metadata — neither at the origin root nor at the RFC 9728 path-suffixed location. The 2026-07-28 spec formalizes OAuth 2.1 for remote servers.",
        fix: "Expose protected-resource metadata and validate the token issuer/audience as an OAuth 2.1 resource server.",
        specRef: SPEC.authorization,
        location: "live endpoint",
      };
    },
  },
  {
    id: "MCP007",
    title: "TypeScript SDK still on the v1 line",
    severity: "warning",
    specRef: SPEC.sdk,
    evaluate(ctx): Finding | null {
      const v = ctx.source?.sdkVersion;
      if (!v) return null;
      // Defensive: `@modelcontextprotocol/sdk` has never published a 2.x and
      // the v2 line moved to other package names, but if that ever changes,
      // don't flag it.
      const major = Number.parseInt(v.replace(/^[^\d]*/, "").split(".")[0] ?? "", 10);
      if (major >= 2) return null;
      return {
        ruleId: "MCP007",
        title: "TypeScript SDK still on the v1 line",
        severity: "warning",
        detail: `package.json depends on @modelcontextprotocol/sdk (${v}). That package is the v1 line — it stops at 1.30.0 and speaks the pre-2026-07-28 protocol. v2 shipped under new names instead: @modelcontextprotocol/server and @modelcontextprotocol/client.`,
        fix: "Migrate to @modelcontextprotocol/server / @modelcontextprotocol/client v2 (with @modelcontextprotocol/core, and the express/fastify/hono adapter you need). Run `npx @modelcontextprotocol/codemod@latest v1-to-v2 .` on a clean working tree for the mechanical renames, then fix what it leaves behind.",
        specRef: SPEC.sdk,
        location: "package.json",
      };
    },
  },
];
