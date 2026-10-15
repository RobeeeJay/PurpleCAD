// The renderer's window.electronAPI (electron/preload.cjs), provided by the
// iPad host over WebKit message handlers (WebViewController.swift).  Injected
// before the page's own scripts, after codec.js.
//
// Persistence goes to the database thread (DbHost.swift, kvStore.cjs over
// SQLite).  There is no dbCallSync: src/store/db.js uses it only while the
// window unloads, and an iPad app is backgrounded, not unloaded -- db.js
// flushes on visibilitychange instead.  The agent API socket and the app
// menu don't exist here.
(function () {
  const handlers = window.webkit.messageHandlers;
  const db = async (method, arg) =>
    PurpleCodec.decode(
      await handlers.db.postMessage({ method, payload: PurpleCodec.encode(arg) }),
    );
  window.electronAPI = {
    invokeOcc: async (op, args) => {
      if (op === "cancel") return handlers.occCancel.postMessage(null) ?? null;
      const reply = await handlers.occ.postMessage({
        op,
        payload: PurpleCodec.encode(args),
      });
      return PurpleCodec.decode(reply);
    },
    dbBootstrap: () => db("bootstrap"),
    dbLoadProject: (pid) => db("loadProject", pid),
    dbCall: (name, arg) => db("call", { name, arg }),
    openExternal: (url) => handlers.openExternal.postMessage(String(url)),
    onMenuAbout: () => {},
  };
})();
