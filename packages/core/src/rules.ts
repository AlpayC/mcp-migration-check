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
 * COMPATIBILITY IS NOT DRIFT. The first version of MCP001 fired on any server
 * that answered `initialize` and told its maintainer to delete the handshake.
 * That was wrong twice over: the revision explicitly permits a dual-era server
 * ("A server that wishes to support both legacy clients … and modern clients
 * MAY implement both behaviors"), and following the advice would have broken
 * every v1 client still pointed at that endpoint. The rules below therefore
 * score the *pair* of observations — does the modern surface work, and is the
 * legacy one still there — and only the absence of the modern surface is a
 * defect. Rules in the MCP1xx range are observations that carry no penalty;
 * they exist so a report can say "still accepts legacy" without implying
 * "only accepts legacy".
 *
 * Rules are intentionally data-first so adding, removing, or re-scoring one is
 * a small local edit — see the `rules` array at the bottom.
 */

const SPEC_BASE = "https://modelcontextprotocol.io/specification/2026-07-28";

/** Verified spec locations, keyed by the topic each rule cites. */
const SPEC = {
  versioning: `${SPEC_BASE}/basic/versioning`,
  discover: `${SPEC_BASE}/server/discover`,
  transport: `${SPEC_BASE}/basic/transports/streamable-http`,
  logging: `${SPEC_BASE}/server/utilities/logging`,
  sampling: `${SPEC_BASE}/client/sampling`,
  roots: `${SPEC_BASE}/client/roots`,
  authorization: `${SPEC_BASE}/basic/authorization`,
  // The spec site has no SDK section — SDK releases are announced separately.
  // This is the document that states which SDK line speaks which revision.
  sdk: "https://blog.modelcontextprotocol.io/posts/sdk-betas-2026-07-28/",
  pythonSdk: "https://py.sdk.modelcontextprotocol.io/migration/",
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
  [SPEC.transport]: "2026-08-23",
  [SPEC.logging]: "2026-08-01",
  [SPEC.sampling]: "2026-08-01",
  [SPEC.roots]: "2026-08-01",
  [SPEC.authorization]: "2026-08-01",
  // Read in full when the dual-era rewrite landed.
  [SPEC.versioning]: "2026-08-23",
  [SPEC.discover]: "2026-08-23",
  // Checked against npm the following day, when the rename turned up.
  [SPEC.sdk]: "2026-08-02",
  // Official v1-to-v2 guide: package constraint, import, and class rename.
  [SPEC.pythonSdk]: "2026-08-27",
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

/**
 * Does this target show any sign of serving the current revision?
 *
 * Live: the probe reached the modern surface. Source: the repository handles
 * per-request `_meta` or implements `server/discover`. A static scan cannot
 * prove a server works, but finding the modern machinery is enough to stop
 * calling the legacy path a defect — which is the failure this guards against.
 */
function servesModern(ctx: RuleContext): boolean {
  if (ctx.live && (ctx.live.era === "modern" || ctx.live.era === "dual")) return true;
  return (ctx.source?.matches.modernEra?.length ?? 0) > 0;
}

/**
 * The `supportedVersions` clause, or an empty string.
 *
 * Parenthetical, not a sentence: it is spliced into the middle of one, and an
 * earlier version ended it with a full stop — which read as
 * "…the current revision It names 2026-07-28 as supported. and also answers…"
 * against a real server.
 */
function versionsClause(ctx: RuleContext): string {
  const v = ctx.live?.supportedVersions ?? [];
  return v.length > 0 ? ` (naming ${v.join(", ")} as supported)` : "";
}

export const rules: Rule[] = [
  {
    id: "MCP001",
    title: "Legacy-only: the current revision is not served",
    severity: "critical",
    specRef: SPEC.versioning,
    evaluate(ctx): Finding | null {
      if (servesModern(ctx)) return null;

      const live = ctx.live?.respondsToLegacyInitialize;
      const v1PythonApi = firstMatch(ctx, "pythonV1Sdk");
      const v1PythonRequirement = ctx.source?.pythonSdkRequirements?.some(
        (candidate) => candidate.sdkLine === "legacy",
      );
      const constrainedPythonServer = v1PythonRequirement
        ? firstMatch(ctx, "pythonServerSdk")
        : undefined;
      const legacyPythonServer = v1PythonApi ?? constrainedPythonServer;
      const src = firstMatch(ctx, "initialize") ?? legacyPythonServer;
      if (!live && !src) return null;

      const negotiated = ctx.live?.legacyProtocolVersion;
      return {
        ruleId: "MCP001",
        title: "Legacy-only: the current revision is not served",
        severity: "critical",
        detail: live
          ? `The server answered the legacy \`initialize\` handshake${
              negotiated ? ` (negotiating ${negotiated})` : ""
            } and showed no sign of the modern surface: \`server/discover\` did not answer, and a request carrying per-request \`_meta\` was not served as one. A modern client cannot talk to it at all.`
          : legacyPythonServer && src === legacyPythonServer
            ? v1PythonApi
              ? "Source imports the official Python SDK's v1-only `mcp.server.fastmcp` server API and shows no modern SDK or protocol surface. That server line cannot serve a 2026-07-28 client."
              : "Source imports the official Python server SDK while project metadata constrains `mcp` to 1.x, and it shows no modern protocol surface. That server cannot serve a 2026-07-28 client."
            : "Source implements the `initialize` lifecycle and nothing that handles the modern per-request `_meta` envelope or `server/discover`. As written, this server serves legacy clients only.",
        fix:
          legacyPythonServer && src === legacyPythonServer
            ? "Upgrade the official Python `mcp` dependency to 2.x and migrate `FastMCP` to `MCPServer`. Python SDK v2 serves the modern revision and legacy clients concurrently; do not delete backwards compatibility by hand."
            : "Add the modern path — do not remove the legacy one. Serve requests carrying `io.modelcontextprotocol/protocolVersion` in `_meta` statelessly, and implement `server/discover`. A dual-era server MAY keep answering `initialize` on the same endpoint; that is how v1 clients keep working, and deleting the handshake would break every one of them.",
        specRef: SPEC.versioning,
        location: live ? "live endpoint" : loc(src),
      };
    },
  },
  {
    id: "MCP002",
    title: "Session state on the modern surface",
    severity: "critical",
    specRef: SPEC.transport,
    evaluate(ctx): Finding | null {
      // Live: only a session id minted for a *modern* request is a violation.
      // One issued by the legacy handshake is how the legacy revision works,
      // and MCP102 records it without penalty.
      const live = ctx.live?.sessionIdOnModernRequest;

      // Source: a session-id reference is a hazard only if this is not already
      // a dual-era server. If the modern path is there, the session machinery
      // belongs to the legacy path and static analysis cannot say more.
      const src = servesModern(ctx) ? undefined : firstMatch(ctx, "sessionId");
      if (!live && !src) return null;

      return {
        ruleId: "MCP002",
        title: "Session state on the modern surface",
        severity: "critical",
        detail: live
          ? "The server issued an `Mcp-Session-Id` header in response to a modern, `_meta`-carrying request. Protocol-level sessions are gone in this revision; a server serving it must ignore the header and neither mint nor echo session IDs."
          : "Source relies on `Mcp-Session-Id` / session state and shows no modern per-request handling beside it. This is the classic hazard: in-memory state that silently breaks once requests no longer hit one instance.",
        fix: "Keep session handling scoped to the legacy path if you serve one, and make the modern path stateless. Servers that need cross-call state mint explicit handles and take them back as ordinary tool arguments.",
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
    evaluate: capabilityRule({
      id: "MCP003",
      capability: "logging",
      title: "Deprecated logging capability",
      specRef: SPEC.logging,
      fix: "Remove the logging capability and its handlers. Log to stderr on stdio transports, or use OpenTelemetry for observability.",
      sourceDetail: "Source registers the deprecated `logging` capability.",
    }),
  },
  {
    id: "MCP004",
    title: "Deprecated sampling capability",
    severity: "warning",
    specRef: SPEC.sampling,
    evaluate: capabilityRule({
      id: "MCP004",
      capability: "sampling",
      title: "Deprecated sampling capability",
      specRef: SPEC.sampling,
      fix: "Remove reliance on server-initiated sampling. Integrate directly with an LLM provider API, or return the raw material and let the client decide whether a model call is needed.",
      sourceDetail:
        "Source references the deprecated `sampling` capability (createMessage/create_message).",
    }),
  },
  {
    id: "MCP005",
    title: "Deprecated roots capability",
    severity: "warning",
    specRef: SPEC.roots,
    evaluate: capabilityRule({
      id: "MCP005",
      capability: "roots",
      title: "Deprecated roots capability",
      specRef: SPEC.roots,
      fix: "Remove the roots capability. Pass directories or files via tool parameters, resource URIs, or server configuration instead.",
      sourceDetail: "Source references the deprecated `roots` capability.",
    }),
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
        fix: "There is no single v2 package to move to — pick by role. A server needs @modelcontextprotocol/server; a client needs @modelcontextprotocol/client; something that is both needs both. Add @modelcontextprotocol/core either way, plus the express/fastify/hono adapter for your HTTP layer. Then run `npx @modelcontextprotocol/codemod@latest v1-to-v2 .` on a clean working tree for the mechanical renames and fix what it leaves behind. Note v2 requires Zod 4.",
        specRef: SPEC.sdk,
        location: "package.json",
      };
    },
  },
  {
    id: "MCP008",
    title: "`server/discover` not implemented",
    severity: "warning",
    specRef: SPEC.discover,
    evaluate(ctx): Finding | null {
      const live = ctx.live;
      // Only askable of a server that demonstrably serves the modern era: a
      // legacy-only server missing `server/discover` is MCP001, not this.
      if (!live || live.discoverImplemented !== false) return null;
      if (live.era !== "modern" && live.era !== "dual") return null;
      return {
        ruleId: "MCP008",
        title: "`server/discover` not implemented",
        severity: "warning",
        detail:
          "The server served a modern request but answered `server/discover` with no result. The revision says servers **MUST** implement it, and it is the probe clients use to pick a protocol version before sending anything else.",
        fix: "Implement `server/discover`, returning `supportedVersions`, `capabilities` and `_meta['io.modelcontextprotocol/serverInfo']`.",
        specRef: SPEC.discover,
        location: "live endpoint",
      };
    },
  },
  {
    id: "MCP009",
    title: "Python SDK still on the v1 line",
    severity: "warning",
    specRef: SPEC.pythonSdk,
    evaluate(ctx): Finding | null {
      const requirement = ctx.source?.pythonSdkRequirements?.find(
        (candidate) => candidate.sdkLine === "legacy",
      );
      const legacyApi = firstMatch(ctx, "pythonV1Sdk");
      if (!requirement && !legacyApi) return null;

      const requirementDetail = requirement
        ? `${requirement.file} declares \`${requirement.requirement}\`, a constraint that can only install the 1.x maintenance line.`
        : null;
      const apiDetail = legacyApi
        ? "Source imports `mcp.server.fastmcp`, the v1 high-level server API (`FastMCP`)."
        : null;

      return {
        ruleId: "MCP009",
        title: "Python SDK still on the v1 line",
        severity: "warning",
        detail: [requirementDetail, apiDetail, "Python SDK v2 is the current line and implements the 2026-07-28 protocol revision."]
          .filter(Boolean)
          .join(" "),
        fix: "Move the official `mcp` dependency to 2.x (for example `mcp>=2,<3`) and follow the Python SDK migration guide. For a high-level server, replace `from mcp.server.fastmcp import FastMCP` with `from mcp.server import MCPServer`, then migrate the remaining v2 API changes and run the server's tests.",
        specRef: SPEC.pythonSdk,
        location: requirement
          ? `${requirement.file}:${requirement.line}`
          : loc(legacyApi),
      };
    },
  },

  // ---- Observations (MCP1xx) ----------------------------------------------
  // These carry `info` severity, which costs no points. They exist because a
  // report that cannot distinguish "still accepts legacy" from "only accepts
  // legacy" reports the first as if it were the second.
  {
    id: "MCP101",
    title: "Dual-era: still accepts the legacy handshake",
    severity: "info",
    specRef: SPEC.versioning,
    evaluate(ctx): Finding | null {
      if (ctx.live?.era !== "dual") return null;
      return {
        ruleId: "MCP101",
        title: "Dual-era: still accepts the legacy handshake",
        severity: "info",
        detail: `The server serves the current revision${versionsClause(
          ctx,
        )} and also answers the legacy \`initialize\` handshake${
          ctx.live.legacyProtocolVersion
            ? ` (negotiating ${ctx.live.legacyProtocolVersion})`
            : ""
        }. That is a supported configuration, not drift: a dual-era server picks its semantics from how each client opens.`,
        fix: "Nothing to do. Keep the legacy path while clients in the wild still send `initialize`, and retire it on your own schedule.",
        specRef: SPEC.versioning,
        location: "live endpoint",
      };
    },
  },
  {
    id: "MCP102",
    title: "Session ids issued to legacy clients only",
    severity: "info",
    specRef: SPEC.transport,
    evaluate(ctx): Finding | null {
      const live = ctx.live;
      if (!live?.sessionIdOnLegacyHandshake) return null;
      if (live.sessionIdOnModernRequest) return null; // MCP002 has it
      if (live.era !== "dual") return null;
      return {
        ruleId: "MCP102",
        title: "Session ids issued to legacy clients only",
        severity: "info",
        detail:
          "`Mcp-Session-Id` came back from the legacy handshake but not from a modern request. That is the legacy revision working as specified; the modern surface stayed stateless.",
        fix: "Nothing to do, as long as no modern-path behaviour depends on that session. Retire it with the legacy path.",
        specRef: SPEC.transport,
        location: "live endpoint",
      };
    },
  },
];

/**
 * The three deprecated-capability rules differ only in strings.
 *
 * The one piece of logic they share is worth stating once: a capability seen
 * only in the legacy handshake of a dual-era server is being offered to legacy
 * clients, and the deprecated features "remain fully functional during the
 * deprecation window". Charging a maintained server a warning for that is the
 * same mistake MCP001 used to make, so it is recorded as an observation.
 */
function capabilityRule(spec: {
  id: string;
  capability: string;
  title: string;
  specRef: string;
  fix: string;
  sourceDetail: string;
}): (ctx: RuleContext) => Finding | null {
  return (ctx) => {
    const live = ctx.live?.advertisedCapabilities.includes(spec.capability);
    const src = firstMatch(ctx, spec.capability);
    if (!live && !src) return null;

    const legacyOnly =
      live === true && ctx.live?.capabilitiesEra === "legacy" && ctx.live.era === "dual";

    return {
      ruleId: spec.id,
      title: spec.title,
      severity: legacyOnly ? "info" : "warning",
      detail: live
        ? legacyOnly
          ? `The server advertises the deprecated \`${spec.capability}\` capability in its legacy handshake only. Deprecated features stay functional through the deprecation window, so this is what a dual-era server offering v1 clients what they expect looks like.`
          : `The server advertises the deprecated \`${spec.capability}\` capability.`
        : spec.sourceDetail,
      fix: legacyOnly
        ? `Nothing urgent. Drop \`${spec.capability}\` when you retire the legacy path — new implementations should not adopt it.`
        : spec.fix,
      specRef: spec.specRef,
      location: live ? "live endpoint" : loc(src),
    };
  };
}
