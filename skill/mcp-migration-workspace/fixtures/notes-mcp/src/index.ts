import express from "express";
import session from "express-session";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { listNotes, readNote } from "./store.js";

// NOTE: we deliberately do not initialize any per-connection state here.
// Everything the tools need arrives in the tool input. See ADR-014.

const app = express();
app.use(express.json());

// The browser-facing admin UI (separate from MCP) still uses cookie sessions.
app.use(
  session({
    secret: process.env.ADMIN_SESSION_SECRET ?? "dev",
    resave: false,
    saveUninitialized: false,
  }),
);

app.get("/admin/whoami", (req, res) => {
  const sessionId = req.sessionID;
  res.json({ sessionId, user: (req.session as never as { user?: string }).user });
});

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "notes", version: "0.4.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description: "List note titles under an explicitly provided folder.",
      inputSchema: { folder: z.string(), limit: z.number().optional() },
    },
    async ({ folder, limit }) => {
      const notes = await listNotes(folder, limit ?? 50);
      return { content: [{ type: "text", text: JSON.stringify(notes) }] };
    },
  );

  server.registerTool(
    "read_note",
    {
      title: "Read a note",
      description: "Read one note by its absolute path.",
      inputSchema: { path: z.string() },
    },
    async ({ path }) => {
      return { content: [{ type: "text", text: await readNote(path) }] };
    },
  );

  return server;
}

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => void transport.close());
  await buildServer().connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(3000, () => console.error("notes-mcp on :3000"));
