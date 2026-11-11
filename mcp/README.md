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

The agent API is off until you turn it on. While it runs, any program running
as you can drive the model through its socket, so it is a choice rather than
a default.

1. Open **Settings** and set **AI agent access (MCP)** to **On**. The row then
   says where it is listening.
2. Click **Copy Claude Code command** and paste it into a terminal, or
   **Copy Claude Desktop config** and merge it into
   `claude_desktop_config.json`.
3. Keep PurpleCAD open while the agent works -- the shim relays to a running
   app and has no tools of its own.

The copied setup runs the shim with PurpleCAD's own executable acting as Node
(`ELECTRON_RUN_AS_NODE=1`), so you need neither Node nor a checkout. In a
packaged app the shim is a single bundled file in the app's resources
(`npm run mcp:build`, `scripts/build-mcp.mjs`); started from a checkout,
Settings points at `mcp/purplecad-mcp.mjs` instead. The Claude Code command
for a Mac install comes out like this:

```sh
claude mcp add purplecad -e 'ELECTRON_RUN_AS_NODE=1' \
  -e 'PURPLECAD_API_SOCKET=/Users/you/Library/Application Support/PurpleCAD/purplecad-api.sock' \
  -- '/Applications/PurpleCAD.app/Contents/MacOS/PurpleCAD' \
  '/Applications/PurpleCAD.app/Contents/Resources/mcp/purplecad-mcp.mjs'
```

Every path is single-quoted because the data directory has a space in it.

From a checkout you can still register the shim with Node 18 or newer
directly, as before:

```sh
claude mcp add purplecad -- node /absolute/path/to/purple-cad/mcp/purplecad-mcp.mjs
```

PurpleCAD's `--agent-api` switch turns the API on for one launch whatever the
setting says; the e2e suite uses it, and Settings then shows the switch as
fixed for that launch.

## The socket

PurpleCAD listens on `purplecad-api.sock` in its data directory --
`~/Library/Application Support/PurpleCAD/` on macOS, `~/.config/PurpleCAD/` on
Linux -- created readable by its owner only, with nothing listening on the
network. `PURPLECAD_API_SOCKET` points the shim somewhere else; PurpleCAD's
`--api-socket=<path>` moves the app's end to match.

A second PurpleCAD finds the socket taken and runs without one rather than
stealing it. Not yet available on Windows.

## When something is wrong

- **No tools, and "PurpleCAD is not running"**: the app is not open, its
  agent API is off in Settings, or it was started after the client listed
  tools. Start it, check the setting, and reconnect the server in your client.
- **A tool returns an error**: the app refused the command. The message says
  why and the `code` says which kind (see `src/api/README.md`); the model is
  unchanged.
