import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { claudeCodeCommand, claudeDesktopConfig } from "../mcpConfig.js";

// Paths as they are on a Mac: the data directory has a space in it, and a
// quote in a user's name must not end the shell word early.
const status = {
  command: "/Applications/PurpleCAD.app/Contents/MacOS/PurpleCAD",
  shimPath:
    "/Applications/PurpleCAD.app/Contents/Resources/mcp/purplecad-mcp.mjs",
  socketPath:
    "/Users/o'brien/Library/Application Support/PurpleCAD/purplecad-api.sock",
};

describe("MCP client configuration", () => {
  // The command is pasted into a shell, so what matters is the argv the
  // shell hands `claude`, not how the string looks.
  it.skipIf(process.platform === "win32")(
    "gives claude the paths intact when a shell splits the command",
    () => {
      const cmd = claudeCodeCommand(status);
      expect(cmd.startsWith("claude ")).toBe(true);
      const argv = execFileSync("sh", [
        "-c",
        `printf '%s\\n' ${cmd.slice("claude ".length)}`,
      ])
        .toString()
        .trimEnd()
        .split("\n");
      expect(argv, cmd).toEqual([
        "mcp",
        "add",
        "purplecad",
        "-e",
        "ELECTRON_RUN_AS_NODE=1",
        "-e",
        `PURPLECAD_API_SOCKET=${status.socketPath}`,
        "--",
        status.command,
        status.shimPath,
      ]);
    },
  );

  it("runs the shim under the app's own executable in Claude Desktop", () => {
    const config = JSON.parse(claudeDesktopConfig(status));
    expect(config.mcpServers.purplecad).toEqual({
      command: status.command,
      args: [status.shimPath],
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        PURPLECAD_API_SOCKET: status.socketPath,
      },
    });
  });
});
