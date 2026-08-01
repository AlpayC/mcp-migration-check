# Deploying the demo to Cloudflare Workers

The demo runs on the Cloudflare free plan. Everything below fits inside it.

## Version constraints

`@opennextjs/cloudflare` dropped Next.js 14 support in Q1 2026. This app runs
**Next 16 + React 19.2**, which satisfies the adapter's peer range
(`next >=15.5.18 <16 || >=16.2.6`, `wrangler ^4.86.0`).

### What the 14 → 16 jump actually required

Only one thing, but it was a hard blocker: **Next 16 builds with Turbopack by
default and fails the build outright if it finds a custom `webpack` block.**
This app had one — an `extensionAlias` mapping `.js` specifiers onto `.ts`
sources in `packages/core`.

Rather than opting out with `next build --webpack`, the cause was removed:
`tsconfig.base.json` moved from `NodeNext` to `Bundler` resolution, the relative
imports in `packages/core` lost their `.js` suffixes, and the webpack block went
away. Turbopack now resolves them natively, and the esbuild config that builds
the skill script got simpler too.

Nothing else applied. The app uses none of the request APIs that became async
and are now strictly enforced (`headers`, `cookies`, `params`, `searchParams`),
has no middleware to rename to `proxy`, no `next/image` usage, and the route
handler was already `force-dynamic`.

Node 20.9+ and TypeScript 5.1+ are now the minimums.

## Local development

```bash
npm install               # from the repo root, not from web/
npm run dev -w web        # http://localhost:3000
npm run build -w web      # production build, no Cloudflare involved
```

## Deploy

```bash
npm run deploy -w web
```

That runs `opennextjs-cloudflare build` (which invokes `next build`) and then
uploads the Worker. First run will ask you to authenticate with Wrangler.

`npm run preview -w web` runs the app locally in workerd instead of Node, which
catches runtime differences `next dev` cannot.

## Rate limiting

`/api/check` fetches a URL a stranger supplies, so it needs a brake. There are
two ways to do that on Cloudflare, and only one of them applies here.

**A WAF rate limiting rule does not work for this deployment.** WAF rules are
scoped to a *zone* — a domain in your Cloudflare account. This Worker is served
from `*.workers.dev`, which is not a zone you control, so there is nothing to
attach a rule to. That only becomes an option after putting the Worker on a
custom domain.

**The Workers rate limiting binding does work**, needs no zone, and is available
on the free plan at no extra charge. It is declared in `wrangler.jsonc`:

```jsonc
"ratelimits": [
  { "name": "CHECK_RATE_LIMITER", "namespace_id": "1001",
    "simple": { "limit": 20, "period": 60 } }
]
```

and consumed in `web/app/api/check/route.ts` before the body is even parsed,
keyed by `cf-connecting-ip` — a header Cloudflare's edge sets and a client
cannot forge. Over the limit returns `429` with `retry-after: 60`.

Note what this is not. Counting happens **per Cloudflare location** and is
eventually consistent, so a geographically spread caller gets more than 20/min
in total, and the boundary is approximate — a live test let 21 requests through
before the first `429`. Cloudflare describes the binding as "permissive,
eventually consistent, and intentionally designed to not be used as an accurate
accounting system". It is a brake against casual abuse, not a quota.

Requires Wrangler 4.36.0 or later; `period` accepts only `10` or `60`.

Application code deliberately holds no counter of its own. An in-process counter
is worthless on Workers: every isolate keeps its own copy and cold ones start at
zero, so it looks like protection while providing none.

## Why the compatibility flags matter

`wrangler.jsonc` sets two:

- `nodejs_compat` — Next.js needs the Node APIs. Required by the adapter.
- `global_fetch_strictly_public` — forces outbound `fetch()` onto the public
  internet rather than letting it resolve back into this zone. Since this app's
  entire purpose is fetching a URL a stranger typed in, that flag is a real
  second line of defence behind the SSRF guard in `packages/core/src/ssrf.ts`.

## What is *not* covered

- **DNS rebinding.** The SSRF guard inspects the hostname, so a name that
  resolves to a private address passes it. On Workers this matters far less than
  on a VPS — the runtime has no private network and no metadata endpoint to
  reach — but it is not nothing.
- **Redirects.** `probeEndpoint` follows them, and only the initial URL is
  validated. Same reasoning as above: on Workers the blast radius is other
  people's public servers, not your credentials. Worth tightening if this ever
  runs somewhere with a private network.

## About the `npm audit` output

`npm audit --omit=dev` reports three high-severity advisories. Both come in
transitively through `next`, and neither is reachable in this app. Checked on
Next 16.2.12:

**postcss (`GHSA-qx2v-qp2m-jg93`, `GHSA-6g55-p6wh-862q`, `GHSA-r28c-9q8g-f849`)**
— XSS on stringify, and arbitrary file read / path traversal via
`sourceMappingURL` in CSS comments. All three require attacker-controlled CSS to
pass through postcss. This app has exactly one stylesheet, `web/app/globals.css`,
written by us and compiled at build time. There is no path by which a visitor
supplies CSS. The affected copy is `next/node_modules/postcss`, which Next
bundles for its own pipeline.

**sharp (`GHSA-f88m-g3jw-g9cj`)** — inherited libvips CVEs. sharp is Next's
image optimizer. This app uses `next/image` nowhere and declares no `images`
binding in `wrangler.jsonc`, so the code never runs.

**Do not run `npm audit fix --force`.** Its proposed remedy is `next@14.2.35` —
a downgrade to the version this project deliberately migrated away from, which
also reintroduces the `ERESOLVE` conflict with `@opennextjs/cloudflare`. The
advisory range is `next 9.3.4-canary.0 - 16.3.0-preview.7`, i.e. every Next
release in existence; the fix has to come from upstream bumping its bundled
postcss. Recheck after a Next upgrade rather than trying to patch around it.

## Budget

Free plan gives 100,000 requests/day and 10ms CPU per request. The probe is
I/O-bound, and subrequest wait time does not count against CPU. The one place
that could have burned the budget — reading an unbounded response body — is
capped at 256 KB in `probeEndpoint`.
