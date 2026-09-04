// NOTE: this is TEST MATERIAL for the mcp-migration checker, not a real
// project to "fix". The go-sdk requirement below is deliberately one minor
// behind the protocol break so the scan fires MCP011: v1.6.1 is the last
// release speaking 2025-11-25, and v1.7.0 is the first speaking 2026-07-28.
module example.com/go-notes-mcp

go 1.25.0

require github.com/modelcontextprotocol/go-sdk v1.6.1
