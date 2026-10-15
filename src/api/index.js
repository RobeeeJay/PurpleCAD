// The agent API: commands that build, inspect and render a model, callable by
// name with JSON arguments. See README.md beside this file for the contract.
//
// Each command module registers itself on import.

import "./commands/document.js";
import "./commands/variables.js";
import "./commands/sketch.js";
import "./commands/feature.js";
import "./commands/inspect.js";
import { callCommand, listCommands } from "./registry.js";

export { callCommand, listCommands };

// Exposed in EVERY build, unlike window.__store: the e2e suite drives it
// today, and the main-process transport reaches it the same way, so it is the
// app's real surface rather than a test hook.
if (typeof window !== "undefined") {
  window.__api = { call: callCommand, list: listCommands };
  // The socket's end: the main process forwards each request here.
  window.electronAPI?.onApiRequest?.(async (method, params) => {
    if (method === "list") return { result: listCommands() };
    if (method === "call")
      return { result: await callCommand(params?.name, params?.args ?? {}) };
    return {
      error: { code: "UNKNOWN_METHOD", message: `Unknown method "${method}".` },
    };
  });
}
