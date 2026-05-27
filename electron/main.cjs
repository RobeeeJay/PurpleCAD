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

const electron = require("electron");
const { app, BrowserWindow, protocol } = electron;
const fsMod = require("fs");
const urlMod = require("url");

// We serve the built dist over a custom `app://` scheme rather than
// `file://`.  OpenCascade.js's WASM loader uses `fetch()` to grab its
// .wasm file, and Chromium refuses fetches from `file://` origins by
// default — the renderer logged "both async and sync fetching of the
// wasm failed" until we routed asset loading through a real protocol.
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#101013",
    title: "untitled-cad",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
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

app.whenReady().then(() => {
  // Serve dist files over `app://./<path>`.  Handler decodes the URL
  // and pipes the matching dist file back via a stream response.
  const DIST = path.join(__dirname, "..", "dist");
  protocol.registerFileProtocol("app", (request, callback) => {
    const url = new urlMod.URL(request.url);
    // The host part of `app://./index.html` is "." — strip it.
    const pathname = decodeURIComponent(url.pathname);
    const filePath = path.normalize(path.join(DIST, pathname));
    // Refuse traversal outside dist/.
    if (!filePath.startsWith(DIST)) {
      callback({ error: -10 /* ACCESS_DENIED */ });
      return;
    }
    fsMod.stat(filePath, (err) => {
      if (err) callback({ error: -6 /* FILE_NOT_FOUND */ });
      else callback({ path: filePath });
    });
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
