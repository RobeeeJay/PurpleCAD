// Phase 2's "done when": an MCP client -- the SDK's own, spawning the real
// shim over stdio, exactly as Claude Code does -- builds a part in a running
// PurpleCAD. Everything between the client and the model is the shipped path:
// shim, socket, main process, renderer, command layer, store, OCC bridge.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { test, expect } from "./fixtures.js";
import { apiSocketFor, launchApp, makeDataDir } from "./launch.js";

const SHIM = fileURLToPath(
  new URL("../mcp/purplecad-mcp.mjs", import.meta.url),
);

let app;
let page;
let client;

const tool = async (name, args = {}) => {
  const out = await client.callTool({ name, arguments: args });
  expect(out.isError, `${name}: ${out.content?.[0]?.text}`).toBeFalsy();
  const text = out.content.find((c) => c.type === "text")?.text;
  return { out, result: text ? JSON.parse(text) : null };
};

test.describe.serial("MCP", () => {
  test.beforeAll(async () => {
    const dataDir = makeDataDir();
    app = await launchApp(dataDir);
    page = await app.firstWindow();
    page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();

    const socketPath = apiSocketFor(dataDir);
    await expect
      .poll(() => fs.existsSync(socketPath), { timeout: 30_000 })
      .toBe(true);
    client = new Client({ name: "purplecad-e2e", version: "0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [SHIM],
        env: { ...process.env, PURPLECAD_API_SOCKET: socketPath },
        stderr: "pipe",
      }),
    );
  });

  test.afterAll(async () => {
    await client?.close();
    await app?.close();
  });

  test("an MCP client sees PurpleCAD's commands as tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const name of [
      "document_new",
      "variables_set",
      "sketch_create",
      "feature_extrude",
      "feature_boolean",
      "body_list",
      "view_render",
    ])
      expect(names).toContain(name);
    expect(client.getInstructions()).toMatch(/Z-up/);
  });

  test("builds a part in the running app over MCP", async () => {
    await tool("document_new", { discardCurrent: true });
    await tool("variables_set", {
      variables: [
        { name: "Width", value: 60 },
        { name: "Depth", value: 40 },
      ],
    });
    const line = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
    const plateSketch = (
      await tool("sketch_create", {
        plane: "XY",
        shapes: [
          line(-30, -20, 30, -20),
          line(30, -20, 30, 20),
          line(30, 20, -30, 20),
          line(-30, 20, -30, -20),
        ],
      })
    ).result;
    expect(plateSketch.closedRegions).toBe(1);
    const plate = (
      await tool("feature_extrude", { sketchId: plateSketch.id, depth: 6 })
    ).result;
    const bossSketch = (
      await tool("sketch_create", {
        plane: "XY",
        offset: 6,
        shapes: [{ type: "circle", cx: 0, cy: 0, r: 8 }],
      })
    ).result;
    const boss = (
      await tool("feature_extrude", { sketchId: bossSketch.id, depth: 12 })
    ).result;
    const part = (
      await tool("feature_boolean", {
        operation: "union",
        target: plate.id,
        tools: [boss.id],
      })
    ).result;
    expect(part.bboxMm.size[0]).toBeCloseTo(60, 1);
    expect(part.bboxMm.size[2]).toBeCloseTo(18, 1);

    // The same body, seen from inside the app: the MCP client really did build
    // in THIS running PurpleCAD, not in some copy of it.
    const inApp = await page.evaluate(() => window.__api.call("body.list", {}));
    expect(inApp.result.bodies.map((b) => b.id)).toEqual([part.id]);
  });

  test("hands a render back as an image the agent can look at", async ({}, testInfo) => {
    const { out } = await tool("view_render", {
      view: "iso",
      width: 640,
      height: 480,
    });
    const image = out.content.find((c) => c.type === "image");
    expect(image.mimeType).toBe("image/png");
    const png = Buffer.from(image.data, "base64");
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const file = testInfo.outputPath("mcp-iso.png");
    fs.writeFileSync(file, png);
    await testInfo.attach("mcp-iso", { path: file, contentType: "image/png" });
  });

  test("reports a refusal as a tool error, not a failed connection", async () => {
    const out = await client.callTool({
      name: "feature_extrude",
      arguments: { sketchId: 987654, depth: 5 },
    });
    expect(out.isError).toBe(true);
    expect(JSON.parse(out.content[0].text).code).toBe("NOT_FOUND");
    // And the connection is still good afterwards.
    expect((await tool("body_list")).result.bodies.length).toBe(1);
  });
});
