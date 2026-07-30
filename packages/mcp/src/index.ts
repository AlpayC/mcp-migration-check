#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { checkLive, checkSource, type CheckResult } from "@mcpcheck/core";
import { z } from "zod";

/**
 * MCP server wrapping the migration checker. It gives an agent (Claude Desktop,
 * Claude Code, Cursor, …) two tools so it can check its own or another server's
 * readiness for the 2026-07-28 spec, then act on the findings itself.
 *
 * Note: this server targets the current stable 1.x SDK line. Building against
 * the 2026-07-28 (stateless) model itself means moving to the 2.x SDK; see the
 * README migration notes.
 */

function toText(result: CheckResult): string {
  const lines: string[] = [];
  lines.push(`Target: ${result.target} (${result.mode})`);
  if (result.inconclusive) {
    lines.push(`Result: inconclusive — ${result.note ?? "no detail"}`);
    return lines.join("\n");
  }
  lines.push(`Grade: ${result.grade.letter} (${result.grade.score}/100)`);
  if (result.note) lines.push(result.note);
  if (result.findings.length === 0) {
    lines.push("No breaking-change signals found.");
    return lines.join("\n");
  }
  lines.push("");
  for (const f of result.findings) {
    lines.push(`[${f.severity.toUpperCase()}] ${f.title} (${f.ruleId})`);
    if (f.location) lines.push(`  at ${f.location}`);
    lines.push(`  observed: ${f.detail}`);
    lines.push(`  fix: ${f.fix}`);
    lines.push(`  spec: ${f.specRef}`);
    lines.push("");
  }
  return lines.join("\n");
}

const server = new McpServer({
  name: "mcp-migration-check",
  version: "0.1.0",
});

server.registerTool(
  "check_migration_readiness",
  {
    title: "Check MCP migration readiness (live)",
    description:
      "Probe a running MCP server over HTTP and report readiness for the " +
      "2026-07-28 spec break (stateless model, OAuth 2.1, deprecated features). " +
      "Returns a graded report with per-finding fixes.",
    inputSchema: {
      url: z.string().url().describe("Base URL of the MCP endpoint to probe"),
      allowLocal: z
        .boolean()
        .optional()
        .describe("Allow localhost/private targets (default false; SSRF guard)"),
    },
  },
  async ({ url, allowLocal }) => {
    const result = await checkLive(url, { enforceSsrfGuard: !allowLocal });
    return {
      content: [{ type: "text", text: toText(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
);

server.registerTool(
  "scan_source_migration",
  {
    title: "Scan source for MCP migration issues",
    description:
      "Statically scan a repository directory for 2026-07-28 breaking-change " +
      "signals (session state, deprecated capabilities, pre-2.0 SDK pin). " +
      "Heuristic: findings are signals to review, not proof.",
    inputSchema: {
      path: z.string().describe("Absolute path to the repository directory"),
    },
  },
  async ({ path }) => {
    const result = await checkSource(path);
    return {
      content: [{ type: "text", text: toText(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio servers must not write to stdout; log to stderr.
  console.error("mcp-migration-check server running on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
