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

## What an Agent Can't Do Yet

There are nine tools, and between them an agent can build a part out of sketches, extrudes and booleans, look at it, and drive it with variables. That's a real part, and the e2e suite builds one. But it can't save that part, can't undo a mistake, and can't put a chamfer on it, so right now you can have a lovely conversation about a model that never leaves the app.

If you're adding a tool, this is the list to work from. If you're using one, it saves you asking for something that isn't there. I got all of this by reading the commands in `src/api/commands/` rather than by trying every tool from a client, apart from the one marked as measured.

### The Four That Matter

**Nothing leaves the app.** There's no save, open, or STL or STEP export, and no import either. An agent can't deliver a part or work on a file you already have. You have to go and press Save yourself.

**There's no way back.** No undo, no delete and no edit: the only reset is `document_new`, which throws away the whole document. Changing a variable is the one way to alter a part after it's built, so a wrong sketch means starting again.

**The agent can't read what it built.** `body_list` leaves out sketches, so a sketch can't be read back. Nor can the timeline. `sketch_create` returns how many closed regions it found but not which is which, so the `region` argument of `feature_extrude` is an informed guess.

**There's no way to name a face or an edge.** This is what keeps chamfer, fillet, push/pull, shell, draft, hole and sketching on a face out of the list, and it's a design question before it's a coding job. An agent can't click, and coordinates go stale as soon as a variable moves the part. The app's persistent face names (`side{k}`) are the obvious place to start, but nobody has tried exposing them yet.

### What's Missing, by Area

| Area | Not available |
| ---- | ------------- |
| Sketch shapes | Arc, ellipse, rectangle, text and cog. `sketch_create` takes line, circle, point and bezier. |
| Sketch editing | Adding to an existing sketch, trim, offset, mirror, patterns, project, and chamfered or filleted corners. |
| Sketch placement | Anything but XY, XZ and YZ with an offset, so no custom planes and no faces. |
| Solids | Primitives, revolve, sweep, pipe, loft, and the intersection boolean. A cut is a separate extrude and `feature_boolean`. |
| Modify | Chamfer, fillet, push/pull, shell, draft, hole, emboss, texture, and convert to surfaces. |
| Arrange | Move, rotate, scale, drop to ground, point to point, 3D mirror and patterns, and split. |
| Analysis | Measure, stress analysis, generative design, component motion and collision detection. |
| Document | Materials, components, resolution and switching project. |

### Problems in the Tools We Have

- **A misspelt constraint type succeeds and does nothing.** `sketch_create` only checks that `type` is a string, and the solver has no case for one it doesn't know. I measured this one: a constraint of type `"paralel"` comes back from `solveConstraints` with `ok: true` and a residual of 0. Your sketch is built, unconstrained, and nothing tells you.
- **The description undersells the constraints.** It lists coincident, horizontal, vertical, distance and point-to-line distance. Parallel, tangent, equal and `angleDimension` also get through, but an agent has no way to find that out, and nothing it can read explains the angle's `sense` field.
- **Shape coordinates are plain numbers.** Only constraints can use a formula, so a shape can't be placed by a variable directly.
- **A long operation is a long silence.** A command can wait up to 300 seconds before returning `TIMEOUT`, with no progress and no way to cancel.
- **`view_render` only has named views.** You get `iso`, `front`, `back`, `left`, `right`, `top` and `bottom` of everything visible. There's no custom angle, no section and no single body.
- **The tool list is read when the client connects.** Start PurpleCAD after your client and you have to reconnect the server, as the section above says.
- **It's Unix sockets only.** There's nothing for Windows yet, and a second running PurpleCAD gets no socket at all.

## Future Work

These are in the order I'd do them, which puts the things that make the interface useful ahead of the things that make it long. None of them is done because the first version aimed to prove that an agent could build and check a part at all, and it can.

1. **Reject unknown constraint types, and describe the ones we accept.** It's the smallest job here and the only one that fails silently.
2. **Save, open and export.** Until this exists every other tool produces something you can't keep.
3. **Undo, delete, and reading back sketches and the timeline.** An agent that can see its mistakes and reverse them doesn't need a new document for each one.
4. **`sketch_edit`, arcs and the remaining shapes.** Most real profiles have an arc in them somewhere.
5. **Move, rotate and primitives.** None of these needs face naming, so there's no reason for them to wait for it.
6. **Decide how to name faces and edges, then add the modify tools.** This is the big one. It gets a design note of its own before any code, because a poor naming scheme would be baked into every modify tool that uses it.
7. **Revolve, sweep, loft and the rest of the table.**

Every new command goes in `src/api/commands/` and the shim picks it up without changing, so most of this list is work in the app rather than here. `src/api/README.md` explains how to add one, and it's covered in `e2e/agent-api.spec.js`, which currently has 8 tests against the 4 in `e2e/mcp.spec.js`. Don't forget those tests: vitest can't reach the scene or the OCC bridge, so a green unit run says nothing about a command.
