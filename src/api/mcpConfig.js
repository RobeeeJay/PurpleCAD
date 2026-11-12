// What a user pastes into their MCP client to reach this PurpleCAD: the app's
// own executable run as plain Node (ELECTRON_RUN_AS_NODE) on the shim, so no
// separate Node install or checkout is needed.  `status` is the main
// process's agentApiStatus().

const env = (status) => ({
  ELECTRON_RUN_AS_NODE: "1",
  PURPLECAD_API_SOCKET: status.socketPath,
});

// POSIX single quotes: the data directory has a space in it on macOS
// ("Application Support"), and nothing inside single quotes is expanded.
const quote = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

export function claudeCodeCommand(status) {
  const envArgs = Object.entries(env(status))
    .map(([k, v]) => `-e ${quote(`${k}=${v}`)}`)
    .join(" ");
  return `claude mcp add purplecad ${envArgs} -- ${quote(status.command)} ${quote(status.shimPath)}`;
}

export function claudeDesktopConfig(status) {
  return JSON.stringify(
    {
      mcpServers: {
        purplecad: {
          command: status.command,
          args: [status.shimPath],
          env: env(status),
        },
      },
    },
    null,
    2,
  );
}
