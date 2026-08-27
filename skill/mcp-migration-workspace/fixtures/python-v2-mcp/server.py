from mcp.server import MCPServer

server = MCPServer("modern-python")


@server.tool()
def echo(message: str) -> str:
    return message
