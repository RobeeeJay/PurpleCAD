#!/usr/bin/env node
// PurpleCAD's MCP server: a stdio shim an MCP client (Claude Code, Claude
// Desktop) launches, which relays tool calls to a RUNNING PurpleCAD over its
// local API socket.
//
// The tools are not defined here. The app describes its own commands, with
// their JSON schemas, and this lists them fresh -- so a command added to
// src/api appears as a tool with nothing to change in this file.
//
// stdout is the MCP protocol. Anything written to it that is not a protocol
// message breaks the client, so every diagnostic goes to stderr.

import fs from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { AppConnection, defaultSocketPath } from "./socketClient.mjs";
import { contentFrom, toolsFrom } from "./tools.mjs";

// The bundle shipped inside the app (scripts/build-mcp.mjs) has no
// package.json beside it, so the build writes the version in.
const version =
  typeof __PURPLECAD_VERSION__ === "string"
    ? __PURPLECAD_VERSION__
    : JSON.parse(
        fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      ).version;
const socketPath = process.env.PURPLECAD_API_SOCKET || defaultSocketPath();
const app = new AppConnection(socketPath);

const INSTRUCTIONS = [
  "PurpleCAD is a parametric CAD app; these tools build and inspect the model open in it.",
  "All lengths are millimetres, in a Z-up frame (Z is height). Prefer named variables (variables_set) for dimensions you may change, and reference them in sketch constraints and extrude depths.",
  "Typical flow: sketch_create on a plane -> feature_extrude a closed region -> feature_boolean to combine or cut -> body_list to check sizes and volume -> view_render to LOOK at the result.",
  "Always render and look before reporting a part as done: dimension checks alone have passed parts that were plainly wrong.",
  "Every tool returns once the model has settled, so its result is already current. Errors come back with a code and a message saying what to change.",
].join(" ");

const server = new Server(
  { name: "purplecad", version },
  { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
);

let byTool = new Map();

async function refreshTools() {
  const { tools, byTool: map } = toolsFrom(await app.request("list"));
  byTool = map;
  return tools;
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  try {
    return { tools: await refreshTools() };
  } catch (err) {
    // Surfaced as an error rather than an empty list: a client showing no
    // tools at all gives nobody a reason.
    throw new McpError(ErrorCode.InternalError, err.message);
  }
});

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    // A tool the last listing did not know -- the app restarted with more
    // commands, or the client called before listing -- gets one fresh look.
    if (!byTool.has(params.name)) await refreshTools();
    const command = byTool.get(params.name);
    if (!command)
      return contentFrom({
        ok: false,
        error: {
          code: "UNKNOWN_TOOL",
          message: `PurpleCAD has no tool called "${params.name}".`,
        },
      });
    return contentFrom(
      await app.request("call", {
        name: command,
        args: params.arguments ?? {},
      }),
    );
  } catch (err) {
    return contentFrom({
      ok: false,
      error: { code: err.code ?? "ERROR", message: err.message },
    });
  }
});

await server.connect(new StdioServerTransport());
process.stderr.write(`[purplecad-mcp] ${version}, app socket ${socketPath}\n`);
