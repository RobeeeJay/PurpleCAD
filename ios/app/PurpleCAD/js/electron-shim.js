// The renderer's window.electronAPI (electron/preload.cjs), provided by the
// iPad host over WebKit message handlers (WebViewController.swift).  Injected
// before the page's own scripts, after codec.js.
//
// Persistence is deliberately absent: without dbBootstrap, src/store/db.js
// keeps the document in the web view's localStorage.  Native SQLite replaces
// that in Phase 3.  The agent API socket and the app menu don't exist here.
(function () {
  const handlers = window.webkit.messageHandlers;
  window.electronAPI = {
    invokeOcc: async (op, args) => {
      if (op === "cancel") return handlers.occCancel.postMessage(null) ?? null;
      const reply = await handlers.occ.postMessage({
        op,
        payload: PurpleCodec.encode(args),
      });
      return PurpleCodec.decode(reply);
    },
    openExternal: (url) => handlers.openExternal.postMessage(String(url)),
    onMenuAbout: () => {},
  };
})();
