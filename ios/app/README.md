# PurpleCAD for iPad

The iPad app hosts the desktop renderer unchanged in a WKWebView. Two pieces of
the desktop's main process run unchanged too, each in a JavaScriptCore context
on its own thread:
- `electron/occ-bridge.cjs` runs the OCC ops, over the addon core shared with
  the desktop (Phase 1, `native/occ-addon/src/occ_js.h`);
- `electron/kvStore.cjs` keeps the documents, over the system SQLite.

The app itself is Phase 2 of the iPad port; persistence and files are Phase 3.

| Desktop (Electron) | iPad |
|---|---|
| `app://` protocol serving `dist/` | `AppSchemeHandler.swift` serving the same `dist/` (copied in as `web/`) |
| `preload.cjs`'s `window.electronAPI` | `js/electron-shim.js`, over WebKit message handlers |
| IPC with structured clone | `js/codec.js`: JSON, with typed arrays as base64 |
| The OCC worker thread running `occ-bridge.cjs` | `OccHost.swift`: one thread, a 16 MB stack, JavaScriptCore running `occ-bridge.cjs` (`js/occ-host.js` loads it) |
| `napi_binding.cc` | `jsc_binding.cc` |
| The `SharedArrayBuffer` cancel flag | An int32 Swift owns, set with `OccSetCancelFlag` |
| `kvStore.cjs` over better-sqlite3, answering `db:*` | `DbHost.swift`: `kvStore.cjs` over the system SQLite, through `js/db-host.js` (the slice of better-sqlite3 it uses). Same schema: the Mac's `sqlite3` reads the iPad's file. |
| `db:callSync` while the window unloads | None. An iPad app is backgrounded, not unloaded: `db.js` flushes on `visibilitychange`, and the host keeps the app awake 2 s to write it. |
| Save / Export: a browser download | A `WKDownload`, offered to the share sheet ("Save to Files"). |
| Open: the file input | The same file input (the iPad's picker), and a `.pcad` opened from the Files app (a `purplecad:open-document` event into the same code). |

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
- a cancel check;
- persistence: the timeline read back from SQLite, past the page's cache;
- files: the toolbar's real Save button, the download caught, and the file
  reopened the way the Files app opens a `.pcad`, as a new project.

`--smoke-reload` is the second half, a fresh launch afterwards: the part,
its variables and both projects must come back from the database.

It prints each check and exits 0 only if all hold. It also writes the render to
the app's `Documents/smoke-iso.png`.

```bash
# simulator (then the same with --smoke-reload)
xcrun simctl install booted ios/app/build/Release-iphonesimulator/PurpleCAD.app
xcrun simctl launch --console-pty --terminate-running-process booted \
  com.robeesworld.purplecad --smoke
# iPad (unlocked); the report comes off the device afterwards (see below)
xcrun devicectl device install app --device <UDID> ios/app/build/Release-iphoneos/PurpleCAD.app
xcrun devicectl device process launch --console --terminate-existing \
  --device <UDID> com.robeesworld.purplecad --smoke
xcrun devicectl device copy from --device <UDID> --domain-type appDataContainer \
  --domain-identifier com.robeesworld.purplecad --source Documents/console.log \
  --destination console.log
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

iPad Pro 12.9-inch (6th generation, M2, iPadOS 27): every check passed, on
two launches.
- The app was ready in 0.14–0.19 s.
- The flow up to the render took 8.2–8.9 s, including the two runs of the
  slow union.
- The union and the rebuild gave the same figures as the simulator.
- Cancel: the 2000-gon union took 4.58 and 4.59 s uncancelled, 1.5x the Mac's
  3.1 s. Cancelled 300 ms in, it returned after 417–419 ms.
- The render (looked at) shows the same part, on the dark theme the iPad was
  set to.

This is an M2. The M1 minimum is still unmeasured.

Persistence and files (Phase 3), on both the simulator and the iPad, from a
fresh install: every check of `--smoke` and `--smoke-reload` passed.
- The timeline in SQLite had all six steps, the last making the union.
- Save produced a 43,711-byte `scene.pcad`. Reopened, it made a project
  "scene" that rebuilt the part at 80 x 40 x 18.
- After a relaunch, the part, `Width = 80` and both projects came back.
- The iPad's database, copied off the device, opens in the Mac's `sqlite3`:
  two projects, six timeline rows each, and a 16 KB thumbnail.

## Findings worth keeping

- **iPadOS 27 requires the scene lifecycle.** An app delegate that makes its
  own window is trapped at launch on the device
  (`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, SIGTRAP).
  The iOS 26 simulator runs the same app fine. The window now belongs to
  `SceneDelegate`. The crash report was the only evidence:
  `xcrun devicectl device info files --device <UDID> --domain-type systemCrashLogs`.
- **`devicectl --console` relays none of the app's stdout on the iPad.** It
  did for the Phase 0 spike, which never started UIKit. `Log` also writes
  `Documents/console.log`, which is copied off the device afterwards:
  `xcrun devicectl device copy from --device <UDID> --domain-type appDataContainer --domain-identifier com.robeesworld.purplecad --source Documents/console.log --destination console.log`.
  While the app was crashing, `devicectl` still reported "terminated with
  the exit code 0", so that line proves nothing. The report in the copied
  log is the verdict.

- **A cancelled boolean returns; it doesn't throw.** `BooleanOp` takes
  `Shape()` without checking `IsDone()`, so a cancelled union comes back with
  an empty or partial mesh. The desktop behaves the same: `occClient`'s cancel
  epoch discards the result. The smoke check therefore measures time, and
  checks the result isn't the full one.
- **A blob download survives an immediate revoke.** `handleSave` revokes its
  blob URL as soon as it has clicked the link. WebKit still delivers the
  download whole (43,711 bytes, reopened fine), so the renderer needed no
  change.
- **A timeline step's stored label is just "Added".** The name shown in the
  timeline comes from the item it creates; a check that looked for "Union"
  in the labels failed for that reason, not because the save was incomplete.
- **The simulator build must exclude x86_64.** OCCT for the simulator is
  arm64 only. A generic simulator destination otherwise also links x86_64 and
  fails on every OCCT symbol.
- **`localStorage` persists for the `app://` origin.** A relaunch reopened
  the smoke run's document with its whole timeline. Until Phase 3 that is the
  app's storage.

## Not yet

- The Files app handing a `.pcad` to PurpleCAD is not exercised by the smoke
  run. Only the `openDocument` path it calls is, and the document type is in
  the built Info.plist. Tap a `.pcad` in Files to try it.
- The flush on going to the background is unit-tested (`dbCache.test.js`) but
  not driven on a device. A timeline save waits 150 ms, which no outside tool
  can background the app inside.
- A long OCC op when the app goes to the background is not aborted: iOS
  suspends the thread, and the op carries on when the app returns. The
  document is saved first, so only the op's work is at risk if iOS kills a
  suspended app.
- Touch, Pencil and keyboard (Phase 4). The renderer still expects a mouse and
  a trackpad.
- Layout (Phase 5): portrait leaves the 3D view cramped beside the fixed
  250 px panel.
