#!/usr/bin/env node

// packages/core/src/rules.ts
var SPEC_BASE = "https://modelcontextprotocol.io/specification/2026-07-28";
var SPEC = {
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
  // The official Rust SDK (rmcp) lives in its own repo, not the blog post
  // above — that one covers only Python/TS/Go/C#. Verified 2026-08-22.
  rustSdk: "https://github.com/modelcontextprotocol/rust-sdk",
  rustSdkReleases: "https://github.com/modelcontextprotocol/rust-sdk/releases",
  // Per-SDK authoritative references for MCP010 multi-crate coverage.
  towerMcp: "https://github.com/joshrotenberg/tower-mcp",
  rustMcpSdk: "https://github.com/rust-mcp-stack/rust-mcp-sdk",
  // Go's own story is not on the spec site either. The SDK announcement is the
  // document that states both halves of it: which release speaks the revision,
  // and that serving it over HTTP is a separate opt-in.
  goSdk: "https://pkg.go.dev/github.com/modelcontextprotocol/go-sdk@v1.7.0/mcp",
  markThreeLabsMcpGo: "https://pkg.go.dev/github.com/mark3labs/mcp-go@v1.0.0/mcp"
};
var SPEC_VERIFIED_AT = {
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
  // Verified by hand against the rust-sdk repo README (2026-08-22).
  [SPEC.rustSdk]: "2026-08-22",
  [SPEC.rustSdkReleases]: "2026-08-28",
  [SPEC.towerMcp]: "2026-08-28",
  [SPEC.rustMcpSdk]: "2026-08-28",
  // Read against the module proxy and the module source on the same day: the
  // package pages are version-pinned, so they cannot drift the way a moving
  // `@latest` page would.
  [SPEC.goSdk]: "2026-09-03",
  [SPEC.markThreeLabsMcpGo]: "2026-09-03"
};
var rulesVerifiedAt = Object.values(SPEC_VERIFIED_AT).sort()[0];
function firstMatch(ctx, signal) {
  return ctx.source?.matches[signal]?.[0];
}
function loc(match) {
  return match ? `${match.file}:${match.line}` : void 0;
}
function servesModern(ctx) {
  if (ctx.live && (ctx.live.era === "modern" || ctx.live.era === "dual")) return true;
  return (ctx.source?.matches.modernEra?.length ?? 0) > 0;
}
function versionsClause(ctx) {
  const v = ctx.live?.supportedVersions ?? [];
  return v.length > 0 ? ` (naming ${v.join(", ")} as supported)` : "";
}
var rules = [
  {
    id: "MCP001",
    title: "Legacy-only: the current revision is not served",
    severity: "critical",
    specRef: SPEC.versioning,
    evaluate(ctx) {
      if (servesModern(ctx)) return null;
      const live = ctx.live?.respondsToLegacyInitialize;
      const v1PythonApi = firstMatch(ctx, "pythonV1Sdk");
      const v1PythonRequirement = ctx.source?.pythonSdkRequirements?.some(
        (candidate) => candidate.sdkLine === "legacy"
      );
      const constrainedPythonServer = v1PythonRequirement ? firstMatch(ctx, "pythonServerSdk") : void 0;
      const legacyPythonServer = v1PythonApi ?? constrainedPythonServer;
      const src = firstMatch(ctx, "initialize") ?? legacyPythonServer;
      if (!live && !src) return null;
      const negotiated = ctx.live?.legacyProtocolVersion;
      return {
        ruleId: "MCP001",
        title: "Legacy-only: the current revision is not served",
        severity: "critical",
        detail: live ? `The server answered the legacy \`initialize\` handshake${negotiated ? ` (negotiating ${negotiated})` : ""} and showed no sign of the modern surface: \`server/discover\` did not answer, and a request carrying per-request \`_meta\` was not served as one. A modern client cannot talk to it at all.` : legacyPythonServer && src === legacyPythonServer ? v1PythonApi ? "Source imports the official Python SDK's v1-only `mcp.server.fastmcp` server API and shows no modern SDK or protocol surface. That server line cannot serve a 2026-07-28 client." : "Source imports the official Python server SDK while project metadata constrains `mcp` to 1.x, and it shows no modern protocol surface. That server cannot serve a 2026-07-28 client." : "Source implements the `initialize` lifecycle and nothing that handles the modern per-request `_meta` envelope or `server/discover`. As written, this server serves legacy clients only.",
        fix: legacyPythonServer && src === legacyPythonServer ? "Upgrade the official Python `mcp` dependency to 2.x and migrate `FastMCP` to `MCPServer`. Python SDK v2 serves the modern revision and legacy clients concurrently; do not delete backwards compatibility by hand." : "Add the modern path \u2014 do not remove the legacy one. Serve requests carrying `io.modelcontextprotocol/protocolVersion` in `_meta` statelessly, and implement `server/discover`. A dual-era server MAY keep answering `initialize` on the same endpoint; that is how v1 clients keep working, and deleting the handshake would break every one of them.",
        specRef: SPEC.versioning,
        location: live ? "live endpoint" : loc(src)
      };
    }
  },
  {
    id: "MCP002",
    title: "Session state on the modern surface",
    severity: "critical",
    specRef: SPEC.transport,
    evaluate(ctx) {
      const live = ctx.live?.sessionIdOnModernRequest;
      const src = servesModern(ctx) ? void 0 : firstMatch(ctx, "sessionId");
      if (!live && !src) return null;
      return {
        ruleId: "MCP002",
        title: "Session state on the modern surface",
        severity: "critical",
        detail: live ? "The server issued an `Mcp-Session-Id` header in response to a modern, `_meta`-carrying request. Protocol-level sessions are gone in this revision; a server serving it must ignore the header and neither mint nor echo session IDs." : "Source relies on `Mcp-Session-Id` / session state and shows no modern per-request handling beside it. This is the classic hazard: in-memory state that silently breaks once requests no longer hit one instance.",
        fix: "Keep session handling scoped to the legacy path if you serve one, and make the modern path stateless. Servers that need cross-call state mint explicit handles and take them back as ordinary tool arguments.",
        specRef: SPEC.transport,
        location: live ? "live endpoint" : loc(src)
      };
    }
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
      sourceDetail: "Source registers the deprecated `logging` capability."
    })
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
      sourceDetail: "Source references the deprecated `sampling` capability (createMessage/create_message)."
    })
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
      sourceDetail: "Source references the deprecated `roots` capability."
    })
  },
  {
    id: "MCP006",
    title: "Missing OAuth 2.1 resource-server posture",
    severity: "critical",
    specRef: SPEC.authorization,
    evaluate(ctx) {
      if (!ctx.live?.reachable) return null;
      if (!ctx.live.authRequired) return null;
      if (ctx.live.oauthResourceMetadata) return null;
      return {
        ruleId: "MCP006",
        title: "Missing OAuth 2.1 resource-server posture",
        severity: "critical",
        detail: "The endpoint requires auth but serves no OAuth protected-resource metadata \u2014 neither at the origin root nor at the RFC 9728 path-suffixed location. The 2026-07-28 spec formalizes OAuth 2.1 for remote servers.",
        fix: "Expose protected-resource metadata and validate the token issuer/audience as an OAuth 2.1 resource server.",
        specRef: SPEC.authorization,
        location: "live endpoint"
      };
    }
  },
  {
    id: "MCP007",
    title: "TypeScript SDK still on the v1 line",
    severity: "warning",
    specRef: SPEC.sdk,
    evaluate(ctx) {
      const v = ctx.source?.sdkVersion;
      if (!v) return null;
      const major = Number.parseInt(v.replace(/^[^\d]*/, "").split(".")[0] ?? "", 10);
      if (major >= 2) return null;
      return {
        ruleId: "MCP007",
        title: "TypeScript SDK still on the v1 line",
        severity: "warning",
        detail: `package.json depends on @modelcontextprotocol/sdk (${v}). That package is the v1 line \u2014 it stops at 1.30.0 and speaks the pre-2026-07-28 protocol. v2 shipped under new names instead: @modelcontextprotocol/server and @modelcontextprotocol/client.`,
        fix: "There is no single v2 package to move to \u2014 pick by role. A server needs @modelcontextprotocol/server; a client needs @modelcontextprotocol/client; something that is both needs both. Add @modelcontextprotocol/core either way, plus the express/fastify/hono adapter for your HTTP layer. Then run `npx @modelcontextprotocol/codemod@latest v1-to-v2 .` on a clean working tree for the mechanical renames and fix what it leaves behind. Note v2 requires Zod 4.",
        specRef: SPEC.sdk,
        location: "package.json"
      };
    }
  },
  {
    id: "MCP008",
    title: "`server/discover` not implemented",
    severity: "warning",
    specRef: SPEC.discover,
    evaluate(ctx) {
      const live = ctx.live;
      if (!live || live.discoverImplemented !== false) return null;
      if (live.era !== "modern" && live.era !== "dual") return null;
      return {
        ruleId: "MCP008",
        title: "`server/discover` not implemented",
        severity: "warning",
        detail: "The server served a modern request but answered `server/discover` with no result. The revision says servers **MUST** implement it, and it is the probe clients use to pick a protocol version before sending anything else.",
        fix: "Implement `server/discover`, returning `supportedVersions`, `capabilities` and `_meta['io.modelcontextprotocol/serverInfo']`.",
        specRef: SPEC.discover,
        location: "live endpoint"
      };
    }
  },
  {
    id: "MCP009",
    title: "Python SDK still on the v1 line",
    severity: "warning",
    specRef: SPEC.pythonSdk,
    evaluate(ctx) {
      const requirement = ctx.source?.pythonSdkRequirements?.find(
        (candidate) => candidate.sdkLine === "legacy"
      );
      const legacyApi = firstMatch(ctx, "pythonV1Sdk");
      if (!requirement && !legacyApi) return null;
      const requirementDetail = requirement ? `${requirement.file} declares \`${requirement.requirement}\`, a constraint that can only install the 1.x maintenance line.` : null;
      const apiDetail = legacyApi ? "Source imports `mcp.server.fastmcp`, the v1 high-level server API (`FastMCP`)." : null;
      return {
        ruleId: "MCP009",
        title: "Python SDK still on the v1 line",
        severity: "warning",
        detail: [requirementDetail, apiDetail, "Python SDK v2 is the current line and implements the 2026-07-28 protocol revision."].filter(Boolean).join(" "),
        fix: "Move the official `mcp` dependency to 2.x (for example `mcp>=2,<3`) and follow the Python SDK migration guide. For a high-level server, replace `from mcp.server.fastmcp import FastMCP` with `from mcp.server import MCPServer`, then migrate the remaining v2 API changes and run the server's tests.",
        specRef: SPEC.pythonSdk,
        location: requirement ? `${requirement.file}:${requirement.line}` : loc(legacyApi)
      };
    }
  },
  {
    id: "MCP010",
    title: "Rust MCP SDK on a pre-2026-07-28 line",
    severity: "warning",
    specRef: SPEC.rustSdk,
    // Per-SDK authoritative references — the owner wants each crate to cite
    // its own repo rather than one umbrella URL for all three SDKs.
    references: [SPEC.rustSdkReleases, SPEC.towerMcp, SPEC.rustMcpSdk],
    evaluate(ctx) {
      const deps = ctx.source?.sdkDependencies ?? [];
      const RUST_MCP_CRATES = /* @__PURE__ */ new Set(["rmcp", "rust-mcp-sdk", "tower-mcp"]);
      const rustMcpDeps = deps.filter(
        (d) => d.ecosystem === "cargo" && RUST_MCP_CRATES.has(d.name)
      );
      const where = (dep) => dep.section && dep.section !== "dependencies" ? ` under [${dep.section}]` : "";
      const hits = [];
      for (const dep of rustMcpDeps) {
        if (dep.name === "rmcp") {
          const majorMatch = dep.constraint.match(/^[~^]?(\d+)/);
          if (!majorMatch) continue;
          const major = Number.parseInt(majorMatch[1], 10);
          if (!Number.isNaN(major) && major < 3) {
            hits.push({
              detail: `Cargo.toml depends on ${dep.name} (${dep.constraint})${where(dep)}. That is a pre-2026-07-28 line; rmcp 3.x is the current line speaking spec 2026-07-28.`,
              fix: "Upgrade rmcp to 3.x (the current line speaking spec 2026-07-28).",
              specRef: SPEC.rustSdk,
              refs: [SPEC.rustSdkReleases]
            });
          }
          continue;
        }
        if (dep.name === "rust-mcp-sdk") {
          const majorMatch = dep.constraint.match(/^[~^]?(\d+)/);
          if (!majorMatch) continue;
          const major = Number.parseInt(majorMatch[1], 10);
          if (!Number.isNaN(major) && major >= 2) continue;
          hits.push({
            detail: `Cargo.toml depends on rust-mcp-sdk (${dep.constraint})${where(dep)}. That crate only speaks the 2025-11-25 protocol; migrate to rmcp 3.x or rust-mcp-sdk 2.x.`,
            fix: "Upgrade to rmcp 3.x or rust-mcp-sdk 2.x (both speak 2026-07-28).",
            specRef: SPEC.rustMcpSdk,
            refs: [SPEC.rustSdk, SPEC.rustSdkReleases]
          });
          continue;
        }
        if (dep.name === "tower-mcp") {
          if (dep.features && !dep.features.includes("protocol-2026-07-28")) {
            hits.push({
              detail: `Cargo.toml depends on tower-mcp (${dep.constraint})${where(dep)} without the protocol-2026-07-28 feature. That crate speaks 2026-07-28 only when that feature is enabled.`,
              fix: "For tower-mcp, enable the protocol-2026-07-28 feature.",
              specRef: SPEC.towerMcp,
              refs: [SPEC.rustSdk, SPEC.rustSdkReleases]
            });
          }
          continue;
        }
      }
      if (hits.length === 0) return null;
      return {
        ruleId: "MCP010",
        title: "Rust MCP SDK on a pre-2026-07-28 line",
        severity: "warning",
        detail: hits.map((h) => h.detail).join(" "),
        fix: hits.map((h) => h.fix).join(" "),
        // One crate cites its own repo; several cite the SDK index instead.
        specRef: hits.length === 1 ? hits[0].specRef : SPEC.rustSdk,
        references: [...new Set(hits.flatMap((h) => h.refs))],
        location: "Cargo.toml"
      };
    }
  },
  {
    id: "MCP011",
    title: "Go MCP SDK not serving the 2026-07-28 revision",
    severity: "warning",
    specRef: SPEC.sdk,
    references: [SPEC.goSdk, SPEC.markThreeLabsMcpGo],
    evaluate(ctx) {
      const deps = (ctx.source?.sdkDependencies ?? []).filter((d) => d.ecosystem === "go");
      if (deps.length === 0) return null;
      const hits = [];
      for (const dep of deps) {
        if (dep.indirect || dep.replaced || dep.sdkLine === "unknown") continue;
        if (dep.sdkLine === "legacy") {
          const target = dep.name === "github.com/mark3labs/mcp-go" ? "v1.0.0" : "v1.7.0";
          hits.push({
            detail: `${dep.manifest} requires ${dep.name} ${dep.constraint}, which is below ${target} \u2014 the first release of that module speaking 2026-07-28.`,
            fix: `Upgrade ${dep.name} to ${target} or later (\`go get ${dep.name}@${target}\`), then run your tests. The module path does not change: Go crossed the protocol break inside its existing major, so there is no v2 import path to rewrite.`
          });
        }
      }
      const modernOfficial = deps.find(
        (d) => d.name === "github.com/modelcontextprotocol/go-sdk" && d.sdkLine === "modern" && !d.indirect && !d.replaced
      );
      const http = firstMatch(ctx, "goStreamableHttp");
      const statelessOptIn = (ctx.source?.matches.goStatelessOptIn?.length ?? 0) > 0;
      if (modernOfficial && http && !statelessOptIn) {
        hits.push({
          detail: `${modernOfficial.manifest} requires ${modernOfficial.name} ${modernOfficial.constraint}, which speaks 2026-07-28, but the streamable HTTP transport at ${http.file}:${http.line} is configured without \`Stateless\`. That transport serves the revision only when it is stateless; left as is, clients negotiate down to 2025-11-25.`,
          fix: "Set `Stateless: true` in `StreamableHTTPOptions`, and move any per-session state onto explicit handles passed as tool arguments. Upgrading the module is not enough on its own \u2014 serving the revision over HTTP is a separate, deliberate choice. A stdio server needs no such flag."
        });
      }
      if (hits.length === 0) return null;
      return {
        ruleId: "MCP011",
        title: "Go MCP SDK not serving the 2026-07-28 revision",
        severity: "warning",
        detail: hits.map((h) => h.detail).join(" "),
        fix: hits.map((h) => h.fix).join(" "),
        specRef: SPEC.sdk,
        references: [SPEC.goSdk, SPEC.markThreeLabsMcpGo],
        location: deps[0].manifest
      };
    }
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
    evaluate(ctx) {
      if (ctx.live?.era !== "dual") return null;
      return {
        ruleId: "MCP101",
        title: "Dual-era: still accepts the legacy handshake",
        severity: "info",
        detail: `The server serves the current revision${versionsClause(
          ctx
        )} and also answers the legacy \`initialize\` handshake${ctx.live.legacyProtocolVersion ? ` (negotiating ${ctx.live.legacyProtocolVersion})` : ""}. That is a supported configuration, not drift: a dual-era server picks its semantics from how each client opens.`,
        fix: "Nothing to do. Keep the legacy path while clients in the wild still send `initialize`, and retire it on your own schedule.",
        specRef: SPEC.versioning,
        location: "live endpoint"
      };
    }
  },
  {
    id: "MCP102",
    title: "Session ids issued to legacy clients only",
    severity: "info",
    specRef: SPEC.transport,
    evaluate(ctx) {
      const live = ctx.live;
      if (!live?.sessionIdOnLegacyHandshake) return null;
      if (live.sessionIdOnModernRequest) return null;
      if (live.era !== "dual") return null;
      return {
        ruleId: "MCP102",
        title: "Session ids issued to legacy clients only",
        severity: "info",
        detail: "`Mcp-Session-Id` came back from the legacy handshake but not from a modern request. That is the legacy revision working as specified; the modern surface stayed stateless.",
        fix: "Nothing to do, as long as no modern-path behaviour depends on that session. Retire it with the legacy path.",
        specRef: SPEC.transport,
        location: "live endpoint"
      };
    }
  }
];
function capabilityRule(spec) {
  return (ctx) => {
    const live = ctx.live?.advertisedCapabilities.includes(spec.capability);
    const src = firstMatch(ctx, spec.capability);
    if (!live && !src) return null;
    const legacyOnly = live === true && ctx.live?.capabilitiesEra === "legacy" && ctx.live.era === "dual";
    return {
      ruleId: spec.id,
      title: spec.title,
      severity: legacyOnly ? "info" : "warning",
      detail: live ? legacyOnly ? `The server advertises the deprecated \`${spec.capability}\` capability in its legacy handshake only. Deprecated features stay functional through the deprecation window, so this is what a dual-era server offering v1 clients what they expect looks like.` : `The server advertises the deprecated \`${spec.capability}\` capability.` : spec.sourceDetail,
      fix: legacyOnly ? `Nothing urgent. Drop \`${spec.capability}\` when you retire the legacy path \u2014 new implementations should not adopt it.` : spec.fix,
      specRef: spec.specRef,
      location: live ? "live endpoint" : loc(src)
    };
  };
}

// packages/core/src/engine.ts
var PENALTY = {
  critical: 30,
  warning: 15,
  info: 0
};
function gradeFrom(findings) {
  const deduction = findings.reduce((sum, f) => sum + PENALTY[f.severity], 0);
  const score = Math.max(0, 100 - deduction);
  const letter = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return { score, letter };
}
function evaluate(ctx) {
  const order = ["critical", "warning", "info"];
  return rules.map((r) => r.evaluate(ctx)).filter((f) => f !== null).sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
}

// packages/core/src/probe.ts
var CURRENT_PROTOCOL_VERSION = "2026-07-28";
var LEGACY_PROTOCOL_VERSION = "2025-11-25";
var CLIENT_INFO = { name: "mcpcheck", version: "0.2.0" };
var MODERN_ERROR_MIN = -32099;
var MODERN_ERROR_MAX = -32020;
var DEFAULT_MAX_BODY_BYTES = 256 * 1024;
async function probeEndpoint(url, opts = {}) {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8e3;
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const ctx = {
    reachable: false,
    era: "unknown",
    supportedVersions: [],
    discoverImplemented: null,
    modernRequestsServed: false,
    respondsToLegacyInitialize: false,
    legacyProtocolVersion: null,
    sessionIdOnModernRequest: false,
    sessionIdOnLegacyHandshake: false,
    advertisedCapabilities: [],
    capabilitiesEra: null,
    authRequired: false,
    oauthResourceMetadata: false
  };
  let wwwAuthenticate = null;
  let modernEra = false;
  const send = (body, headers) => request(doFetch, url, body, headers, timeoutMs, maxBodyBytes);
  const discover = await send(
    modernBody("discover-1", "server/discover"),
    modernHeaders("server/discover")
  );
  if (discover.error) {
    ctx.rawError = discover.error;
  } else {
    ctx.reachable = true;
    ctx.sessionIdOnModernRequest = discover.sessionId;
    wwwAuthenticate = discover.wwwAuthenticate;
    if (discover.status === 401 || wwwAuthenticate !== null) ctx.authRequired = true;
    const result = discover.payload?.result;
    const code = numericErrorCode(discover.payload);
    if (result && typeof result === "object") {
      modernEra = true;
      ctx.discoverImplemented = true;
      ctx.modernRequestsServed = true;
      ctx.supportedVersions = stringList(result.supportedVersions);
      if (result.capabilities && typeof result.capabilities === "object") {
        ctx.advertisedCapabilities = Object.keys(result.capabilities);
        ctx.capabilitiesEra = "modern";
      }
    } else if (code !== null && code >= MODERN_ERROR_MIN && code <= MODERN_ERROR_MAX) {
      modernEra = true;
      ctx.discoverImplemented = true;
      ctx.supportedVersions = stringList(discover.payload?.error?.data?.supported);
    } else if (!ctx.authRequired) {
      ctx.discoverImplemented = false;
    }
  }
  if (ctx.reachable && !modernEra && !ctx.authRequired) {
    const list = await send(
      modernBody("list-1", "tools/list"),
      modernHeaders("tools/list")
    );
    if (!list.error) {
      if (list.sessionId) ctx.sessionIdOnModernRequest = true;
      const result = list.payload?.result;
      const code = numericErrorCode(list.payload);
      if (result && typeof result === "object" && typeof result.resultType === "string") {
        modernEra = true;
        ctx.modernRequestsServed = true;
      } else if (code !== null && code >= MODERN_ERROR_MIN && code <= MODERN_ERROR_MAX) {
        modernEra = true;
        ctx.supportedVersions = stringList(list.payload?.error?.data?.supported);
      }
    }
  }
  if (ctx.reachable && !ctx.authRequired && !opts.skipLegacyProbe) {
    const init = await send(legacyInitializeBody(), {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    });
    if (!init.error) {
      const result = init.payload?.result;
      if (result && typeof result === "object") {
        ctx.respondsToLegacyInitialize = true;
        ctx.sessionIdOnLegacyHandshake = init.sessionId;
        if (typeof result.protocolVersion === "string") {
          ctx.legacyProtocolVersion = result.protocolVersion;
        }
        if (ctx.capabilitiesEra === null && result.capabilities && typeof result.capabilities === "object") {
          ctx.advertisedCapabilities = Object.keys(result.capabilities);
          ctx.capabilitiesEra = "legacy";
        }
      }
    }
  }
  ctx.era = deriveEra(modernEra, ctx.respondsToLegacyInitialize);
  if (ctx.reachable) {
    ctx.oauthResourceMetadata = await checkOAuthMetadata(
      url,
      wwwAuthenticate,
      doFetch,
      timeoutMs
    ).catch(() => false);
  }
  return ctx;
}
function deriveEra(modern, legacy) {
  if (modern && legacy) return "dual";
  if (modern) return "modern";
  if (legacy) return "legacy";
  return "unknown";
}
function modernBody(id, method) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": CURRENT_PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientInfo": CLIENT_INFO,
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  };
}
function modernHeaders(method) {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": CURRENT_PROTOCOL_VERSION,
    "mcp-method": method
  };
}
function legacyInitializeBody() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO
    }
  };
}
async function request(doFetch, url, body, headers, timeoutMs, maxBodyBytes) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await readCapped(res, maxBodyBytes).catch(() => "");
    return {
      status: res.status,
      sessionId: res.headers.has("mcp-session-id"),
      wwwAuthenticate: res.headers.get("www-authenticate"),
      payload: parseMaybeSse(text)
    };
  } catch (err) {
    return {
      status: 0,
      sessionId: false,
      wwwAuthenticate: null,
      payload: null,
      error: err instanceof Error ? err.message : String(err)
    };
  } finally {
    clearTimeout(timer);
  }
}
function numericErrorCode(payload) {
  const code = payload?.error?.code;
  return typeof code === "number" && Number.isFinite(code) ? code : null;
}
function stringList(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}
async function readCapped(res, limit) {
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let seen = 0;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      seen += value.byteLength;
      if (seen > limit) {
        const keep = value.subarray(0, value.byteLength - (seen - limit));
        out += decoder.decode(keep);
        break;
      }
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {
    });
  }
  return out;
}
function parseMaybeSse(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    for (const line of trimmed.split(/\r?\n/)) {
      const m = line.match(/^data:\s*(.*)$/);
      if (m) {
        try {
          return JSON.parse(m[1]);
        } catch {
        }
      }
    }
    return null;
  }
}
async function checkOAuthMetadata(url, wwwAuthenticate, doFetch, timeoutMs) {
  const parsed = new URL(url);
  const base = `${parsed.origin}/.well-known/oauth-protected-resource`;
  const suffix = parsed.pathname.replace(/\/+$/, "");
  const candidates = [
    ...advertisedMetadataUrl(wwwAuthenticate),
    ...suffix && suffix !== "/" ? [`${base}${suffix}`] : [],
    base
  ];
  const sameOrigin = candidates.filter((c) => new URL(c).origin === parsed.origin);
  for (const candidate of sameOrigin) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(candidate, {
        method: "GET",
        signal: controller.signal
      });
      await res.body?.cancel().catch(() => {
      });
      if (res.ok) return true;
    } catch {
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}
function advertisedMetadataUrl(header) {
  if (!header) return [];
  const m = header.match(/resource_metadata\s*=\s*"([^"]+)"|resource_metadata\s*=\s*([^\s,]+)/i);
  const raw = m?.[1] ?? m?.[2];
  if (!raw) return [];
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return [];
    return [u.toString()];
  } catch {
    return [];
  }
}

// packages/core/src/scan.ts
import { promises as fs } from "node:fs";
import path from "node:path";
var SCANNABLE = /* @__PURE__ */ new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".go", ".rs"]);
var IGNORED_DIRS = /* @__PURE__ */ new Set([
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
  ".gomodcache"
]);
var SIGNAL_PATTERNS = {
  initialize: /InitializeRequest|oninitialized|on_initialized|notifications\/initialized|["']initialize["']|["']initialized["']|\bInitializedHandler\b|\bmcp\.Initialized(?:Params|Request)\b|\.InitializeParams\(\)|\b(?:Add|On)(?:Before|After)Initialize\b/,
  sessionId: /[Mm]cp-[Ss]ession-[Ii]d|mcpSessionId|mcp_session_id|get_session_id|session_id_generator|stateless_http\s*=\s*False|\bsessionId\b|\bGetSessionID\s*[:=]|SessionIdManager|\bHeader(?:Key)?SessionID\b/,
  logging: /["']logging["']|LoggingLevel|LoggingMessageNotification|send_log_message|\b(?:ctx|context)\.(?:debug|info|warning|error|critical|log)\s*\(|\blogging\b\s*:\s*\{|\bLoggingMessageParams\b|\bNewLoggingHandler\b|\bSendLogMessageToClient\b|\bserver\.WithLogging\s*\(/,
  sampling: /["']sampling["']|createMessage|create_message|SamplingMessage|\bsampling\b\s*:\s*\{|\bCreateMessage(?:Params|Result|Request|Handler)\b|\b(?:EnableSampling|RequestSampling|WithSamplingHandler)\b/,
  roots: /["']roots["']|ListRootsRequest|RootsCapability|list_roots|\broots\b\s*:\s*\{|\bListRoots(?:Params|Result)\b|\b(?:AddRoots|RemoveRoots|RequestRoots|WithRootsHandler)\b|\bserver\.WithRoots\s*\(/,
  /**
   * Go: a streamable-HTTP server is being configured.
   *
   * Only meaningful next to `goStatelessOptIn`. The official Go SDK refuses to
   * serve `2026-07-28` over this transport unless it is stateless, so the pair
   * "HTTP transport present, stateless opt-in absent" is what MCP011 reads. A
   * stdio server matches neither and is modern on the SDK version alone.
   */
  goStreamableHttp: (
    // No leading `\b`: the official constructor is `NewStreamableHTTPHandler`,
    // and a boundary before `Streamable` cannot match inside it. Requiring one
    // let the exact case this signal exists for slip through — a server that
    // passes `nil` options never names `StreamableHTTPOptions` at all, so the
    // handler call is the only thing to see.
    /StreamableHTTP(?:Handler|Options|Server)\b|\bStreamableServerTransport\b/
  ),
  /**
   * Go: the stateless opt-in, in either SDK's spelling.
   *
   * NOT modern-era evidence on its own — `StreamableHTTPOptions.Stateless` has
   * existed since go-sdk v1.3.1, long before the revision. It is only ever read
   * as the absence-check above.
   */
  goStatelessOptIn: /\bStateless\s*:\s*true\b|\.Stateless\s*=\s*true\b|\bWithStateLess\s*\(|\bStatelessSessionIdManager\b/,
  /** The official Python SDK's v1 high-level server import. */
  pythonV1Sdk: /\bfrom\s+mcp\.server\.fastmcp(?:\.[A-Za-z_][\w.]*)?\s+import\b|\bimport\s+mcp\.server\.fastmcp\b/,
  /** Any official Python SDK server import; its major comes from metadata. */
  pythonServerSdk: /\bfrom\s+mcp\.server(?:\.[A-Za-z_]\w*)*\s+import\b|\bimport\s+mcp\.server(?:\.[A-Za-z_]\w*)*\b/,
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
  modernEra: /io\.modelcontextprotocol\/(protocolVersion|clientCapabilities|clientInfo|serverInfo)|["']server\/discover["']|@modelcontextprotocol\/(server|client|core)\b|\bfrom\s+mcp\.server\s+import\s+[^#\n]*\bMCPServer\b|\bfrom\s+mcp\.server\.mcpserver(?:\.[A-Za-z_][\w.]*)?\s+import\b|\bMetaKey(?:ProtocolVersion|ClientInfo|ServerInfo|ClientCapabilities|SubscriptionID)\b|\bProtocolVersion20260728\b|\bmcp\.Discover(?:Params|Result)\b|["']subscriptions\/listen["']|["']2026-07-28["']/
};
async function scanSource(dir, opts = {}) {
  const maxFiles = opts.maxFiles ?? 5e3;
  const maxBytes = opts.maxBytesPerFile ?? 1e6;
  const matches = {};
  for (const key of Object.keys(SIGNAL_PATTERNS)) matches[key] = [];
  let filesScanned = 0;
  const files = await collectFiles(dir, maxFiles);
  for (const file of files) {
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
            text: line.trim().slice(0, 200)
          });
        }
      }
    }
  }
  const pkg = await readPackageJson(dir);
  for (const name of pkg.modernPackages) {
    matches.modernEra.push({ file: "package.json", line: 0, text: name });
  }
  const pythonSdkRequirements = await readPythonSdkRequirements(dir, maxBytes, maxFiles);
  for (const req of pythonSdkRequirements) {
    if (req.sdkLine !== "modern") continue;
    matches.modernEra.push({
      file: req.file,
      line: req.line,
      text: req.requirement
    });
  }
  const sdkDependencies = [
    ...await readCargoDependencies(dir),
    ...await readGoModDependencies(dir, maxBytes, maxFiles)
  ];
  const goHttpWithoutStateless = matches.goStreamableHttp.length > 0 && matches.goStatelessOptIn.length === 0;
  for (const dep of sdkDependencies) {
    if (dep.ecosystem !== "go" || dep.sdkLine !== "modern") continue;
    if (dep.indirect || dep.replaced) continue;
    if (goHttpWithoutStateless) continue;
    matches.modernEra.push({
      file: dep.manifest,
      line: dep.line ?? 0,
      text: `${dep.name} ${dep.constraint}`
    });
  }
  return { matches, sdkVersion: pkg.sdkVersion, pythonSdkRequirements, filesScanned, sdkDependencies };
}
function classifyPythonSdkSpecifier(specifier) {
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
  for (const clause of clauses) {
    const upper = clause.match(/^(<|<=)\s*[vV]?(\d+)(?:\.(\d+))?/);
    if (!upper) continue;
    const major = Number(upper[2]);
    if (major < 2 || major === 2 && upper[1] === "<" && Number(upper[3] ?? 0) === 0) {
      return "legacy";
    }
  }
  for (const clause of clauses) {
    const lower = clause.match(/^>=\s*[vV]?(\d+)/);
    if (lower && Number(lower[1]) >= 2) return "modern";
  }
  return "unknown";
}
function parsePythonSdkRequirements(file, content) {
  const name = path.basename(file).toLowerCase();
  if (name === "pyproject.toml") return parsePyproject(file, content);
  if (name === "pipfile") return parsePipfile(file, content);
  if (name === "setup.cfg") return parseSetupCfg(file, content);
  if (/^requirements(?:[-_.].*)?\.(?:txt|in)$/.test(name)) {
    return parseRequirementsFile(file, content);
  }
  return [];
}
function parsePyproject(file, content) {
  const found = [];
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
    const arraySection = section === "project.optional-dependencies" || section === "dependency-groups" || section === "tool.pdm.dev-dependencies";
    if (dependencyArray) {
      addQuotedRequirements(found, file, i + 1, line);
      if (hasTomlArrayClose(line)) dependencyArray = false;
      continue;
    }
    const projectDependencies = section === "project" && /^\s*dependencies\s*=\s*\[/.test(line);
    const groupedDependencies = arraySection && /^\s*[^=]+\s*=\s*\[/.test(line);
    if (projectDependencies || groupedDependencies) {
      addQuotedRequirements(found, file, i + 1, line);
      dependencyArray = !hasTomlArrayClose(line);
      continue;
    }
    if (section === "tool.poetry.dependencies" || /^tool\.poetry\.group\.[^.]+\.dependencies$/.test(section)) {
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
function parsePipfile(file, content) {
  const found = [];
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
function parseSetupCfg(file, content) {
  const found = [];
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
function parseRequirementsFile(file, content) {
  const found = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("-")) continue;
    addRequirement(found, file, i + 1, line);
  }
  return found;
}
function addQuotedRequirements(out, file, line, text) {
  for (const match of text.matchAll(/(["'])(.*?)\1/g)) {
    addRequirement(out, file, line, match[2]);
  }
}
function addRequirement(out, file, line, raw) {
  const requirement = raw.trim();
  const match = requirement.match(/^mcp(?:\s*\[[^\]]+])?\s*(.*)$/i);
  if (!match) return;
  const remainder = match[1].trim();
  if (/^[-_.A-Za-z0-9]/.test(remainder)) return;
  const specifier = remainder.split(";", 1)[0].trim();
  out.push({
    file,
    line,
    requirement,
    specifier,
    sdkLine: classifyPythonSdkSpecifier(specifier)
  });
}
function stripTomlComment(line) {
  let quote = null;
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
function hasTomlArrayClose(line) {
  let quote = null;
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
async function readPythonSdkRequirements(dir, maxBytes, maxFiles) {
  const manifests = await collectMatchingFiles(dir, isPythonDependencyFile, maxFiles);
  const found = [];
  for (const manifest of manifests) {
    const content = await readIfSmallEnough(manifest, maxBytes);
    if (content === null) continue;
    const relative = path.relative(dir, manifest);
    found.push(...parsePythonSdkRequirements(relative, content));
  }
  return found;
}
function isPythonDependencyFile(name) {
  const lower = name.toLowerCase();
  return lower === "pyproject.toml" || lower === "pipfile" || lower === "setup.cfg" || /^requirements(?:[-_.].*)?\.(?:txt|in)$/.test(lower);
}
var MODERN_PACKAGES = [
  "@modelcontextprotocol/server",
  "@modelcontextprotocol/client",
  "@modelcontextprotocol/core"
];
async function readPackageJson(dir) {
  try {
    const raw = await fs.readFile(path.join(dir, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    const deps = { ...pkg.devDependencies, ...pkg.dependencies };
    const dep = deps["@modelcontextprotocol/sdk"];
    return {
      sdkVersion: typeof dep === "string" ? dep : null,
      modernPackages: MODERN_PACKAGES.filter((name) => typeof deps[name] === "string")
    };
  } catch {
    return { sdkVersion: null, modernPackages: [] };
  }
}
var MCP_CRATES = /* @__PURE__ */ new Set(["rmcp", "rust-mcp-sdk", "tower-mcp"]);
var CARGO_SECTIONS = /* @__PURE__ */ new Set([
  "dependencies",
  "dev-dependencies",
  "workspace.dependencies"
]);
function parseCargoSection(header) {
  const inner = header.replace(/^\[|\]$/g, "").trim();
  if (CARGO_SECTIONS.has(inner)) {
    return { section: inner, crate: null };
  }
  const dot = inner.lastIndexOf(".");
  if (dot === -1) return null;
  const section = inner.slice(0, dot).trim();
  if (!CARGO_SECTIONS.has(section)) return null;
  const crate = inner.slice(dot + 1).trim();
  return crate ? { section, crate } : null;
}
function parseCargoFeatures(body) {
  const match = body.match(/features\s*=\s*\[([^\]]*)\]/);
  if (!match) return [];
  const features = [];
  for (const part of match[1].split(",")) {
    const feature = part.trim().replace(/^"|"$/g, "");
    if (feature) features.push(feature);
  }
  return features;
}
function parseCargoToml(content) {
  const lines = content.split(/\r?\n/);
  const deps = [];
  let section = null;
  let subTable = null;
  const push = (crate, body, declaredIn) => {
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
      ...features.length ? { features } : {}
    });
  };
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
      subTable.body += `${trimmed}
`;
      continue;
    }
    const entry = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!entry) continue;
    const name = entry[1];
    if (!MCP_CRATES.has(name)) continue;
    let rhs = entry[2].trim();
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
async function readCargoDependencies(dir) {
  try {
    const raw = await fs.readFile(path.join(dir, "Cargo.toml"), "utf8");
    return parseCargoToml(raw);
  } catch {
    return [];
  }
}
var MCP_GO_MODULES = {
  "github.com/modelcontextprotocol/go-sdk": [1, 7, 0],
  "github.com/mark3labs/mcp-go": [1, 0, 0]
};
var GO_PSEUDO_VERSION = /[-.]\d{14}-[0-9a-f]{12}$/;
function classifyGoSdkVersion(module, version) {
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
function stripGoComment(line) {
  const at = line.indexOf("//");
  if (at === -1) return { text: line.trim(), indirect: false };
  return {
    text: line.slice(0, at).trim(),
    indirect: /(^|\s)indirect(\s|$)/.test(line.slice(at + 2))
  };
}
function parseGoMod(content) {
  const lines = content.split(/\r?\n/);
  const deps = [];
  const replaced = /* @__PURE__ */ new Set();
  let block = null;
  const noteReplace = (text) => {
    const module = text.split(/\s+/)[0];
    if (module) replaced.add(module);
  };
  const noteRequire = (text, lineNo, indirect) => {
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
      ...indirect ? { indirect: true } : {}
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
      block = opened[1];
      continue;
    }
    const single = text.match(/^(require|replace|exclude|retract)\s+(.*)$/);
    if (!single) continue;
    if (single[1] === "require") noteRequire(single[2].trim(), i + 1, indirect);
    else if (single[1] === "replace") noteReplace(single[2].trim());
  }
  for (const dep of deps) {
    if (!replaced.has(dep.name)) continue;
    dep.replaced = true;
    dep.sdkLine = "unknown";
  }
  return deps;
}
async function readGoModDependencies(dir, maxBytes, maxFiles) {
  const manifests = await collectMatchingFiles(dir, (name) => name === "go.mod", maxFiles);
  const found = [];
  for (const manifest of manifests) {
    const content = await readIfSmallEnough(manifest, maxBytes);
    if (content === null) continue;
    const relative = path.relative(dir, manifest);
    for (const dep of parseGoMod(content)) found.push({ ...dep, manifest: relative });
  }
  return found;
}
async function readIfSmallEnough(file, maxBytes) {
  let handle;
  try {
    handle = await fs.open(file, "r");
    const stat = await handle.stat();
    if (!stat.isFile()) return null;
    if (stat.size > maxBytes) return null;
    return await handle.readFile("utf8");
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {
    });
  }
}
async function collectFiles(dir, cap) {
  const out = [];
  async function walk(current) {
    if (out.length >= cap) return;
    let entries;
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
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out;
}
async function collectMatchingFiles(dir, match, cap) {
  const out = [];
  async function walk(current) {
    if (out.length >= cap) return;
    let entries;
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

// packages/core/src/ssrf.ts
var BLOCKED_HOSTNAMES = /* @__PURE__ */ new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal"
]);
function isSafePublicUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "Only http and https are allowed." };
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: "Refusing to reach a loopback/metadata host." };
  }
  if (isIpv4(host)) {
    if (isPrivateIpv4(host)) {
      return { ok: false, reason: "Refusing to reach a private/reserved IPv4 address." };
    }
  } else if (host.includes(":")) {
    if (isPrivateIpv6(host)) {
      return { ok: false, reason: "Refusing to reach a private/reserved IPv6 address." };
    }
  }
  return { ok: true };
}
function isIpv4(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}
function isPrivateIpv4(ip) {
  const p = ip.split(".").map((n) => Number.parseInt(n, 10));
  if (p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}
function isPrivateIpv6(ip) {
  const h = ip.toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe80")) return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
  if (h.startsWith("::ffff:")) return true;
  return false;
}

// packages/core/src/index.ts
function describeEra(live) {
  switch (live.era) {
    case "dual":
      return "Serves the current revision and still answers the legacy `initialize` handshake (dual-era).";
    case "modern":
      return "Serves the current revision. The legacy `initialize` handshake was not answered.";
    case "legacy":
      return "Answers the legacy `initialize` handshake only \u2014 no modern surface responded.";
    default:
      return live.authRequired ? "Authentication required, so neither protocol era could be probed." : "Nothing answered in a way that identified a protocol era.";
  }
}
async function checkLive(url, opts = {}) {
  const enforce = opts.enforceSsrfGuard ?? true;
  if (enforce) {
    const guard = isSafePublicUrl(url);
    if (!guard.ok) {
      return {
        target: url,
        mode: "live",
        findings: [],
        grade: gradeFrom([]),
        checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
        inconclusive: true,
        note: guard.reason
      };
    }
  }
  const live = await probeEndpoint(url, opts);
  if (!live.reachable) {
    return {
      target: url,
      mode: "live",
      findings: [],
      grade: gradeFrom([]),
      checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
      inconclusive: true,
      note: live.rawError ? `Endpoint unreachable: ${live.rawError}` : "Endpoint unreachable."
    };
  }
  const findings = evaluate({ live });
  return {
    target: url,
    mode: "live",
    findings,
    grade: gradeFrom(findings),
    checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
    note: describeEra(live)
  };
}
async function checkSource(dir, opts = {}) {
  const source = await scanSource(dir, opts);
  const findings = evaluate({ source });
  return {
    target: dir,
    mode: "source",
    findings,
    grade: gradeFrom(findings),
    checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
    note: source.filesScanned === 0 ? "No scannable source files found." : `Scanned ${source.filesScanned} file(s).`
  };
}

// packages/core/src/check-entry.ts
var HELP = `mcpcheck \u2014 MCP 2026-07-28 migration readiness

Usage:
  mcpcheck <url>              Probe a live MCP endpoint (http/https)
  mcpcheck --source <dir>     Statically scan a repository
  mcpcheck --local <url>      Allow localhost/private targets (SSRF guard off)
  mcpcheck ... --json         Machine-readable output

Exit codes:
  0  no critical findings
  1  at least one critical finding
  2  inconclusive (unreachable / blocked / nothing to scan)
`;
function render(result) {
  const out = [];
  out.push(`Target: ${result.target}  (${result.mode})`);
  if (result.inconclusive) {
    out.push(`Result: inconclusive \u2014 ${result.note ?? "no detail"}`);
    return out.join("\n");
  }
  out.push(`Grade:  ${result.grade.letter} (${result.grade.score}/100)`);
  if (result.note) out.push(result.note);
  if (result.findings.length === 0) {
    out.push("");
    out.push("No breaking-change signals found.");
    return out.join("\n");
  }
  out.push("");
  for (const f of result.findings) {
    out.push(`[${f.severity.toUpperCase()}] ${f.title}  (${f.ruleId})`);
    if (f.location) out.push(`  at:       ${f.location}`);
    out.push(`  observed: ${f.detail}`);
    out.push(`  fix:      ${f.fix}`);
    out.push(`  spec:     ${f.specRef}`);
    if (f.references && f.references.length > 0) {
      for (const ref of f.references) {
        out.push(`  see also: ${ref}`);
      }
    }
    out.push("");
  }
  out.push(`Rules last verified against the spec: ${rulesVerifiedAt}`);
  return out.join("\n").trimEnd();
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return args.length === 0 ? 2 : 0;
  }
  const json = args.includes("--json");
  const sourceIdx = args.indexOf("--source");
  const localIdx = args.indexOf("--local");
  let result;
  if (sourceIdx !== -1) {
    const dir = args[sourceIdx + 1];
    if (!dir) {
      console.error("--source requires a directory path");
      return 2;
    }
    result = await checkSource(dir);
  } else {
    const url = localIdx !== -1 ? args[localIdx + 1] : args.find((a) => !a.startsWith("--"));
    if (!url) {
      console.error("Provide a URL, or use --source <dir>");
      return 2;
    }
    result = await checkLive(url, { enforceSsrfGuard: localIdx === -1 });
  }
  console.log(json ? JSON.stringify(result, null, 2) : render(result));
  if (result.inconclusive) return 2;
  return result.findings.some((f) => f.severity === "critical") ? 1 : 0;
}
main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(2);
  }
);
