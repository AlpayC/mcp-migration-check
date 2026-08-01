import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { search } from "./search.js";

/** Per-session transports, keyed by the Mcp-Session-Id we hand out. */
const transports: Record<string, StreamableHTTPServerTransport> = {};

/** Cached tenant config, resolved once per session during initialize. */
const tenantBySession = new Map<string, { tenantId: string; region: string }>();

function buildServer(sessionId: string): McpServer {
  const server = new McpServer(
    { name: "acme-search", version: "2.3.1" },
    {
      capabilities: {
        tools: {},
        logging: {},
        roots: { listChanged: true },
      },
    },
  );

  server.registerTool(
    "search_documents",
    {
      title: "Search Acme documents",
      description: "Full-text search across the tenant's document set.",
      inputSchema: { query: z.string(), limit: z.number().optional() },
    },
    async ({ query, limit }) => {
      const tenant = tenantBySession.get(sessionId);
      if (!tenant) throw new Error("Session not initialized");
      const hits = await search(tenant.tenantId, query, limit ?? 10);
      await server.server.sendLoggingMessage({
        level: "info",
        data: `search "${query}" -> ${hits.length} hits`,
      });
      return { content: [{ type: "text", text: JSON.stringify(hits) }] };
    },
  );

  return server;
}

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const existing = req.headers["mcp-session-id"] as string | undefined;

  if (existing && transports[existing]) {
    await transports[existing].handleRequest(req, res, req.body);
    return;
  }

  const sessionId = randomUUID();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId,
    onsessioninitialized: async (sid) => {
      tenantBySession.set(sid, await resolveTenant(req));
    },
  });

  transports[sessionId] = transport;
  transport.onclose = () => {
    delete transports[sessionId];
    tenantBySession.delete(sessionId);
  };

  await buildServer(sessionId).connect(transport);
  await transport.handleRequest(req, res, req.body);
});

async function resolveTenant(req: express.Request) {
  const key = req.headers["x-api-key"];
  if (!key) throw new Error("missing api key");
  return { tenantId: String(key).split(":")[0], region: "eu-central-1" };
}

app.listen(3000, () => console.log("acme-search-mcp on :3000"));
