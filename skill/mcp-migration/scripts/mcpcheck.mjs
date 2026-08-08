#!/usr/bin/env node

// packages/core/src/rules.ts
var SPEC_BASE = "https://modelcontextprotocol.io/specification/2026-07-28";
var SPEC = {
  changelog: `${SPEC_BASE}/changelog`,
  transport: `${SPEC_BASE}/basic/transports/streamable-http`,
  logging: `${SPEC_BASE}/server/utilities/logging`,
  sampling: `${SPEC_BASE}/client/sampling`,
  roots: `${SPEC_BASE}/client/roots`,
  authorization: `${SPEC_BASE}/basic/authorization`,
  // The spec site has no SDK section — SDK releases are announced separately.
  // This is the document that states which SDK line speaks which revision.
  sdk: "https://blog.modelcontextprotocol.io/posts/sdk-betas-2026-07-28/"
};
var SPEC_VERIFIED_AT = {
  [SPEC.changelog]: "2026-08-01",
  [SPEC.transport]: "2026-08-01",
  [SPEC.logging]: "2026-08-01",
  [SPEC.sampling]: "2026-08-01",
  [SPEC.roots]: "2026-08-01",
  [SPEC.authorization]: "2026-08-01",
  // Checked against npm the following day, when the rename turned up.
  [SPEC.sdk]: "2026-08-02"
};
var rulesVerifiedAt = Object.values(SPEC_VERIFIED_AT).sort()[0];
function firstMatch(ctx, signal) {
  return ctx.source?.matches[signal]?.[0];
}
function loc(match) {
  return match ? `${match.file}:${match.line}` : void 0;
}
var rules = [
  {
    id: "MCP001",
    title: "Legacy initialize handshake",
    severity: "critical",
    specRef: SPEC.changelog,
    evaluate(ctx) {
      const live = ctx.live?.respondsToInitialize;
      const src = firstMatch(ctx, "initialize");
      if (!live && !src) return null;
      return {
        ruleId: "MCP001",
        title: "Legacy initialize handshake",
        severity: "critical",
        detail: live ? "The server responded to the legacy `initialize` handshake. The 2026-07-28 model is stateless and does not use the session-establishing handshake." : "Source references the `initialize` lifecycle, which the stateless model removes.",
        fix: "Remove the initialize/initialized handshake. Treat each request as self-contained; move any per-session setup into request-scoped context.",
        specRef: SPEC.changelog,
        location: live ? "live endpoint" : loc(src)
      };
    }
  },
  {
    id: "MCP002",
    title: "Session-id dependence",
    severity: "critical",
    specRef: SPEC.transport,
    evaluate(ctx) {
      const live = ctx.live?.sessionIdHeaderPresent;
      const src = firstMatch(ctx, "sessionId");
      if (!live && !src) return null;
      return {
        ruleId: "MCP002",
        title: "Session-id dependence",
        severity: "critical",
        detail: live ? "The server issued an `Mcp-Session-Id` header. Sessions are gone in the stateless model; sticky state tied to a session id will break behind a load balancer." : "Source relies on `Mcp-Session-Id` / session state. This is the classic hazard: in-memory state that silently breaks once requests no longer hit one instance.",
        fix: "Remove session-id routing. Servers that need cross-call state mint explicit handles and take them back as ordinary tool arguments; otherwise make handlers fully stateless.",
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
    evaluate(ctx) {
      const live = ctx.live?.advertisedCapabilities.includes("logging");
      const src = firstMatch(ctx, "logging");
      if (!live && !src) return null;
      return {
        ruleId: "MCP003",
        title: "Deprecated logging capability",
        severity: "warning",
        detail: live ? "The server advertises the deprecated `logging` capability." : "Source registers the deprecated `logging` capability.",
        fix: "Remove the logging capability and its handlers. Log to stderr on stdio transports, or use OpenTelemetry for observability.",
        specRef: SPEC.logging,
        location: live ? "live endpoint" : loc(src)
      };
    }
  },
  {
    id: "MCP004",
    title: "Deprecated sampling capability",
    severity: "warning",
    specRef: SPEC.sampling,
    evaluate(ctx) {
      const live = ctx.live?.advertisedCapabilities.includes("sampling");
      const src = firstMatch(ctx, "sampling");
      if (!live && !src) return null;
      return {
        ruleId: "MCP004",
        title: "Deprecated sampling capability",
        severity: "warning",
        detail: live ? "The server advertises/uses the deprecated `sampling` capability." : "Source references the deprecated `sampling` capability (createMessage).",
        fix: "Remove reliance on server-initiated sampling. Integrate directly with an LLM provider API, or return the raw material and let the client decide whether a model call is needed.",
        specRef: SPEC.sampling,
        location: live ? "live endpoint" : loc(src)
      };
    }
  },
  {
    id: "MCP005",
    title: "Deprecated roots capability",
    severity: "warning",
    specRef: SPEC.roots,
    evaluate(ctx) {
      const live = ctx.live?.advertisedCapabilities.includes("roots");
      const src = firstMatch(ctx, "roots");
      if (!live && !src) return null;
      return {
        ruleId: "MCP005",
        title: "Deprecated roots capability",
        severity: "warning",
        detail: live ? "The server advertises/uses the deprecated `roots` capability." : "Source references the deprecated `roots` capability.",
        fix: "Remove the roots capability. Pass directories or files via tool parameters, resource URIs, or server configuration instead.",
        specRef: SPEC.roots,
        location: live ? "live endpoint" : loc(src)
      };
    }
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
  }
];

// packages/core/src/engine.ts
var PENALTY = {
  critical: 30,
  warning: 15,
  info: 5
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
var INITIALIZE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "mcpcheck", version: "0.1.0" }
  }
};
var DEFAULT_MAX_BODY_BYTES = 256 * 1024;
async function probeEndpoint(url, opts = {}) {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8e3;
  const base = {
    reachable: false,
    sessionIdHeaderPresent: false,
    respondsToInitialize: false,
    advertisedCapabilities: [],
    authRequired: false,
    oauthResourceMetadata: false
  };
  let wwwAuthenticate = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      },
      body: JSON.stringify(INITIALIZE_BODY),
      signal: controller.signal
    });
    base.reachable = true;
    base.sessionIdHeaderPresent = res.headers.has("mcp-session-id");
    wwwAuthenticate = res.headers.get("www-authenticate");
    if (res.status === 401 || wwwAuthenticate !== null) {
      base.authRequired = true;
    }
    const text = await readCapped(
      res,
      opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
    ).catch(() => "");
    const payload = parseMaybeSse(text);
    if (payload && payload.result) {
      base.respondsToInitialize = true;
      const caps = payload.result.capabilities;
      if (caps && typeof caps === "object") {
        base.advertisedCapabilities = Object.keys(caps);
      }
    }
  } catch (err) {
    base.rawError = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }
  if (base.reachable) {
    base.oauthResourceMetadata = await checkOAuthMetadata(
      url,
      wwwAuthenticate,
      doFetch,
      timeoutMs
    ).catch(() => false);
  }
  return base;
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
var SCANNABLE = /* @__PURE__ */ new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".go"]);
var IGNORED_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", ".next", "out", "build"]);
var SIGNAL_PATTERNS = {
  initialize: /InitializeRequest|oninitialized|["']initialize["']|["']initialized["']/,
  sessionId: /[Mm]cp-[Ss]ession-[Ii]d|mcpSessionId|\bsessionId\b/,
  logging: /["']logging["']|LoggingLevel|\blogging\b\s*:\s*\{/,
  sampling: /["']sampling["']|createMessage|SamplingMessage|\bsampling\b\s*:\s*\{/,
  roots: /["']roots["']|ListRootsRequest|RootsCapability|\broots\b\s*:\s*\{/
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
  const sdkVersion = await readSdkVersion(dir);
  return { matches, sdkVersion, filesScanned };
}
async function readSdkVersion(dir) {
  try {
    const raw = await fs.readFile(path.join(dir, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    const dep = pkg.dependencies?.["@modelcontextprotocol/sdk"] ?? pkg.devDependencies?.["@modelcontextprotocol/sdk"];
    return typeof dep === "string" ? dep : null;
  } catch {
    return null;
  }
}
async function readIfSmallEnough(file, maxBytes) {
  let handle;
  try {
    handle = await fs.open(file, "r");
    const stat = await handle.stat();
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
      } else if (SCANNABLE.has(path.extname(e.name))) {
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
    checkedAt: (/* @__PURE__ */ new Date()).toISOString()
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
