const { contextBridge, ipcRenderer } = require("electron");

// The renderer's bridge to the main process: OCC operations, and persistence.
// Persistence is load-once and write-through, all asynchronous -- the same
// shape an iPad host provides -- apart from dbCallSync, which src/store/db.js
// uses only for writes made while the window is unloading.
contextBridge.exposeInMainWorld("electronAPI", {
  invokeOcc: (op, args) => ipcRenderer.invoke(`occ:${op}`, args),
  dbBootstrap: () => ipcRenderer.invoke("db:bootstrap"),
  dbLoadProject: (pid) => ipcRenderer.invoke("db:loadProject", pid),
  dbCall: (name, arg) => ipcRenderer.invoke("db:call", { name, arg }),
  dbCallSync: (name, arg) => ipcRenderer.sendSync("db:callSync", { name, arg }),
  // Agent API: the main process forwards socket requests here, the renderer
  // runs them (src/api) and replies with the same id.  Re-registering replaces
  // the previous handler rather than stacking a second one.
  onApiRequest: (handler) => {
    ipcRenderer.removeAllListeners("api:request");
    ipcRenderer.on("api:request", async (_e, { id, method, params }) => {
      let reply;
      try {
        reply = await handler(method, params);
      } catch (err) {
        reply = {
          error: {
            code: "RENDERER_ERROR",
            message: String(err?.message ?? err),
          },
        };
      }
      ipcRenderer.send("api:reply", { id, reply });
    });
    ipcRenderer.send("api:ready");
  },
  // Settings' agent API switch: main owns the setting and the socket.
  agentApiStatus: () => ipcRenderer.invoke("api:status"),
  setAgentApi: (enabled) => ipcRenderer.invoke("api:setEnabled", enabled),
  copyText: (text) => ipcRenderer.invoke("clipboard:writeText", text),
  // Open a web link in the system browser; resolves false for anything that
  // isn't http(s), which main refuses.
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  // Menu → renderer: the native "About PurpleCAD" item opens the in-app dialog.
  // Replaces any prior listener so a re-register can't stack duplicates.
  onMenuAbout: (cb) => {
    ipcRenderer.removeAllListeners("menu:about");
    ipcRenderer.on("menu:about", () => cb());
  },
});
