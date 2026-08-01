import { checkLive } from "@mcpcheck/core";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rate limiting lives at the edge, not here.
 *
 * An in-process counter is worthless on any serverless runtime: each isolate
 * gets its own copy and cold ones start at zero, so the limit is decorative
 * while still looking like protection. Cloudflare's free plan includes one
 * rate-limiting rule — point it at this path. See DEPLOY.md.
 */
export async function POST(req: Request): Promise<NextResponse> {
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
