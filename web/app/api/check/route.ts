import { checkLive } from "@mcpcheck/core";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rate limiting runs on Cloudflare's binding, not on an in-process counter.
 *
 * A counter in module scope is worthless on any serverless runtime: each
 * isolate gets its own copy and cold ones start at zero, so the limit is
 * decorative while still looking like protection. The binding is enforced by
 * the runtime instead.
 *
 * It is deliberately not a WAF rule either — WAF rate limiting is scoped to a
 * zone, and this Worker is served from *.workers.dev. See DEPLOY.md.
 */
interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * The binding is declared in wrangler.jsonc, so it exists in production and in
 * `next dev` (next.config.mjs calls initOpenNextCloudflareForDev). Returning
 * null covers running the handler outside the adapter entirely — a plain
 * `next build && next start`, for instance.
 */
function rateLimiter(): RateLimiter | null {
  try {
    const { env } = getCloudflareContext();
    const binding = (env as unknown as { CHECK_RATE_LIMITER?: RateLimiter })
      .CHECK_RATE_LIMITER;
    return binding ?? null;
  } catch {
    return null;
  }
}

/**
 * `cf-connecting-ip` is set by Cloudflare's edge and cannot be spoofed by the
 * client — a forged header is overwritten before the Worker sees it. Callers
 * without one share a single bucket, which is the conservative choice.
 */
function clientKey(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? "unknown";
}

export async function POST(req: Request): Promise<NextResponse> {
  const limiter = rateLimiter();
  if (limiter) {
    const { success } = await limiter.limit({ key: clientKey(req) });
    if (!success) {
      return NextResponse.json(
        { error: "Too many checks from this address. Try again in a minute." },
        { status: 429, headers: { "retry-after": "60" } },
      );
    }
  }

  let url: unknown;
  try {
    ({ url } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof url !== "string" || url.length === 0) {
    return NextResponse.json({ error: "Provide a `url`." }, { status: 400 });
  }

  // SSRF guard stays ON here: this handler fetches a user-supplied URL
  // server-side, so it must refuse internal targets.
  const result = await checkLive(url, {
    enforceSsrfGuard: true,
    timeoutMs: 8000,
  });
  return NextResponse.json(result);
}
