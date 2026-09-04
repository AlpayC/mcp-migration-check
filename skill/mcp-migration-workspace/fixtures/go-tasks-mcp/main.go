// go-tasks-mcp — a Go MCP server that is ALREADY on the current revision.
//
// TEST MATERIAL for the mcp-migration checker. Do NOT "fix" this fixture.
// It is the Go twin of notes-mcp and rust-notes-mcp: it looks like it has
// session problems and has none. There are two traps here, and an agent that
// "migrates" this server has FAILED.
//
// Trap 1 — the `sessionId` tool argument. `TaskArgs.SessionID` is a handle the
// CALLER passes back on the next call. That is not protocol session state; it
// is exactly what MCP002's own remediation asks for ("servers that need
// cross-call state mint explicit handles and take them back as ordinary tool
// arguments"). The official SDK ships the same pattern in its
// sequentialthinking example. Flagging it would tell a maintainer to undo the
// correct fix.
//
// Trap 2 — `adminSession`. A cookie-backed session for the operator web UI,
// on a different HTTP surface entirely, unrelated to MCP.
//
// The MCP transport is stateless: `Stateless: true` below is what makes the
// streamable HTTP transport serve 2026-07-28 at all. Without it the SDK
// negotiates clients down to 2025-11-25, which is the second thing MCP011
// reports — so removing that line is not a cleanup, it is a regression.
package main

import (
	"context"
	"log"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Operator UI session, cookie-backed. NOT an MCP session — there is none.
type adminSession struct {
	SessionID string `json:"sessionId"`
	Operator  string `json:"operator"`
}

// A caller-supplied handle, threaded through as an ordinary tool argument.
// Any instance can serve any request because nothing is held in this process.
type TaskArgs struct {
	SessionID string `json:"sessionId" jsonschema:"handle returned by a previous call, if any"`
	Step      string `json:"step"`
}

func main() {
	server := mcp.NewServer(&mcp.Implementation{Name: "go-tasks", Version: "v1.2.0"}, nil)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "advance_task",
		Description: "Advance a multi-step task and return the next handle.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, args TaskArgs) (*mcp.CallToolResult, any, error) {
		// The handle is derived from the arguments, then handed straight back.
		// Nothing is stored between calls.
		next := args.SessionID
		if next == "" {
			next = "task-1"
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: next + ": " + args.Step}},
		}, nil, nil
	})

	// Stateless is what serves the current revision over HTTP. Leave it set.
	handler := mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server { return server },
		&mcp.StreamableHTTPOptions{Stateless: true},
	)

	mux := http.NewServeMux()
	mux.Handle("/mcp", handler)
	mux.HandleFunc("/admin", func(w http.ResponseWriter, r *http.Request) {
		// The admin cookie, on its own surface, with its own lifetime.
		who := adminSession{SessionID: readCookie(r), Operator: "local"}
		log.Printf("admin request from %s", who.Operator)
		w.WriteHeader(http.StatusNoContent)
	})

	if err := http.ListenAndServe("localhost:8080", mux); err != nil {
		log.Printf("server failed: %v", err)
	}
}

func readCookie(r *http.Request) string {
	c, err := r.Cookie("admin_session")
	if err != nil {
		return ""
	}
	return c.Value
}
