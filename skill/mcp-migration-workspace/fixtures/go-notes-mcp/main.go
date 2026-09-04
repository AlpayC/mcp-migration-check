// go-notes-mcp — a deliberately pre-2026-07-28 Go MCP server.
//
// TEST MATERIAL for the mcp-migration checker. Do NOT "fix" this fixture.
// Unlike its Rust and TypeScript siblings this one is genuinely broken on
// every count the checker reports: it is pinned to a go-sdk minor that cannot
// speak the current revision, it handles the legacy initialized lifecycle, it
// mints its own session ids, and it registers two capabilities the revision
// deprecates. It is the Go twin of acme-search-mcp, not of notes-mcp.
package main

import (
	"context"
	"log"
	"sync"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Per-session note storage, keyed by the protocol session id. This is the
// hazard MCP002 is about: the map only works while every request from a
// client lands on this one process.
var (
	mu    sync.Mutex
	notes = map[string][]string{}
)

type addArgs struct {
	Folder string `json:"folder"`
	Body   string `json:"body"`
}

func main() {
	server := mcp.NewServer(&mcp.Implementation{Name: "go-notes", Version: "v0.4.0"}, &mcp.ServerOptions{
		// A server-minted session id. The 2026-07-28 transport has no
		// protocol-level sessions at all.
		GetSessionID: func() string { return "notes-" + randomSuffix() },

		// The legacy initialized lifecycle. A modern client never sends it.
		InitializedHandler: func(ctx context.Context, req *mcp.InitializedRequest) {
			log.Printf("client initialized: %v", req.Session.InitializeParams())
		},
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "add_note",
		Description: "Append a note to a folder.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, args addArgs) (*mcp.CallToolResult, any, error) {
		mu.Lock()
		notes[req.Session.ID()] = append(notes[req.Session.ID()], args.Body)
		mu.Unlock()

		// The deprecated logging capability.
		_ = req.Session.Log(ctx, &mcp.LoggingMessageParams{
			Level: "info",
			Data:  "note added to " + args.Folder,
		})

		// The deprecated roots capability: asking the client where it keeps
		// its files, instead of taking a path as a tool argument.
		if roots, err := req.Session.ListRoots(ctx, &mcp.ListRootsParams{}); err == nil {
			log.Printf("client roots: %d", len(roots.Roots))
		}

		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: "stored"}},
		}, nil, nil
	})

	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		log.Printf("server failed: %v", err)
	}
}

func randomSuffix() string { return "0001" }
