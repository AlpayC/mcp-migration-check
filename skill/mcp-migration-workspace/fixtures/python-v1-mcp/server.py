from mcp.server.fastmcp import Context, FastMCP

server = FastMCP("legacy-python")


@server.tool()
async def summarize(topic: str, ctx: Context) -> str:
    await ctx.info(f"Summarizing {topic}")
    sampled = await ctx.session.create_message(messages=[])
    roots = await ctx.session.list_roots()
    return f"{topic}: {sampled} ({len(roots.roots)} roots)"
