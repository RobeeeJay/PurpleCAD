# PurpleCAD for iPad

The iPad app hosts the desktop renderer unchanged in a WKWebView. It runs the
OCC ops through the unchanged `electron/occ-bridge.cjs`, inside a
JavaScriptCore context on a dedicated thread. The core of the native addon is
shared with the desktop. Phase 1 of the iPad port split it out
(`native/occ-addon/src/occ_js.h`); this is Phase 2.

| Desktop (Electron) | iPad |
|---|---|
| `app://` protocol serving `dist/` | `AppSchemeHandler.swift` serving the same `dist/` (copied in as `web/`) |
| `preload.cjs`'s `window.electronAPI` | `js/electron-shim.js`, over WebKit message handlers |
| IPC with structured clone | `js/codec.js`: JSON, with typed arrays as base64 |
| The OCC worker thread running `occ-bridge.cjs` | `OccHost.swift`: one thread, a 16 MB stack, JavaScriptCore running `occ-bridge.cjs` (`js/occ-host.js` loads it) |
| `napi_binding.cc` | `jsc_binding.cc` |
| The `SharedArrayBuffer` cancel flag | An int32 Swift owns, set with `OccSetCancelFlag` |
| SQLite (`db.js`, through `dbBootstrap`) | Not yet: `db.js` falls back to the web view's `localStorage`, which survives a relaunch. Native SQLite is Phase 3. |

## Building and running

OCCT 8.0.1 for iOS comes from `ios/spike/build.sh` (`~/occ-8.0.1-ios`,
`~/occ-8.0.1-iossim`).

```bash
ios/app/build.sh sim                  # vite build, then the simulator app
ios/app/build.sh device <UDID>        # the same for a connected iPad
```

Regenerate the Xcode project after adding a source file:
`python3 ios/app/scripts/gen-project.py`. It reads the core's source list and
OCCT libraries from the addon's `CMakeLists.txt`, so the two can't drift.

## The smoke run

Launched with `--smoke`, the app runs `js/smoke.js` once the page loads:
- the agent-API plate flow from `e2e/agent-api.spec.js`: a plate sized by
  variables, a boss, a union, a variable change, a rebuild check and a render;
- a cancel check.

It prints each check and exits 0 only if all hold. It also writes the render to
the app's `Documents/smoke-iso.png`.

```bash
# simulator
xcrun simctl install booted ios/app/build/Release-iphonesimulator/PurpleCAD.app
xcrun simctl launch --console-pty --terminate-running-process booted \
  com.robeesworld.purplecad --smoke
# iPad (unlocked)
xcrun devicectl device install app --device <UDID> ios/app/build/Release-iphoneos/PurpleCAD.app
xcrun devicectl device process launch --console --terminate-existing \
  --device <UDID> com.robeesworld.purplecad --smoke
```

### Results (2026-10-08)

iPad Air 11-inch (M4) simulator: every check passed.
- The app was ready in 1.2 s.
- The flow up to the render took 4.3 s.
- The union and the rebuild match the e2e figures (60 x 40 x 8; 80 x 40 x 18
  after Width = 80; volume within 0.1 %).
- The render showed the plate with its boss.
- Cancel: the 2000-gon union took 3.3 s uncancelled. Cancelled 300 ms in, it
  returned after 308 ms. With the Swift flag left unregistered, the same check
  fails (`returned 9384 triangles after 3482 ms`), so the check can tell.

The simulator runs on the Mac's CPU, so these are not iPad timings.

## Findings worth keeping

- **A cancelled boolean returns; it doesn't throw.** `BooleanOp` takes
  `Shape()` without checking `IsDone()`, so a cancelled union comes back with
  an empty or partial mesh. The desktop behaves the same: `occClient`'s cancel
  epoch discards the result. The smoke check therefore measures time, and
  checks the result isn't the full one.
- **The simulator build must exclude x86_64.** OCCT for the simulator is
  arm64 only. A generic simulator destination otherwise also links x86_64 and
  fails on every OCCT symbol.
- **`localStorage` persists for the `app://` origin.** A relaunch reopened
  the smoke run's document with its whole timeline. Until Phase 3 that is the
  app's storage.

## Not yet

- Native SQLite, projects, Files-app `.pcad` (Phase 3).
- Touch, Pencil and keyboard (Phase 4). The renderer still expects a mouse and
  a trackpad.
- Layout (Phase 5): portrait leaves the 3D view cramped beside the fixed
  250 px panel.
