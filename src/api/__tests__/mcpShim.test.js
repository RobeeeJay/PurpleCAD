// The MCP shim, driven by the MCP SDK's own client exactly as Claude Code or
// Claude Desktop drives it -- spawned over stdio -- against a stand-in for the
// running app. The Electron end of the same path is e2e/mcp.spec.js.
import { afterEach, describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { contentFrom, toolName, toolsFrom } from "../../../mcp/tools.mjs";

const require = createRequire(import.meta.url);
const { startApiServer } = require("../../../electron/apiServer.cjs");
const SHIM = fileURLToPath(
  new URL("../../../mcp/purplecad-mcp.mjs", import.meta.url),
);

// Spawning node and the SDK takes a second or two, against vitest's 5s.
const SPAWN_TIMEOUT = 30_000;

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

const COMMANDS = [
  {
    name: "feature.extrude",
    description: "Extrude a sketch region.",
    inputSchema: {
      type: "object",
      properties: { sketchId: { type: "integer" } },
    },
  },
  {
    name: "view.render",
    description: "Render the model.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function fakeApp(onCall) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcad-mcp-"));
  const socketPath = path.join(dir, "api.sock");
  const server = await startApiServer({
    socketPath,
    invoke: async (method, params) =>
      method === "list" ? COMMANDS : onCall(params),
  });
  cleanups.push(async () => {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return socketPath;
}

async function shimClient(socketPath) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SHIM],
    env: { ...process.env, PURPLECAD_API_SOCKET: socketPath },
    stderr: "pipe",
  });
  const client = new Client({ name: "shim-test", version: "0" });
  await client.connect(transport);
  cleanups.push(() => client.close());
  return client;
}

describe("commands as MCP tools", () => {
  it("turns dotted command names into names every client accepts", () => {
    expect(toolName("feature.extrude")).toBe("feature_extrude");
    const { tools, byTool } = toolsFrom(COMMANDS);
    for (const t of tools) expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(byTool.get("view_render")).toBe("view.render");
  });

  it("refuses two commands that would become the same tool", () => {
    expect(() => toolsFrom([{ name: "a.b" }, { name: "a_b" }])).toThrow(
      /both become tool "a_b"/,
    );
  });

  it("hands an image back as image content, with its details beside it", () => {
    const out = contentFrom({
      ok: true,
      result: { view: "iso", mimeType: "image/png", data: "iVBORw0K" },
    });
    expect(out.content[0]).toEqual({
      type: "image",
      data: "iVBORw0K",
      mimeType: "image/png",
    });
    expect(JSON.parse(out.content[1].text)).toEqual({
      view: "iso",
      mimeType: "image/png",
    });
  });

  it("marks a refusal as a tool error carrying its code", () => {
    const out = contentFrom({
      ok: false,
      error: { code: "NO_PROFILE", message: "x" },
    });
    expect(out.isError).toBe(true);
    expect(JSON.parse(out.content[0].text).code).toBe("NO_PROFILE");
  });
});

// The app does not start its agent API on Windows (electron/main.cjs): a path
// like this is a Unix socket, and Windows wants a named pipe instead.
const unixSocketsOnly = describe.skipIf(process.platform === "win32");

unixSocketsOnly("the shim, as an MCP client sees it", () => {
  it(
    "lists the app's commands as tools, and tells the agent how to use them",
    async () => {
      const client = await shimClient(
        await fakeApp(async () => ({ ok: true })),
      );
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual([
        "feature_extrude",
        "view_render",
      ]);
      expect(tools[0].inputSchema.properties.sketchId.type).toBe("integer");
      expect(client.getInstructions()).toMatch(/millimetres/);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "relays a call to the app under its own name, and the result back",
    async () => {
      const seen = [];
      const client = await shimClient(
        await fakeApp(async (params) => {
          seen.push(params);
          return { ok: true, result: { id: 7, volumeMm3: 19200 } };
        }),
      );
      const out = await client.callTool({
        name: "feature_extrude",
        arguments: { sketchId: 3 },
      });
      expect(seen).toEqual([
        { name: "feature.extrude", args: { sketchId: 3 } },
      ]);
      expect(JSON.parse(out.content[0].text)).toEqual({
        id: 7,
        volumeMm3: 19200,
      });
    },
    SPAWN_TIMEOUT,
  );

  it(
    "tells the agent, in the error, that PurpleCAD is not running",
    async () => {
      const client = await shimClient(
        path.join(os.tmpdir(), "no-such-purplecad.sock"),
      );
      await expect(client.listTools()).rejects.toThrow(/not running/);
      const out = await client.callTool({ name: "body_list", arguments: {} });
      expect(out.isError).toBe(true);
      expect(out.content[0].text).toMatch(/APP_NOT_RUNNING/);
    },
    SPAWN_TIMEOUT,
  );
});
