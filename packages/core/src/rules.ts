import type { Finding, Rule, RuleContext, SourceMatch } from "./types.js";

/**
 * Rules for the MCP 2026-07-28 specification break.
 *
 * NOTE ON ACCURACY: each rule cites the spec section it derives from. The
 * 2026-07-28 revision is recent; before relying on these in anger, verify the
 * cited sections against the canonical spec at
 * https://modelcontextprotocol.io/specification/2026-07-28. Rules are
 * intentionally data-first so adding, removing, or re-scoring one is a small
 * local edit — see the `rules` array at the bottom.
 */

const SPEC_BASE = "https://modelcontextprotocol.io/specification/2026-07-28";

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
    specRef: `${SPEC_BASE}#lifecycle`,
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
        specRef: `${SPEC_BASE}#lifecycle`,
        location: live ? "live endpoint" : loc(src),
      };
    },
  },
  {
    id: "MCP002",
    title: "Session-id dependence",
    severity: "critical",
    specRef: `${SPEC_BASE}#transport`,
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
        fix: "Remove session-id routing. Persist any needed state in an external store keyed by an explicit identifier, or make handlers fully stateless.",
        specRef: `${SPEC_BASE}#transport`,
        location: live ? "live endpoint" : loc(src),
      };
    },
  },
  {
    id: "MCP003",
    title: "Deprecated logging capability",
    severity: "warning",
    specRef: `${SPEC_BASE}#server-features`,
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
        fix: "Remove the logging capability and its handlers. Emit diagnostics through your own transport/side channel instead.",
        specRef: `${SPEC_BASE}#server-features`,
        location: live ? "live endpoint" : loc(src),
      };
    },
  },
  {
    id: "MCP004",
    title: "Deprecated sampling capability",
    severity: "warning",
    specRef: `${SPEC_BASE}#client-features`,
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
        fix: "Remove reliance on server-initiated sampling. Restructure the flow so the client owns model calls.",
        specRef: `${SPEC_BASE}#client-features`,
        location: live ? "live endpoint" : loc(src),
      };
    },
  },
  {
    id: "MCP005",
    title: "Deprecated roots capability",
    severity: "warning",
    specRef: `${SPEC_BASE}#client-features`,
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
        fix: "Remove the roots capability. Pass any needed path/scoping context explicitly in tool inputs.",
        specRef: `${SPEC_BASE}#client-features`,
        location: live ? "live endpoint" : loc(src),
      };
    },
  },
  {
    id: "MCP006",
    title: "Missing OAuth 2.1 resource-server posture",
    severity: "critical",
    specRef: `${SPEC_BASE}#authorization`,
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
          "The endpoint requires auth but does not serve `/.well-known/oauth-protected-resource`. The 2026-07-28 spec formalizes OAuth 2.1 for remote servers.",
        fix: "Expose protected-resource metadata and validate the token issuer/audience as an OAuth 2.1 resource server.",
        specRef: `${SPEC_BASE}#authorization`,
        location: "live endpoint",
      };
    },
  },
  {
    id: "MCP007",
    title: "Pre-2.0 SDK pin",
    severity: "warning",
    specRef: `${SPEC_BASE}#sdk`,
    evaluate(ctx): Finding | null {
      const v = ctx.source?.sdkVersion;
      if (!v) return null;
      const major = Number.parseInt(v.replace(/^[^\d]*/, "").split(".")[0] ?? "", 10);
      if (Number.isNaN(major) || major >= 2) return null;
      return {
        ruleId: "MCP007",
        title: "Pre-2.0 SDK pin",
        severity: "warning",
        detail: `@modelcontextprotocol/sdk is pinned to ${v}. The stateless model and new lifecycle require the 2.x SDK line.`,
        fix: "Upgrade to @modelcontextprotocol/sdk ^2. Run the official v1→v2 codemod for the mechanical renames, then re-check.",
        specRef: `${SPEC_BASE}#sdk`,
        location: "package.json",
      };
    },
  },
];
