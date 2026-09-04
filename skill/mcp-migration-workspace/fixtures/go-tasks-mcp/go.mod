// NOTE: this is TEST MATERIAL for the mcp-migration checker, not a real
// project to "fix". This one is already correct — see the header of main.go.
// The go-sdk requirement is v1.7.0, the first release speaking 2026-07-28,
// and it is the ONLY evidence of that anywhere in this module: the SDK
// answers server/discover internally, so a migrated Go server contains no
// modern protocol literal to find. If the go.mod-derived evidence feed ever
// breaks, this fixture stops grading A and the regression is caught here.
module example.com/go-tasks-mcp

go 1.25.0

require github.com/modelcontextprotocol/go-sdk v1.7.0
