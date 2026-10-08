# iPad port — Phase 0 spike

Can PurpleCAD's geometry kernel run on an iPad the way the port plans to run it?

- OpenCASCADE built for iOS.
- Driven from JavaScript in a JavaScriptCore (JSC) context on a background
  thread, standing in for the Node worker that runs `occ-bridge.cjs` today.

`spike.mm` runs one workload two ways:

- **native**: plain C++, the baseline.
- **jsc**: a script in a `JSContext` on a background thread calling
  synchronous native functions, as `occ-bridge.cjs` calls the addon.

It builds unchanged for macOS, the iOS simulator and the iPad.

The workload is MultiSystem2's base STL (14,384 triangles, extracted from
`test-files/multisystem2.pcad` by `mesh.js`):

1. Sew it into a solid and merge its coplanar faces (the import sew).
2. Cut the two 3.94 mm boss holes through it.
3. Mesh the result.

Reproduce: `ios/spike/build.sh` (clones OCCT 8.0.1, builds it for both iOS
targets, builds the spike three ways, runs macOS and the simulator).

## Results (2026-10-08)

| Question | Answer | How it was established |
|---|---|---|
| Does OCCT 8.0.1 build for iOS? | **Yes**, simulator and device, arm64, iOS 17+, as shared libraries (LGPL). | Built. 144 dylibs per target; `vtool` reports `IOSSIMULATOR` / `IOS`, `minos 17.0`. |
| Does it link into an iOS binary? | **Yes**, against the 13 libraries the workload needs. | Linked for the simulator and the device. |
| Does OCC run on iOS? | **Yes**: same result as macOS (14,078 triangles). | Run in the iPad Air 11-inch (M4) simulator via `simctl spawn`. |
| Does JSC on a background thread drive it? | **Yes**: same result, `onMainThread: false`, no measurable overhead (2.2 s jsc vs 2.2–2.3 s native on macOS, two runs each). | Run on macOS and in the simulator. |
| Time and memory on a real iPad | **Not yet measured**: no iPad was connected. | See *Remaining*. |

Measured figures from the clean macOS run (M-series Mac, two runs each):

| Mode | Sew | Cut | Mesh | Total | Peak memory |
|---|---|---|---|---|---|
| native | 1.63–1.67 s | 0.30–0.32 s | 0.28–0.31 s | 2.2–2.3 s | 625 MB |
| jsc | 1.63 s | 0.29–0.32 s | 0.30 s | 2.2 s | 630 MB |

In the simulator, on a quiet Mac, the same workload took 2.4–2.5 s (native
2.52 s, jsc 2.44 s) at about 575 MB peak. An earlier run alongside the
simulator's boot took 3.3–3.9 s; a macOS run at the same time also slowed,
to 3.3–4.4 s. The simulator runs on the Mac's own CPU, so its times are
**not** iPad figures. They only show the build works.

Size: the 48 OCCT libraries are 68 MB for iOS. The 13 this workload needs are
32 MB. The app will need more than 13 (STEP, fillets and so on), so expect a
figure between the two.

## Findings worth keeping

- **OCCT's iOS link line misses Foundation.** `BUILD_MODULE_DataExchange`
  pulls in `TKService` even with Visualization off. Its Objective-C source
  (`Cocoa_LocalPool.mm`) failed to link with `_OBJC_CLASS_$_NSAutoreleasePool`
  undefined. `CMAKE_SHARED_LINKER_FLAGS="-framework Foundation -framework UIKit"`
  fixes it.
- **The iOS SDK has no `libproc.h`.** Peak memory comes from `task_vm_info`'s
  `ledger_phys_footprint_peak`, the figure iOS's memory limit counts.
- **The sew dominates.** About 70% of the time, and most of the ~600 MB peak,
  goes on sewing 14k triangles. On an iPad that peak is the number to watch
  against the memory limit.
- **JSC calls into native code synchronously, as N-API does.** A script calls
  a block, the block runs OCC, and the result comes back, all on the worker
  thread. Typed arrays cross without a copy (`JSObjectGetTypedArrayBytesPtr`).
  That is the property the plan relies on to run `occ-bridge.cjs` unchanged.

## Kill criteria

| Criterion | Status |
|---|---|
| OCCT builds and links for iOS | **Passed.** |
| The JSC model works (synchronous native calls from a background JS thread) | **Passed.** |
| On an M1 iPad: this workload within 3x the M-series Mac's time (≤ ~7 s), and peak memory well inside the app's limit (≤ 1.5 GB) | **Pending a device.** |

## Remaining

The device run needs:

- an M1-or-later iPad connected to this Mac;
- a small app bundle around `spike.mm`, because a device runs only signed apps,
  unlike `simctl spawn`. The Apple Development signing identity is already on
  this Mac.

The 13 OCCT dylibs go in the bundle's `Frameworks/`; `spike-ios` already
links with `@executable_path/Frameworks`. Run the workload on M1 (the
minimum) as well as anything newer.
