import { checkLive } from "@mcpcheck/core";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tiny in-memory rate limit. For real deployments put a proper limiter in
// front (or use the platform's). This just stops trivial abuse of the demo.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

export async function POST(req: Request): Promise<NextResponse> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Rate limit reached. Try again in a minute." },
      { status: 429 },
    );
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
  const result = await checkLive(url, { enforceSsrfGuard: true, timeoutMs: 8000 });
  return NextResponse.json(result);
}
