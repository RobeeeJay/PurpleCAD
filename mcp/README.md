# PurpleCAD MCP server

Lets an MCP client -- Claude Code, Claude Desktop -- build and inspect models in
a **running** PurpleCAD. The client launches this shim over stdio; the shim
talks to the app over a local socket; the app runs the commands in
`src/api` and replies.

```
MCP client --stdio--> purplecad-mcp.mjs --unix socket--> PurpleCAD (running)
```

The tools are the app's own commands, listed fresh from the app each time, so
the shim never has to change when a command is added. Dots become underscores
in tool names (`feature.extrude` is `feature_extrude`), because MCP clients
only accept `[a-zA-Z0-9_-]`.

## Setup

Start PurpleCAD first -- the shim relays to a running app and has no tools of
its own. Then register the shim with your client, from a checkout of this repo
(`npm install` done):

**Claude Code**

```sh
claude mcp add purplecad -- node /absolute/path/to/purple-cad/mcp/purplecad-mcp.mjs
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "purplecad": {
      "command": "node",
      "args": ["/absolute/path/to/purple-cad/mcp/purplecad-mcp.mjs"]
    }
  }
}
```

Node 18 or newer.

## The socket

PurpleCAD listens on `purplecad-api.sock` in its data directory --
`~/Library/Application Support/PurpleCAD/` on macOS, `~/.config/PurpleCAD/` on
Linux -- created readable by its owner only, with nothing listening on the
network. `PURPLECAD_API_SOCKET` points the shim somewhere else; PurpleCAD's
`--api-socket=<path>` moves the app's end to match.

A second PurpleCAD finds the socket taken and runs without one rather than
stealing it. Not yet available on Windows.

## When something is wrong

- **No tools, and "PurpleCAD is not running"**: the app is not open, or was
  started after the client listed tools. Start it and reconnect the server in
  your client.
- **A tool returns an error**: the app refused the command. The message says
  why and the `code` says which kind (see `src/api/README.md`); the model is
  unchanged.
