import assert from "node:assert/strict";
import { test } from "node:test";

import { isSafePublicUrl } from "../src/ssrf";

/**
 * The SSRF guard is the only thing between the public /api/check handler and an
 * attacker using this service as an outbound HTTP client against internal
 * addresses. It had no coverage at all until this file existed.
 *
 * When adding a range to `ssrf.ts`, add both a blocked case and the adjacent
 * allowed case here — most of the bugs in code like this are off-by-one at the
 * edge of a CIDR block, not a missing range.
 */

const BLOCKED: Array<[string, string]> = [
  ["https://localhost/mcp", "hostname localhost"],
  ["https://ip6-localhost/mcp", "hostname ip6-localhost"],
  ["https://metadata.google.internal/mcp", "GCP metadata hostname"],
  ["http://127.0.0.1:3000/mcp", "IPv4 loopback"],
  ["http://127.13.37.1/mcp", "anywhere in 127.0.0.0/8"],
  ["http://0.0.0.0/mcp", "0.0.0.0/8"],
  ["http://10.0.0.1/mcp", "10.0.0.0/8"],
  ["http://172.16.0.1/mcp", "bottom of 172.16.0.0/12"],
  ["http://172.31.255.255/mcp", "top of 172.16.0.0/12"],
  ["http://192.168.1.1/mcp", "192.168.0.0/16"],
  ["http://169.254.169.254/latest/meta-data", "cloud metadata address"],
  ["http://100.64.0.1/mcp", "bottom of CGNAT 100.64.0.0/10"],
  ["http://100.127.255.255/mcp", "top of CGNAT 100.64.0.0/10"],
  ["http://[::1]/mcp", "IPv6 loopback"],
  ["http://[::]/mcp", "IPv6 unspecified"],
  ["http://[fe80::1]/mcp", "IPv6 link-local"],
  ["http://[fd00::1]/mcp", "IPv6 unique-local fd"],
  ["http://[fc00::1]/mcp", "IPv6 unique-local fc"],
  ["http://[::ffff:127.0.0.1]/mcp", "IPv4-mapped IPv6"],
  ["http://999.1.1.1/mcp", "malformed IPv4 octet"],
  ["file:///etc/passwd", "non-http scheme"],
  ["ftp://example.com/mcp", "non-http scheme"],
  ["gopher://example.com/mcp", "non-http scheme"],
  ["not a url at all", "unparseable"],
];

for (const [url, why] of BLOCKED) {
  test(`blocks ${url} (${why})`, () => {
    const result = isSafePublicUrl(url);
    assert.equal(result.ok, false, `expected ${url} to be refused`);
    assert.ok(result.reason, "a refusal must carry a reason for the UI");
  });
}

const ALLOWED: Array<[string, string]> = [
  ["https://example.com/mcp", "ordinary public hostname"],
  ["http://example.com/mcp", "plain http is allowed"],
  ["https://mcp.notion.com/mcp", "real public MCP endpoint"],
  ["http://93.184.216.34/mcp", "public IPv4 literal"],
  ["http://172.15.0.1/mcp", "just below 172.16.0.0/12"],
  ["http://172.32.0.1/mcp", "just above 172.16.0.0/12"],
  ["http://192.169.1.1/mcp", "adjacent to 192.168.0.0/16"],
  ["http://100.63.255.255/mcp", "just below CGNAT"],
  ["http://100.128.0.1/mcp", "just above CGNAT"],
  ["http://11.0.0.1/mcp", "adjacent to 10.0.0.0/8"],
  ["http://[2606:4700::1]/mcp", "public IPv6"],
];

for (const [url, why] of ALLOWED) {
  test(`allows ${url} (${why})`, () => {
    const result = isSafePublicUrl(url);
    assert.equal(result.ok, true, `expected ${url} to pass: ${result.reason ?? ""}`);
  });
}

test("hostname matching is case-insensitive", () => {
  assert.equal(isSafePublicUrl("https://LOCALHOST/mcp").ok, false);
  assert.equal(isSafePublicUrl("https://Metadata.Google.Internal/").ok, false);
});
