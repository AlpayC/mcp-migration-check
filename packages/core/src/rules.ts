import type { Finding, Rule, RuleContext, SdkDependency, SourceMatch } from "./types";

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
  // The official Rust SDK (rmcp) lives in its own repo, not the blog post
  // above — that one covers only Python/TS/Go/C#. Verified 2026-08-22.
  rustSdk: "https://github.com/modelcontextprotocol/rust-sdk",
  rustSdkReleases: "https://github.com/modelcontextprotocol/rust-sdk/releases",
  // Per-SDK authoritative references for MCP010 multi-crate coverage.
  towerMcp: "https://github.com/joshrotenberg/tower-mcp",
  rustMcpSdk: "https://github.com/rust-mcp-stack/rust-mcp-sdk",
  // Go's own story is not on the spec site either. `SPEC.sdk` above — the SDK
  // announcement — is the document that states both halves of it: which release
  // speaks the revision, and that serving it over HTTP is a separate opt-in, so
  // MCP011 cites that as its specRef. These two are the version-pinned package
  // pages it carries as supporting references.
  goSdk: "https://pkg.go.dev/github.com/modelcontextprotocol/go-sdk@v1.7.0/mcp",
  markThreeLabsMcpGo: "https://pkg.go.dev/github.com/mark3labs/mcp-go@v1.0.0/mcp",
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
  // Verified by hand against the rust-sdk repo README (2026-08-22).
  [SPEC.rustSdk]: "2026-08-22",
  [SPEC.rustSdkReleases]: "2026-08-28",
  [SPEC.towerMcp]: "2026-08-28",
  [SPEC.rustMcpSdk]: "2026-08-28",
  // Read against the module proxy and the module source on the same day: the
  // package pages are version-pinned, so they cannot drift the way a moving
  // `@latest` page would.
  [SPEC.goSdk]: "2026-09-03",
  [SPEC.markThreeLabsMcpGo]: "2026-09-03",
};

/** The oldest citation date — what a report should quote, not the newest. */
export const rulesVerifiedAt = Object.values(SPEC_VERIFIED_AT).sort()[0];

/**
 * Is this match inside a Go module whose MCP SDK requirement cannot be read?
 *
 * A `replace` to a fork and a `go get …@main` pseudo-version are both routine,
 * and both leave the requirement unclassifiable. MCP011 already stays quiet for
 * them. MCP002's source arm did not, and its silence is not neutral: absence of
 * modern evidence is what lets it fire, so "we cannot tell" was being spent as
 * a *critical* — on a `SessionID` tool argument, which is the very thing
 * MCP002's own fix recommends. MCP010 skips a crate it cannot parse rather than
 * guessing, and AGENTS.md is explicit: when you cannot tell, stay quiet.
 */
function goSdkUnclassifiable(ctx: RuleContext, match: SourceMatch): boolean {
  const owner = owningGoManifest(ctx, match.file);
  if (owner === null) return false;
  const deps = (ctx.source?.sdkDependencies ?? []).filter(
    (d) => d.ecosystem === "go" && d.manifest === owner,
  );
  return deps.length > 0 && deps.every((d) => d.sdkLine === "unknown");
}

/** Pick the first source match for a signal, if any, for location reporting. */
function firstMatch(ctx: RuleContext, signal: string): SourceMatch | undefined {
  return ctx.source?.matches[signal]?.[0];
}

function loc(match?: SourceMatch): string | undefined {
  return match ? `${match.file}:${match.line}` : undefined;
}

/**
 * Keep an untrusted manifest token out of a report at full length.
 *
 * `go.mod` is read from whatever the pull request contains, and the version
 * token is interpolated into `detail`, which reaches the JSON report and the
 * Action comment. Source-line matches are already capped at 200 characters;
 * manifest tokens were not.
 */
function clamp(value: string, max = 80): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/**
 * A predicate for "this source file belongs to the module that `manifest`
 * declares".
 *
 * Go repositories are routinely multi-module, and a signal collected across the
 * whole scan root cannot be attributed to one of them. Ownership is the nearest
 * enclosing `go.mod`, so a file under a deeper module belongs to that one, not
 * to this — which is what stops a legacy sibling module from convicting a
 * modern one.
 */
function dirOf(manifest: string): string {
  const p = manifest.replace(/\\/g, "/");
  return p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "";
}

function isGoPath(file: string): boolean {
  // Basename, not suffix: `endsWith("go.mod")` is also true of `cargo.mod`.
  // Unreachable today, but this guard is load-bearing for three rules now and
  // the next person to add a scannable extension should not have to know that.
  const base = file.replace(/\\/g, "/").split("/").pop() ?? "";
  return base.endsWith(".go") || base === "go.mod";
}

/**
 * Per-evaluation index for the Go ownership questions.
 *
 * Built once and cached on the context. Without it, MCP002's search called
 * `servesModern` per candidate, which resolved ownership per evidence item,
 * and evidence grows with module count — 1500 modules took 28.8 seconds, on
 * untrusted pull-request content in the Action.
 */
interface GoScope {
  /** Module directories, longest first, so the first hit is the nearest. */
  dirs: { dir: string; manifest: string }[];
  owner: Map<string, string | null>;
  /** Evidence from npm, Python or a non-Go source file. Repository-wide. */
  hasNonGoEvidence: boolean;
  /**
   * Go evidence in a file that belongs to no module.
   *
   * Its own bucket, deliberately. Folding it into `hasNonGoEvidence` made it
   * repository-wide and let one stray `.go` file above every `go.mod` acquit
   * every module below — reopening the over-reach a previous round had closed.
   * A file with no owning module can be *answered for* by anything (see
   * `servesModern`), but it cannot answer for a module it does not belong to.
   */
  hasOrphanGoEvidence: boolean;
  /** Manifests whose own module carries Go evidence. */
  goEvidenceOwners: Set<string>;
  anyEvidence: boolean;
}

/**
 * The index for the current evaluation, and only the current one.
 *
 * It exists for speed: without it, MCP002's search resolved ownership per
 * candidate and per evidence item, and 1500 modules took 28.8 seconds.
 *
 * It is cleared at the top of every `evaluate()` rather than invalidated,
 * because invalidation was the wrong question to be answering. A
 * `SourceContext` is an ordinary mutable object, and a stamp over its inputs
 * caught reassignment but not an in-place edit that preserved identity and
 * length — adequate for every shipped path, and adequate is a poor property
 * for a cache nobody will think about again. Built once per run, there is
 * nothing to go stale.
 */
let goScope: { key: object; scope: GoScope } | null = null;

/** Drop the cached index. Called by `evaluate()` before running the rules. */
export function resetGoScope(): void {
  goScope = null;
}

function goScopeOf(ctx: RuleContext): GoScope {
  const key = (ctx.source ?? ctx) as object;
  if (goScope && goScope.key === key) return goScope.scope;

  const manifests = new Set<string>(ctx.source?.goManifests ?? []);
  for (const dep of ctx.source?.sdkDependencies ?? []) {
    if (dep.ecosystem === "go") manifests.add(dep.manifest);
  }
  const dirs = [...manifests]
    .map((manifest) => ({ dir: dirOf(manifest), manifest }))
    .sort((a, b) => b.dir.length - a.dir.length);

  const scope: GoScope = {
    dirs,
    owner: new Map(),
    hasNonGoEvidence: false,
    hasOrphanGoEvidence: false,
    goEvidenceOwners: new Set(),
    anyEvidence: false,
  };

  const resolve = (file: string): string | null => {
    const normalized = file.replace(/\\/g, "/");
    for (const { dir, manifest } of scope.dirs) {
      if (normalized.startsWith(dir)) return manifest;
    }
    return null;
  };

  for (const match of ctx.source?.matches.modernEra ?? []) {
    scope.anyEvidence = true;
    if (!isGoPath(match.file)) {
      scope.hasNonGoEvidence = true;
      continue;
    }
    const owner = resolve(match.file);
    if (owner === null) scope.hasOrphanGoEvidence = true;
    else scope.goEvidenceOwners.add(owner);
  }

  (scope as GoScope & { resolve: typeof resolve }).resolve = resolve;
  goScope = { key, scope };
  return scope;
}

/** The `go.mod` whose directory most closely encloses `file`, if any. */
function owningGoManifest(ctx: RuleContext, file: string): string | null {
  const scope = goScopeOf(ctx) as GoScope & { resolve: (f: string) => string | null };
  const cached = scope.owner.get(file);
  if (cached !== undefined) return cached;
  const owner = scope.resolve(file);
  scope.owner.set(file, owner);
  return owner;
}

function ownedBy(ctx: RuleContext, manifest: string): (match: SourceMatch) => boolean {
  const own = dirOf(manifest);
  const deeper = goScopeOf(ctx)
    .dirs.map((d) => d.dir)
    .filter((dir) => dir !== own && dir.startsWith(own));

  return (match: SourceMatch) => {
    const file = match.file.replace(/\\/g, "/");
    if (!file.startsWith(own)) return false;
    return !deeper.some((dir) => file.startsWith(dir));
  };
}

function servesModern(ctx: RuleContext, forFile?: string): boolean {
  if (ctx.live && (ctx.live.era === "modern" || ctx.live.era === "dual")) return true;
  const scope = goScopeOf(ctx);
  if (!scope.anyEvidence) return false;
  if (!forFile) return true;

  // Go evidence speaks for the module it came from, and for nothing else. A
  // monorepo that migrated one module had otherwise acquitted every module
  // beside it: this repository's own `go-notes-mcp` fixture, dropped next to a
  // single migrated `go.mod`, lost both of its criticals — 60 points.
  //
  // Two boundaries, and the first bites hardest. A Go SDK version says nothing
  // whatsoever about a Python or TypeScript server, yet `dirOf("go.mod")` is
  // `""` and every path starts with `""` — so a Go module at the repository
  // root "owned" `server.py` and `index.ts`, and a polyglot repo with a Go
  // tooling module acquitted its Python MCP server. Non-Go evidence — the npm
  // v2 packages, a modern Python constraint — stays repository-wide as it was.
  //
  // A `.go` file above every `go.mod` belongs to no module, and no module's
  // state can be inferred about it either way; it falls back to the
  // repository-wide answer rather than being denied evidence that exists.
  if (!isGoPath(forFile)) return scope.hasNonGoEvidence;
  if (scope.hasNonGoEvidence) return true;
  const owner = owningGoManifest(ctx, forFile);
  if (owner === null) return scope.hasOrphanGoEvidence || scope.goEvidenceOwners.size > 0;
  return scope.goEvidenceOwners.has(owner);
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
      // The first match is not the right one to ask about — the first
      // *unacquitted* one is. Scoping the check to whichever match happened to
      // sort first made the verdict depend on directory names: with a modern
      // module named `a-modern` beside a legacy `z-legacy`, the modern
      // module's own dual-era `InitializedHandler:` was selected, found
      // acquitted, and the whole repository returned clean. Renaming the two
      // directories reversed the result on byte-identical files.
      const unacquitted = (signal: string): SourceMatch | undefined =>
        ctx.source?.matches[signal]?.find((m) => !servesModern(ctx, m.file));

      const live = ctx.live?.respondsToLegacyInitialize;
      if (live && servesModern(ctx)) return null;

      const v1PythonApi = unacquitted("pythonV1Sdk");
      const v1PythonRequirement = ctx.source?.pythonSdkRequirements?.some(
        (candidate) => candidate.sdkLine === "legacy",
      );
      const constrainedPythonServer = v1PythonRequirement
        ? unacquitted("pythonServerSdk")
        : undefined;
      const legacyPythonServer = v1PythonApi ?? constrainedPythonServer;
      const src = unacquitted("initialize") ?? legacyPythonServer;
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
      const src = ctx.source?.matches.sessionId?.find(
        (m) => !servesModern(ctx, m.file) && !goSdkUnclassifiable(ctx, m),
      );
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
  {
    id: "MCP010",
    title: "Rust MCP SDK on a pre-2026-07-28 line",
    severity: "warning",
    specRef: SPEC.rustSdk,
    // Per-SDK authoritative references — the owner wants each crate to cite
    // its own repo rather than one umbrella URL for all three SDKs.
    references: [SPEC.rustSdkReleases, SPEC.towerMcp, SPEC.rustMcpSdk],
    evaluate(ctx): Finding | null {
      const deps = ctx.source?.sdkDependencies ?? [];
      const RUST_MCP_CRATES = new Set(["rmcp", "rust-mcp-sdk", "tower-mcp"]);
      const rustMcpDeps = deps.filter(
        (d) => d.ecosystem === "cargo" && RUST_MCP_CRATES.has(d.name),
      );

      // A crate outside [dependencies] does not ship, or need not be used by
      // any workspace member. Naming the section lets the reader judge it
      // instead of reading every hit as a production problem.
      const where = (dep: SdkDependency): string =>
        dep.section && dep.section !== "dependencies" ? ` under [${dep.section}]` : "";

      // Every affected crate is collected: reporting only the first hides the
      // second until the first is fixed.
      const hits: { detail: string; fix: string; specRef: string; refs: string[] }[] = [];

      for (const dep of rustMcpDeps) {
        // rmcp 3.x IS the current line speaking spec 2026-07-28. Fire only on
        // major < 3 — using < 2 would repeat the MCP007 wrong-threshold bug.
        if (dep.name === "rmcp") {
          const majorMatch = dep.constraint.match(/^[~^]?(\d+)/);
          if (!majorMatch) continue; // Can't parse clearly, stay quiet
          const major = Number.parseInt(majorMatch[1], 10);
          if (!Number.isNaN(major) && major < 3) {
            hits.push({
              detail: `Cargo.toml depends on ${dep.name} (${dep.constraint})${where(dep)}. That is a pre-2026-07-28 line; rmcp 3.x is the current line speaking spec 2026-07-28.`,
              fix: "Upgrade rmcp to 3.x (the current line speaking spec 2026-07-28).",
              specRef: SPEC.rustSdk,
              refs: [SPEC.rustSdkReleases],
            });
          }
          continue;
        }
        // rust-mcp-sdk v1.x only speaks 2025-11-25; any v1.x is pre-2026-07-28.
        if (dep.name === "rust-mcp-sdk") {
          const majorMatch = dep.constraint.match(/^[~^]?(\d+)/);
          if (!majorMatch) continue; // Can't parse clearly, stay quiet
          const major = Number.parseInt(majorMatch[1], 10);
          if (!Number.isNaN(major) && major >= 2) continue; // v2.x speaks 2026-07-28
          hits.push({
            detail: `Cargo.toml depends on rust-mcp-sdk (${dep.constraint})${where(dep)}. That crate only speaks the 2025-11-25 protocol; migrate to rmcp 3.x or rust-mcp-sdk 2.x.`,
            fix: "Upgrade to rmcp 3.x or rust-mcp-sdk 2.x (both speak 2026-07-28).",
            specRef: SPEC.rustMcpSdk,
            refs: [SPEC.rustSdk, SPEC.rustSdkReleases],
          });
          continue;
        }
        // tower-mcp opts into the current spec via the protocol-2026-07-28
        // feature. Fire ONLY when features are parsed AND the flag is absent;
        // an unparsed dependency is silently skipped (no false positive).
        if (dep.name === "tower-mcp") {
          if (dep.features && !dep.features.includes("protocol-2026-07-28")) {
            hits.push({
              detail: `Cargo.toml depends on tower-mcp (${dep.constraint})${where(dep)} without the protocol-2026-07-28 feature. That crate speaks 2026-07-28 only when that feature is enabled.`,
              fix: "For tower-mcp, enable the protocol-2026-07-28 feature.",
              specRef: SPEC.towerMcp,
              refs: [SPEC.rustSdk, SPEC.rustSdkReleases],
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
        location: "Cargo.toml",
      };
    },
  },
  {
    id: "MCP011",
    title: "Go MCP SDK not serving the 2026-07-28 revision",
    severity: "warning",
    specRef: SPEC.sdk,
    references: [SPEC.goSdk, SPEC.markThreeLabsMcpGo],
    evaluate(ctx): Finding | null {
      const deps = (ctx.source?.sdkDependencies ?? []).filter((d) => d.ecosystem === "go");
      if (deps.length === 0) return null;

      // Every affected module is collected: reporting only the first hides the
      // second until the first is fixed. Same shape as MCP010.
      const hits: { detail: string; fix: string; location: string }[] = [];

      for (const dep of deps) {
        // An `// indirect` requirement is not this project's SDK choice — the
        // toolchain asserts nothing here imports it — and a `replace`d one
        // describes something the build does not use. Both are `unknown`, and
        // `unknown` is reported by nothing.
        // `replaced` alone is not a reason to skip. A replacement that names a
        // module and a version is perfectly readable, and `sdkLine` already
        // carries the verdict — an unreadable one is `unknown`. Skipping on the
        // flag let `replace X => X v1.6.1`, which changes nothing about the
        // build, clear the finding off a genuinely legacy server.
        if (dep.indirect || dep.sdkLine === "unknown") continue;

        if (dep.sdkLine === "legacy") {
          const target =
            dep.name === "github.com/mark3labs/mcp-go" ? "v1.0.0" : "v1.7.0";
          hits.push({
            location: `${dep.manifest}:${dep.line ?? 0}`,
            detail: `${dep.manifest} requires ${dep.name} ${clamp(dep.constraint)}, which is below ${target} — the first release of that module speaking 2026-07-28.`,
            fix: `Upgrade ${dep.name} to ${target} or later (\`go get ${dep.name}@${target}\`), then run your tests. The module path does not change: Go crossed the protocol break inside its existing major, so there is no v2 import path to rewrite.`,
          });
        }
      }

      // The second defect, and the one a version check alone cannot see. The
      // official SDK's streamable HTTP transport refuses the revision unless it
      // is stateless — `SupportsProtocolVersion` returns `t.Stateless && …`,
      // and the SDK announcement puts it plainly: "the streamable HTTP
      // transport accepts 2026-07-28 only when you set
      // StreamableHTTPOptions.Stateless = true. Leave it unset and clients
      // negotiate down to 2025-11-25."
      //
      // Scoped to the module that declares the requirement, because this is an
      // argument from absence and a repository-wide one was demonstrably
      // wrong: with a modern module beside a legacy one, it produced the
      // sentence "services/notes/go.mod requires v1.7.0 … but the transport at
      // legacy/demo/main.go is configured without Stateless" — a specific,
      // checkable claim about a file belonging to a different module.
      //
      // It fires only for the official SDK (mark3labs advertises the revision
      // by default), only when an HTTP transport is configured in that module
      // (a stdio server needs no flag and is the SDK's own headline example),
      // and only when the opt-in appears nowhere in it.
      for (const dep of deps) {
        if (dep.name !== "github.com/modelcontextprotocol/go-sdk") continue;
        if (dep.sdkLine !== "modern" || dep.indirect) continue;

        const owned = ownedBy(ctx, dep.manifest);
        const http = ctx.source?.matches.goStreamableHttp?.find(owned);
        if (!http) continue;
        if (ctx.source?.matches.goStatelessOptIn?.some(owned)) continue;

        hits.push({
          location: `${dep.manifest}:${dep.line ?? 0}`,
          detail: `${dep.manifest} requires ${dep.name} ${clamp(dep.constraint)}, which speaks 2026-07-28, but the streamable HTTP transport at ${http.file}:${http.line} is configured without \`Stateless\`. That transport serves the revision only when it is stateless; left as is, clients negotiate down to 2025-11-25.`,
          fix: "Set `Stateless: true` in `StreamableHTTPOptions`, and move any per-session state onto explicit handles passed as tool arguments. Upgrading the module is not enough on its own — serving the revision over HTTP is a separate, deliberate choice. A stdio server needs no such flag.",
        });
      }

      if (hits.length === 0) return null;

      // A monorepo can carry hundreds of modules on the same stale line, and
      // `readGoModDependencies` walks. Un-deduplicated, 5000 nested modules
      // produced a 1.4 MB `fix` that was one sentence repeated 5000 times, and
      // `scripts/action-report.mjs` writes `detail` straight into
      // GITHUB_STEP_SUMMARY, which GitHub caps at 1 MiB. Identical advice is
      // said once; the list of affected manifests is what gets truncated.
      const details = [...new Set(hits.map((h) => h.detail))];
      const shown = details.slice(0, 10);
      const detail =
        details.length > shown.length
          ? `${shown.join(" ")} …and ${details.length - shown.length} further module(s).`
          : shown.join(" ");

      return {
        ruleId: "MCP011",
        title: "Go MCP SDK not serving the 2026-07-28 revision",
        severity: "warning",
        detail,
        fix: [...new Set(hits.map((h) => h.fix))].join(" "),
        specRef: SPEC.sdk,
        references: [SPEC.goSdk, SPEC.markThreeLabsMcpGo],
        location: hits[0].location,
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
