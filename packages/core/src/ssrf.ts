/**
 * SSRF guard.
 *
 * The hosted demo fetches a user-supplied URL server-side, so it must refuse
 * to reach internal targets: localhost, private ranges, link-local, and the
 * cloud metadata endpoint. A security tool that is itself an SSRF pivot would
 * be the headline you don't want.
 *
 * This validates the hostname/literal-IP in the URL. For defense in depth,
 * also restrict egress at the container/network level in production — do not
 * rely on this check alone against DNS-rebinding.
 */

export interface UrlCheck {
  ok: boolean;
  reason?: string;
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
]);

export function isSafePublicUrl(raw: string): UrlCheck {
  let u: URL;
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
    // IPv6 literal
    if (isPrivateIpv6(host)) {
      return { ok: false, reason: "Refusing to reach a private/reserved IPv6 address." };
    }
  }

  return { ok: true };
}

function isIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isPrivateIpv4(ip: string): boolean {
  const p = ip.split(".").map((n) => Number.parseInt(n, 10));
  if (p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → block
  const [a, b] = p;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const h = ip.toLowerCase();
  if (h === "::1" || h === "::") return true; // loopback / unspecified
  if (h.startsWith("fe80")) return true; // link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique local
  if (h.startsWith("::ffff:")) return true; // IPv4-mapped — treat as unsafe
  return false;
}
