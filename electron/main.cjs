// Defensive check: ELECTRON_RUN_AS_NODE forces the binary into a
// plain-Node shim where `require("electron")` returns the binary path
// string instead of the API.  Some sandboxes (CI runners, certain
// shells) export it by default, so guard with an explicit error
// rather than silently failing with a cryptic "app is undefined".
if (process.env.ELECTRON_RUN_AS_NODE) {
  console.error(
    "Refusing to start: ELECTRON_RUN_AS_NODE is set in the environment.",
  );
  console.error(
    "Unset it (`unset ELECTRON_RUN_AS_NODE`) and re-run `npm run electron:dev`.",
  );
  process.exit(1);
}

// In dev mode, watch electron/*.cjs for changes and relaunch automatically.
// watchRenderer: false because Vite HMR already handles renderer hot-reload.
// electron-reloader 2 is an ES module that wants `import.meta`, of which it
// reads only `url`. A failure is reported: swallowed, it would leave dev
// reloading off with no sign of why (the v1 call shape fails that way on v2).
if (process.env.ELECTRON_START_URL) {
  try {
    require("electron-reloader").default(
      { url: require("node:url").pathToFileURL(__filename).href },
      { watchRenderer: false },
    );
  } catch (err) {
    console.warn("[main] electron-reloader is off:", err.message);
  }
}

const electron = require("electron");
const { app, BrowserWindow, ipcMain, protocol, session, Menu } = electron;
const fsMod = require("fs");
const urlMod = require("url");

// Name the app so the macOS menu bar, About item, Hide/Quit labels, etc. all
// read "PurpleCAD" rather than "Electron" (set before `ready`).
app.setName("PurpleCAD");

// Registering as a standard scheme up front (before app `ready`) makes
// `app://`-served pages behave like HTTPS for fetch + worker semantics.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

const path = require("path");

// Load the native OCC addon and register IPC handlers so the renderer can
// invoke OCC operations without accessing Node.js or native modules directly.
// We defer the require to here so the ELECTRON_RUN_AS_NODE guard above fires
// before we attempt to load the addon.
// Host the OCC addon in a worker_thread so its synchronous native calls never
// block the main process event loop — a long boolean/chamfer used to freeze the
// whole window (no input, no spinner, no Cancel).  ONE worker only: the addon is
// single-threaded and keeps a shared shape store, so ops must serialise (they
// queue on the worker's event loop in FIFO order).
const { Worker } = require("worker_threads");
let occWorker = null;
const occPending = new Map();
let occNextId = 1;

// Shared cancel flag (one int32) the worker's native OCC builders poll to abort
// a long op mid-flight — genuine cancel that frees the CPU, without killing the
// worker (which shares OCC's non-thread-safe globals and crashes on terminate).
// We flip element 0 to 1 from THIS (main) thread while the worker is blocked in
// the synchronous native call; UserBreak in occ_kernel.cc sees it and throws.
const occCancelBuffer = new SharedArrayBuffer(4);
const occCancelView = new Int32Array(occCancelBuffer);

function failAllOcc(err) {
  for (const p of occPending.values()) p.reject(err);
  occPending.clear();
}

function startOccWorker() {
  const w = new Worker(path.join(__dirname, "occ-worker.cjs"), {
    workerData: { cancelBuffer: occCancelBuffer },
  });
  occWorker = w;
  w.on("message", (msg) => {
    if (msg.id == null) {
      if (msg.ready === false)
        console.warn("[main] OCC worker addon unavailable:", msg.error);
      return;
    }
    const p = occPending.get(msg.id);
    if (!p) return;
    occPending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
  });
  w.on("error", (e) => {
    console.error("[main] OCC worker error:", e.message);
    if (occWorker === w) failAllOcc(e);
  });
  w.on("exit", (code) => {
    if (occWorker === w) failAllOcc(new Error("OCC worker exited"));
    // A crash loses the native shape store; restart so the app keeps working (a
    // missing id just rebuilds from recipe on the next recalc).
    if (code !== 0 && occWorker === w) {
      console.warn("[main] OCC worker exited (" + code + "), restarting");
      startOccWorker();
    }
  });
}

function callOcc(op, args) {
  return new Promise((resolve, reject) => {
    if (!occWorker) return reject(new Error("OCC worker not started"));
    const id = occNextId++;
    occPending.set(id, { resolve, reject });
    occWorker.postMessage({ id, op, args });
  });
}

try {
  startOccWorker();
  const OCC_OPS = [
    "performCsg",
    "chamferOrFilletItem",
    "pushPullFaces",
    "shellItem",
    "holeItem",
    "embossItem",
    "draftItem",
    "revolveItem",
    "pipeItem",
    "loftItem",
    "exportSTL",
    "exportSTEP",
    "importStep",
    "splitItem",
    "tessellateItem",
    "pattern3dItem",
    "releaseShape",
    "solidFromMesh",
    "weldMesh",
    "simplifyMesh",
    "recognizeSurfaces",
    "rebuildSurfaces",
  ];
  for (const op of OCC_OPS)
    ipcMain.handle(`occ:${op}`, (_e, args) => callOcc(op, args));
  // Genuine cancel: flip the shared flag so the worker's in-flight native op
  // aborts (UserBreak) and frees the CPU.  The worker clears it before the next
  // op.  Cheap and non-destructive — the worker (and its shape store) survives.
  ipcMain.handle("occ:cancel", () => {
    Atomics.store(occCancelView, 0, 1);
    console.log("[OCC] cancel flag set (worker will abort current op)");
    return true;
  });
} catch (err) {
  console.warn("[main] OCC worker failed to start:", err.message);
}

// SQLite-backed persistence for renderer settings/data (replaces localStorage).
// The renderer loads what it needs once (db:bootstrap, db:loadProject), reads
// from that cache, and writes through asynchronously (db:call).  It used to
// call every one of these synchronously (sendSync), which an iPad web view has
// no equivalent of; the one synchronous channel left, db:callSync, is for the
// writes made while the window unloads, which an async message could lose.
const kvStore = require("./kvStore.cjs");
ipcMain.handle("db:bootstrap", () => kvStore.bootstrap());
ipcMain.handle("db:loadProject", (_e, pid) => kvStore.projectData(pid));
ipcMain.handle("db:call", (_e, call) => kvStore.call(call));
ipcMain.on("db:callSync", (e, call) => {
  e.returnValue = kvStore.call(call);
});
// ── Agent API transport ─────────────────────────────────────────────────────
// Requests arriving on the API socket (apiServer.cjs) are forwarded to the
// renderer, where the commands run against the live store and scene, and the
// reply comes back on "api:reply" with the same id.
const { startApiServer } = require("./apiServer.cjs");
let apiServer = null;
let apiSeq = 0;
const apiPending = new Map();
// webContents that have registered their API handler.  A request that arrives
// while the page is still loading -- or reloading -- would otherwise be sent
// to nobody and wait out the whole timeout.
const apiReady = new Set();

// Commands can legitimately take minutes (a boolean on a dense body, a solve),
// so this is a backstop against a page that died, not a performance budget.
const API_REPLY_TIMEOUT_MS = 15 * 60 * 1000;

const apiFailure = (code, message) =>
  Object.assign(new Error(message), { code });

function invokeRenderer(method, params) {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  if (!win || !apiReady.has(win.webContents.id))
    return Promise.reject(
      apiFailure(
        "APP_NOT_READY",
        "PurpleCAD is still starting; try again in a moment.",
      ),
    );
  const id = ++apiSeq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      apiPending.delete(id);
      reject(apiFailure("APP_TIMEOUT", "PurpleCAD did not reply."));
    }, API_REPLY_TIMEOUT_MS);
    apiPending.set(id, { resolve, reject, timer });
    win.webContents.send("api:request", { id, method, params });
  });
}

ipcMain.on("api:ready", (e) => {
  const wc = e.sender;
  apiReady.add(wc.id);
  wc.once("did-start-loading", () => apiReady.delete(wc.id));
  wc.once("destroyed", () => apiReady.delete(wc.id));
});

ipcMain.on("api:reply", (_e, { id, reply }) => {
  const pending = apiPending.get(id);
  if (!pending) return;
  apiPending.delete(id);
  clearTimeout(pending.timer);
  if (reply?.error)
    pending.reject(apiFailure(reply.error.code, reply.error.message));
  else pending.resolve(reply?.result);
});

// ── Agent API on/off ────────────────────────────────────────────────────────
// Off unless the user turns it on: while it runs, any process of this user can
// drive the model through the socket.  The choice is a setting the main
// process owns -- it must be read before the window exists -- so the renderer
// changes it through "api:setEnabled" rather than the settings table.
//
// --api-socket=<path> moves the socket.  The e2e suite gives every launch its
// own, so a test never collides with a PurpleCAD the user has open -- which,
// sharing userData, would otherwise own the default one.
const AGENT_API_SETTING = "agent_api_enabled";
const apiSocketPath = () =>
  app.commandLine.getSwitchValue("api-socket") ||
  path.join(app.getPath("userData"), "purplecad-api.sock");
const agentApiForced = () => app.commandLine.hasSwitch("agent-api");
const agentApiWanted = () =>
  agentApiForced() || kvStore.settingGet(AGENT_API_SETTING) === "1";
let apiProblem = null;

// The MCP shim the user registers with their client: bundled into the app's
// resources when packaged (scripts/build-mcp.mjs), the checkout's own file
// otherwise.  Either runs under this executable as plain Node.
const mcpShimPath = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "mcp", "purplecad-mcp.mjs")
    : path.join(__dirname, "..", "mcp", "purplecad-mcp.mjs");

function agentApiStatus() {
  return {
    supported: process.platform !== "win32",
    enabled: agentApiWanted(),
    forced: agentApiForced(),
    listening: apiServer != null,
    problem: apiProblem,
    socketPath: apiSocketPath(),
    command: process.execPath,
    shimPath: mcpShimPath(),
  };
}

// Starts or stops the socket to match `enabled`; resolves to the new status.
let apiChange = Promise.resolve();
function setAgentApi(enabled) {
  // One change at a time: a quick off/on must not start a second server
  // while the first is still closing.
  apiChange = apiChange.then(async () => {
    apiProblem = null;
    if (!enabled) {
      const server = apiServer;
      apiServer = null;
      await server?.close();
      return;
    }
    if (apiServer) return;
    if (process.platform === "win32") {
      apiProblem = "The agent API is not available on Windows yet.";
      return;
    }
    try {
      const server = await startApiServer({
        socketPath: apiSocketPath(),
        invoke: invokeRenderer,
      });
      if (server) {
        apiServer = server;
        console.log(`[api] listening on ${server.socketPath}`);
      } else {
        apiProblem =
          "Another PurpleCAD that is already running has the agent API.";
        console.warn(`[api] ${apiSocketPath()} belongs to another PurpleCAD`);
      }
    } catch (err) {
      apiProblem = `The agent API could not start: ${err.message}`;
      console.warn("[api] could not start:", err.message);
    }
  });
  return apiChange.then(agentApiStatus);
}

ipcMain.handle("api:status", () => agentApiStatus());
// The page's own clipboard API needs focus and permission and fails without
// either; the main process's does not.
ipcMain.handle("clipboard:writeText", (_e, text) =>
  electron.clipboard.writeText(String(text)),
);
ipcMain.handle("api:setEnabled", (_e, enabled) => {
  kvStore.settingSet(AGENT_API_SETTING, enabled ? "1" : "0");
  return setAgentApi(agentApiWanted());
});

// Links in the app (the license dialog's) open in the system browser.  Only
// http(s): the renderer must not be able to hand shell.openExternal a file://
// path or an application scheme.  Called through `electron.shell` each time,
// not a destructured copy, so the e2e suite can stand in for the browser.
const isWebUrl = (url) => {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};
ipcMain.handle("shell:openExternal", async (_e, url) => {
  if (!isWebUrl(url)) return false;
  await electron.shell.openExternal(url);
  return true;
});

// The launch-time update check.  Asked from main, not the renderer, so the
// page's CSP can keep refusing every outside connection.
const { checkForUpdate } = require("./updateCheck.cjs");
ipcMain.handle("update:check", () =>
  checkForUpdate(app.getVersion(), (url, init) =>
    electron.net.fetch(url, init),
  ),
);

// 512px source covers window/taskbar icon use across platforms; packaged
// builds get their app icon from `build.icon` in package.json instead.
const APP_ICON = path.join(
  __dirname,
  "..",
  "app-icons",
  "padded",
  "icon-512.png",
);

// Initial title shown before the page loads; the renderer then sets
// `document.title` to the same string, which Electron mirrors into the
// window/title bar via `page-title-updated`.
const { version: APP_VERSION } = require("../package.json");

function createWindow() {
  // Allow the renderer's Local Font Access API (queryLocalFonts) to enumerate
  // installed fonts for the sketch Text tool. The app only loads its own
  // bundled content, so granting this is safe; other permissions are denied.
  session.defaultSession.setPermissionRequestHandler(
    (_wc, permission, callback) => callback(permission === "local-fonts"),
  );
  // Chromium also asks SYNCHRONOUSLY whether a permission is held, and the
  // default answer for a page served from file:// is no -- so queryLocalFonts
  // could resolve empty in the packaged app while working in dev, which read
  // as the font list "sometimes" being incomplete.
  session.defaultSession.setPermissionCheckHandler(
    (_wc, permission) => permission === "local-fonts",
  );

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#101013",
    title: `PurpleCAD v${APP_VERSION}`,
    icon: APP_ICON,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  const DEV_URL = process.env.ELECTRON_START_URL || null;
  // Surface renderer console errors / failed loads in the main
  // process stdout so they show up in the terminal that started the
  // app — easier than opening DevTools every time something breaks.
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2) console.log(`[renderer ${level}] ${message}`);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`Renderer failed to load ${url}: ${desc} (${code})`);
  });
  // The app window only ever shows the app.  A link that tries to navigate it
  // or open a new window goes to the system browser instead (web links only);
  // anything else is dropped.  Same-origin navigation -- a dev-server reload
  // -- is left alone.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) electron.shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    let same = false;
    try {
      same = new URL(url).origin === new URL(win.webContents.getURL()).origin;
    } catch {}
    if (same) return;
    e.preventDefault();
    if (isWebUrl(url)) electron.shell.openExternal(url);
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // Load via the registered app:// scheme — `app://./index.html`
    // resolves to dist/index.html and lets fetch() pull other dist
    // assets (including opencascade.wasm) without falling foul of
    // Chromium's file:// fetch ban.
    win.loadURL("app://./index.html");
  }
}

// Application menu.  "About PurpleCAD" opens the SAME in-app About dialog the
// Settings dialog's About button does — main just tells the renderer to show it
// (menu:about), so there's one source of truth for the About contents.
function buildAppMenu() {
  const isMac = process.platform === "darwin";
  const openAbout = () => {
    const win =
      BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    win?.webContents.send("menu:about");
  };
  const aboutItem = { label: `About ${app.name}`, click: openAbout };
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              aboutItem,
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
    {
      role: "help",
      submenu: isMac ? [] : [aboutItem],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildAppMenu();
  // BrowserWindow's `icon` option doesn't reach the Dock on macOS, so the
  // Dock icon is set here -- in packaged builds too. A packaged build does
  // carry its own icon.icns, but recent macOS shrinks a bundle icon that
  // wasn't made with Apple's newer icon tooling into a grey rounded square in
  // the Dock; an icon set at runtime is shown as it is. (Making this dev-only,
  // on the untested assumption that the bundle's icon would look better, was
  // a visible regression.)
  // Behind its own try: this runs at the top of the whenReady handler, and a
  // throw here rejects that handler and skips everything below it INCLUDING
  // createWindow(). That happened once, when app-icons/ was missing from
  // `build.files` -- the packaged app ran with no window and said nothing.
  if (process.platform === "darwin" && app.dock) {
    try {
      app.dock.setIcon(APP_ICON);
    } catch (err) {
      console.warn("[main] could not set the Dock icon:", err.message);
    }
  }

  // Open the database before the window loads so the renderer's first
  // synchronous db read (during store init) finds it ready.
  try {
    // --db-path=<file> overrides the SQLite location (e2e runs point it at a
    // throwaway file so tests never touch the user's database).
    const dbPath =
      app.commandLine.getSwitchValue("db-path") ||
      path.join(app.getPath("userData"), "cad.sqlite");
    kvStore.init(dbPath);
  } catch (err) {
    console.warn("[main] SQLite KV store unavailable:", err.message);
  }

  // Serve dist files over `app://./<path>`.  protocol.handle is the modern API —
  // registerFileProtocol was deprecated in Electron 25 and removed in later
  // majors.  net.fetch on a file:// URL streams the dist file back.
  const DIST = path.join(__dirname, "..", "dist");
  const { resolveAppPath } = require("./resolveAppPath.cjs");
  protocol.handle("app", (request) => {
    const filePath = resolveAppPath(DIST, request.url);
    if (filePath == null) {
      return new Response("forbidden", { status: 403 });
    }
    if (!fsMod.existsSync(filePath)) {
      return new Response("not found", { status: 404 });
    }
    return electron.net.fetch(urlMod.pathToFileURL(filePath).toString());
  });

  createWindow();

  // The agent API runs only when the user has turned it on in Settings, or
  // when --agent-api forces it (the e2e suite, which never touches the
  // user's settings).
  if (agentApiWanted()) void setAgentApi(true);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// The socket file is removed on the way out, so the next launch finds it free
// rather than having to probe a stale one.
app.on("will-quit", () => {
  void apiServer?.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
