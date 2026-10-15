// PurpleCAD's commands as MCP tools, and their replies as MCP content.
//
// Pure: no socket, no SDK, so the mapping is testable on its own.

// MCP tool names have to match ^[a-zA-Z0-9_-]{1,64}$ for the clients that
// matter -- Claude's API rejects anything else -- and the app's command names
// are dotted ("feature.extrude"), so the dots become underscores.
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export const toolName = (command) => command.replace(/\./g, "_");

export function toolsFrom(commands) {
  const byTool = new Map();
  const tools = commands.map(({ name, description, inputSchema }) => {
    const tool = toolName(name);
    if (!TOOL_NAME.test(tool))
      throw new Error(`Command "${name}" cannot be an MCP tool name.`);
    if (byTool.has(tool))
      throw new Error(
        `Commands "${byTool.get(tool)}" and "${name}" both become tool "${tool}".`,
      );
    byTool.set(tool, name);
    return { name: tool, description, inputSchema };
  });
  return { tools, byTool };
}

// A command's { ok, result | error } as an MCP tool result. An image result --
// view.render -- goes back as image content, which is what lets the agent
// actually look at what it built; everything else is JSON text.
export function contentFrom(reply) {
  if (!reply?.ok)
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            reply?.error ?? { code: "NO_REPLY", message: "No reply." },
            null,
            2,
          ),
        },
      ],
    };
  const result = reply.result;
  if (
    typeof result?.mimeType === "string" &&
    result.mimeType.startsWith("image/") &&
    typeof result.data === "string"
  ) {
    const { data, ...meta } = result;
    return {
      content: [
        { type: "image", data, mimeType: result.mimeType },
        { type: "text", text: JSON.stringify(meta) },
      ],
    };
  }
  return {
    content: [{ type: "text", text: JSON.stringify(result ?? null, null, 2) }],
  };
}
