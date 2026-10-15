# Working notes for Claude

This file captures conventions and expectations established while iterating
on this codebase. Read it before making changes.

## Terminology: "centre of the 3D view"

Whenever this file (or a task) refers to the centre of the 3D view, it means
the centre of the VISIBLE viewport area EXCLUDING the left objects/timeline
panel (`.left-panel`, `250px`, absolutely positioned over the canvas — the
canvas itself spans the full container width). Raw canvas-centre is left of
this point by half the panel width; camera framing, pivot placement, and the
ground ruler must all target the panel-excluded centre, not raw canvas centre.

## Verify Before Reporting Results

Never publish results, tables, or benchmark numbers until the underlying
pipeline has been end-to-end validated on a known-good case. If a result looks
surprising (a test that passes for the wrong reason, a table that changes shape
between runs), treat it as a bug in the harness first, not a finding. State
explicitly which parts were measured vs. assumed.

## Always reformat with Prettier after editing

After every change to `.js` / `.jsx` files, run:

```bash
npm run format
```

(equivalent to `npx prettier --write "src/**/*.{js,jsx}"`).

Prettier is the single source of truth for layout. Don't hand-format; don't
fight it. Run it once when you're done so a stray edit doesn't show up as
whitespace noise in the diff.

## Verify with tests AND build, in that order

```bash
npm test                  # all unit tests (vitest), runs in ~7s
npx vite build            # production bundle, ~3s
npm run test:e2e:podman   # Electron e2e, headless Linux container
npm run test:e2e:gpu      # macOS: only the two GPU specs the container skips
```

**Run the e2e suite through podman** (`npm run test:e2e:podman`), and run the
WHOLE suite -- never a single spec. A spec passing alone says little: the
project-box union failed only in a full run, `undraggable-sketch` passed alone
and failed in the suite, and Playwright wipes `test-results/` on every run, so
a single-spec run deletes the other parts' `.pcad` files. Run one spec only
when explicitly asked to watch a test in action, and then say that is what you
did.

`timeline-walk.spec.js` is the slowest test and its cost genuinely swings:
measured per step, everything settles in 0.4s except two chamfers on an
embossed body at 28.1s and 19.9s, and the same spec on the same code has taken
28.8s, 52.7s and 15.5 minutes on an unloaded machine. Its waits are 240s for
that reason, well clear of a legitimate chamfer -- so a failure THERE is a
genuine wedge worth chasing, not a slow machine. The variance predates the
budget change (it fails the same way at 3e4ea95) and is unexplained; it is a
question about the recalc path, not about the test.

The failure-screenshot fixture (`e2e/fixtures.js`) takes its screenshot with a
TIMEOUT. A test that fails because a recalculation never settled leaves the
renderer busy in a native call, and `page.screenshot()` then never returns --
which does not merely lose the picture, it hangs the whole run. One container
sat like that for six and a half hours, long after the test timeout had fired.
Keep that timeout.

The path-tracer pixel test excludes ITSELF in the container -- it needs a real
GPU and skips on a software renderer (see `e2e/pathtrace.spec.js`), as does the
`visual` snapshot. Both report as skipped, not failed; nothing needs excluding
by hand, and a suite reporting failures is a real problem rather than expected
noise.

It builds the addon, rebuilds better-sqlite3, builds the VITE_E2E renderer and
runs Playwright under xvfb inside the container, so a run doesn't depend on the
state of the host toolchain or steal the desktop's focus. Build the image
once with `npm run e2e:image` (~15 min the first time -- the OCC 8.0.1 source
build is its own layer and is reused by every later app-code rebuild; app
edits rebuild only the COPY layers, ~1 min). The podman VM needs more than
its 2 GiB default: `podman machine set --memory 8192 --cpus 8`.

**On macOS, run only the two GPU specs (`npm run test:e2e:gpu`) -- the
owner's decision, to stop duplicating the container.** The container runs the
whole suite; the path-tracer and `visual` specs skip there for want of a GPU,
and are the only thing a full macOS run added routinely. They also launch the
app, which loads the macOS addon -- the clang build linked against the macOS
OCC -- so they catch the failures that have actually been macOS-only (wrong
architecture, rpath, "symbol not found" at require time). Run the FULL macOS
suite (`npm run test:e2e`) before a release, or when chasing a problem that
looks platform-specific: a native op behaving differently on macOS than on
Linux for the same source is the one thing the pair can't see (no case of it is
on record). This is the one standing exception to "never run a single spec".
Like any host Playwright run, never start it while the container suite is
running (see Environment setup), and it wipes `test-results/`, including the
container run's part `.pcad` files. `E2E_NO_SANDBOX=1` (set in the image)
makes `e2e/launch.js` pass `--no-sandbox`, which rootless containers require;
the macOS run keeps the sandbox on.

Run tests through the npm scripts, not `npx vitest`/`playwright` directly:
they route through `scripts/with-display.sh`, which runs the command under
`xvfb-run` when it's available (headless Linux/CI) and directly otherwise
(macOS provides its own window server). This gives the Electron e2e tests a
virtual framebuffer on Linux without breaking macOS. On a headless Linux host
install xvfb first (`apt-get install -y xvfb`).

Both must succeed before declaring work done. The build sometimes catches
issues vitest misses (native module leaking into the renderer bundle, etc.).
`vite.config.js` marks `occOps.js` as external so the Node.js
`createRequire` usage doesn't pollute the browser bundle — verify that external
survives any Vite upgrade (grep dist for `occ_addon`; it must be absent).

## Environment setup

- **Never run the container suite against a stale image.** `npm run
test:e2e:podman` runs whatever `purple-cad-e2e` currently is -- it does NOT
  rebuild. Run `npm run e2e:image` after ANY change you expect the container to
  see, including changes to `e2e/`, `src/`, and the Containerfile itself.
  Editing the Containerfile and immediately running the suite tests the OLD
  image and silently reports the OLD result.
- **A hung container run does NOT clean itself up, and they stack.** `--rm`
  only fires when the container EXITS, so a run that hangs -- or whose client
  is killed -- leaves the container alive in the VM burning CPU, and the next
  run starts another beside it. Three of them once accumulated (one for three
  days, ~190 hours of CPU) and took the VM to a load average of 14.6 on 8
  CPUs, which is almost certainly what was behind a spell of unreproducible
  input-timing failures in `interactions.spec.js` -- a starved renderer drops
  wheel events and reloads. `test:e2e:podman` now passes
  `--name purple-cad-e2e-run`, so a second run is REFUSED rather than stacked,
  and `npm run e2e:podman:stop` clears a stray and lists anything still
  running. Check `podman ps` before blaming a flaky test on the code.
- **Never run Playwright on the host while the container suite runs.** The
  container bind-mounts `test-results/`, and a host run deletes and recreates
  that directory as it starts -- leaving the container holding a DELETED
  directory. Every write into it then fails (`touch` gives "No such file or
  directory"), and the run does not fail, it HANGS: the worker blocks in the
  file system (`/proc/<pid>/wchan` reads `request_wait_answer`) and the 60s
  test timeout never fires. A two-spec check on the host wedged a full container
  run this way at test 191, on the trophy's `.pcad` save. Check `podman ps`
  before any local e2e run.
- **`ELECTRON_RUN_AS_NODE` makes the packaged app exit silently.** VS Code's
  integrated terminal (and any shell running under Electron) exports it, and
  `open` hands the caller's environment straight to the app -- so launching the
  built app from such a terminal runs the Electron binary as plain Node: it
  quits after about a second with no window and NO output. main.cjs's guard
  cannot help, because packaged Electron-as-Node never loads the app's main
  script at all; the guard only fires for `electron .`. `npm run app`
  (`scripts/open-app.sh`) strips the variable and opens the built app, and
  `e2e/launch.js` deletes it for the same reason. Suspect this before
  suspecting the app: it cost a session's worth of probes once, including a
  wrong turn through code signing.
- If a `docker compose` setup is ever added here, its instructions in READMEs,
  scripts, and terminal commands must use `docker compose up -d --build` (never
  bare `up -d`) so code changes are actually rebuilt into the image. Verify a UI
  change is visible in the running container before calling it done.

## Stale IDE diagnostics

The IDE's bundled JS parser doesn't accept trailing commas in function
calls. Two specific lines repeatedly trip it (`store.js` line ~91 inside a
`JSON.stringify` call, and `Viewport.jsx` line ~118). The build accepts
them; the runtime accepts them; ignore the parser noise. Don't reformat
files just to make these go away.

## Tone and commenting

- **No emojis** in code or commit messages.
- Comments explain **WHY**, not WHAT. A line that paraphrases the
  identifier ("// increment counter") is noise; a line explaining the
  hidden constraint that motivated the code ("// OCC's `MakeFace_22`
  requires CW inner wires, otherwise the hole fills") is signal.
- Don't reference task numbers, PR numbers, or "this fix is for the
  reported bug from XYZ" — that belongs in the PR description and goes
  stale fast.
- Don't write multi-paragraph docstrings. One short line of intent at the
  top of a function is plenty.

## Part tests save a .pcad document

Any e2e test that BUILDS A SPECIFIC PART calls `exportPartPcad`
(`e2e/exportPart.js`), which writes `test-results/parts/<name>.pcad` and
attaches it to the Playwright report, and then `importPartPcad` from its LAST
test to prove the file reopens.

.pcad rather than a mesh format because it carries the TIMELINE and the
variables, not a triangle soup: reopening it in PurpleCAD gives back the
sketches, the features, their parameters and the whole history, so the part can
be inspected, edited and re-driven. (A 13 MB STEP export of the same box was
180 kB as .pcad.) It goes through the app's real Save button rather than
assembling the JSON, so the test exercises the path a user takes.

This exists because assertions only check what someone thought to assert. The
project-box test twice built a part that passed every dimension and mate check
and was still wrong: a lid that was a hollow frame with no floor (bounding
boxes and the ridge/opening mate both passed on it), and screw holes drilled at
arbitrary points over thin air. Both were caught by LOOKING at the thing.

Save while the model is COHERENT -- before any test that deliberately drives it
into an inconsistent state -- and do the reopen check LAST, since loading
clobbers the current document. The reopen is the check that matters: a document
that cannot be reopened is not a deliverable, and loading replays the timeline
from scratch, so it also proves the features rebuild rather than reading back
baked meshes.

A part's FEATURES should be tied to its geometry by CONSTRAINTS, not by
coordinates, so a parameter change moves them. Holes are the trap: the hole
tool stores resolved NUMBERS, so a tapped hole stays where it was drilled while
the part grows out from under it. A circle in the sketch, pinned to a corner by
a horizontal and a vertical leg (both `WallThickness / 2`), tracks correctly --
axis-aligned legs because the formula grammar is `+ - * / ( )` and identifiers,
with no sqrt for a diagonal. Open legs add no closed loop, so the extrude
profile still sees one outer rectangle with the circles as its holes.

## Test discipline

- **Don't lock in old behavior.** When fixing a bug, if a test's
  assertion encoded the buggy expectation, the test needs to change
  alongside the fix (with a comment near the assertion explaining the new
  expectation).
- New behavior gets a regression test that would have failed before the
  fix. The OCC smoke tests in
  `src/three/occ/__tests__/occ.smoke.test.js` and the buildSceneObjects
  positioning tests in `src/three/__tests__/transformPositions.test.js`
  are the canonical examples.
- Vitest runs in **node** (not jsdom), and `Worker` is unavailable. Don't
  add tests that depend on `@testing-library/react` or DOM globals — they
  won't run. Test the pure modules instead.

## Editing code with a script

Scripted edits (a python `str.replace`, a sed) fail SILENTLY and have cost real
time more than once:

- **Assert that every replacement applied**, and read the diff back. Prettier
  reformats as soon as you save, so a pattern copied from an earlier version of
  the file no longer matches -- the edit vanishes and the run tests the old
  code. Several "fixes" in one session were never applied at all.
- **Never cut a range by searching for a boundary token.** Removing a
  declaration by deleting from its name to the next `;` at the start of a line
  swallowed the following statement, because the line being removed ended in a
  comment rather than a semicolon -- three e2e specs lost their whole dimension
  table. A multi-line arrow function has the same trap in the other direction.
- **`node --check` does not notice.** Both accidents left valid JavaScript with
  a missing binding, and only showed when the test RAN.
- **Run the specs you EDITED, not the ones you were working on.** The suite
  caught the missing tables because the local run beforehand covered the feature
  under development instead of the files the edit had touched.

## Debugging Protocol

Before fixing, state the hypothesis and the cheapest experiment that would
falsify it. Prefer one probe over one speculative edit. Confirm a reading is
stable across at least two independent samples before building on it -- an
intermittent failure that reproduces once is not diagnosed.

This is written from repeated cost: "gcc rejects an incomplete type" and "the
container needs a window manager" were both asserted before testing and both
wrong, and each cost an image rebuild to disprove. Compiling four variants of
the real expression, and running openbox, each took about two minutes and gave
a definite answer. Probe first.

## Version Control

After each self-contained change: run the relevant test suite, then commit with
a descriptive message. Don't batch many features into one commit. If tests are
missing for the area being changed, add a minimal test alongside the change.

Note which suite is sufficient for the change at hand. A store/geometry change
is covered by vitest; anything touching a renderer-side closure, a React
component, or the camera/interaction layer is NOT -- those need e2e, and a
green unit run means nothing there (a factory extraction that dropped a
`renderer` parameter passed 1180 unit tests and a clean bundle build, and broke
every project switch).

## Working Style

When a task's stated goal is met, stop and ship it: commit/push and report.
Don't propose additional refactors, cleanups, or enhancements unless asked. If
you notice further improvements, list them as a short "possible follow-ups"
bullet list after shipping, not before.

## Response style

- Lead with one short sentence stating the change.
- Reference file paths as clickable markdown links:
  `[Viewport.jsx](src/components/Viewport.jsx)` or
  `[Viewport.jsx:118](src/components/Viewport.jsx#L118)`.
- End-of-turn summary: one paragraph (or one bullet per change for
  multi-part work). Cut anything that's just restating what the code
  shows.

## Code style

- Don't add defensive fallback code for situations that can't happen. The
  OCC kernel is a single shared singleton; the store is a single shared
  Zustand instance; defensive `?.` chains on `useStore.getState()` are
  pointless.
- Don't introduce abstractions until the third occurrence demands them.
  Two near-duplicate blocks is fine; three is when you start a helper.
- Prefer editing the existing file to creating a new one. New files have
  the burden of a name that fits, a place in the tree, and an import
  graph that doesn't break the worker bundle.
- **900-line ceiling.** Files in the 500-900 line range are ACCEPTABLE --
  leave them alone; splitting a file that already fits scatters related code
  for no benefit. As soon as a file exceeds ~900 lines, look immediately at
  options for splitting cohesive functionality into sibling modules (and
  re-export from the original if it's an import hub). Test files are exempt
  from the hard ceiling but still benefit from topic-based splitting when
  large.
- **Splitting by NAME, not by line range.** Related declarations are rarely
  contiguous -- selection-filter toggles sit in the middle of uiSlice's tool
  phases, and a chamfer helper sits inside sketchInteraction's drag block.
  Cutting a line range swallows the interlopers silently. Parse out the
  blocks you mean to move and assert their boundaries before writing; a
  block's trailing blank line and the comment above the NEXT declaration
  both belong to the neighbour, not to the block.
- **`node --check` proves nothing about a split.** Every breakage these
  splits have produced was a runtime ReferenceError with valid syntax: an
  import left behind (`loadSnapSettings`), a shared const gone out of scope
  (`TOOL_RESET_PATCH`, `activeSketchForProject`), or a relative dynamic
  `await import("./x.js")` resolving at the wrong depth after a move into a
  subdirectory. Run the unit suite AND the e2e suite after any split, and
  grep for `await import("./` whenever a file changes directory.

## Licensing

**Decision (owner's):** PurpleCAD is licensed under the PolyForm
Noncommercial License 1.0.0 (`LICENSE.md`, verbatim from the PolyForm
project, with three `Required Notice:` lines above it). It replaced MIT on
2026-09-29; copies published before keep MIT. The name, logo and ALL icons
are outside the license and governed by `TRADEMARKS.md`: the app icons
(`app-icons/`, `public/favicon.png`), `cad-icons/`, and every `<svg>` icon
drawn in `src/components/`. Forks rename, redraw the icons, and state they are
forked from PurpleCAD. A new icon is reserved artwork too -- nothing to do but
keep it in `src/components/` or `cad-icons/`, where the policy's list covers
it.

- **A new dependency must be permissive** (MIT, BSD, ISC, Apache-2.0, Zlib,
  BlueOak...) -- anything we may relicense under noncommercial terms. GPL or
  AGPL code cannot be included: its terms forbid adding a noncommercial
  restriction. LGPL is acceptable only dynamically linked, like OCCT.
- **Record it in `THIRD_PARTY_LICENSES.md`** in the same commit, with the
  installed version. Re-run the production-tree licence scan after a
  dependency update (the file says how).
- **The packaged app ships the terms.** `build.extraResources` copies
  `LICENSE.md`, `THIRD_PARTY_LICENSES.md`, `TRADEMARKS.md` and `licenses/`
  (OCCT's LGPL 2.1 and exception texts, from tag `V8_0_1`) into the app's
  resources: the license requires every copy to carry its terms and notices.
  Bump `licenses/occt/` with the OCCT tag.

## Third-party libraries: native C++ over WASM

**Decision (owner's standing preference):** when a third-party library offers
both a C++ build and a JavaScript/WASM build, integrate the **C++ build natively,
in the addon (`native/occ-addon`)**, as far as the feature allows -- not the
WASM package in the renderer. This applies to every feature added from now on
(first applied to meshoptimizer).

What that means in practice:

- Vendor the library's sources at a pinned release into the addon tree (with
  its LICENSE) rather than fetching at build time, so the container image and
  the packaged app build reproducibly offline. Add them to `CMakeLists.txt`.
- It must compile cleanly under BOTH clang (macOS) and gcc (the Linux container
  and `dist:linux`) -- see the addon section below. Verify with
  `npm run e2e:image` (the container suite) and `npm run test:e2e:gpu` on
  macOS, which loads the clang build.
- Expose it as addon functions and reach it through the normal OCC op path:
  an op body in `occOps.js` AND `electron/occ-bridge.cjs` (the two-
  implementation rule below applies), a wrapper in `occClient.js`, and a
  `bridgeParity.test.js` case. It then runs in the OCC worker, off the
  renderer thread, and vitest exercises the real native code.
- A native loop that can run long polls `CancelRequested()` like the other hot
  loops in the addon (see "OCC cancellation").
- WASM stays the fallback only where a feature genuinely has to run in the
  renderer; it would also need `'wasm-unsafe-eval'` added to the CSP in
  `index.html`, which currently blocks WebAssembly compilation.

## OCC execution boundary

- `occClient.js` is the only renderer-side surface for OCC calls. In
  Electron it routes through IPC (`window.electronAPI.invokeOcc`); in
  Node/vitest it dynamically imports `occOps.js` in-process.
- Operation bodies live in `occOps.js`. Any new op:
  1. Add a function to `occOps.js`'s `ops` map.
  2. Add an `export` wrapper in `occClient.js` that calls `runOp("name",
args)`.
  3. Call from React via `await occClient.theOp(args)`. The busy
     counter / spinner auto-attaches.
  4. Add the same body to `electron/occ-bridge.cjs` and its exports (see the
     two-implementation rule below), AND add the op name to `OCC_OPS` in
     `electron/main.cjs`. That list registers one IPC channel per name; an op
     missing from it has no handler, so it passes every vitest test (which
     never crosses IPC) and fails in the app.
- **`occOps.js` must never be statically imported** from the renderer
  bundle — it uses Node.js `createRequire` for the native addon.
  `vite.config.js` marks it `external` so Rollup skips bundling it.
  In the Electron renderer the dynamic-import code path in `occClient.js`
  is never reached (IPC is used instead). This is why
  `regenerateOrchestrator.js` exists separately from the store (same
  reason: avoid creating a bundling cycle through `occClient`).

- **⚠️ TWO parallel OCC implementations — keep them in lockstep.** The op
  bodies exist TWICE:
  - `src/three/occOps.js` (+ `src/three/csgUtils.js`) — ESM, used by
    **vitest/Node** (the only path the test suite exercises).
  - `electron/occ-bridge.cjs` — a CommonJS re-implementation that **the
    actual Electron app runs** (main process, via `main.cjs`'s `invokeOcc`
    handler). Its comments say "mirrors occOps.js".

  A change to CSG/transform/scale/extrude logic in `occOps.js`/`csgUtils.js`
  that is NOT also made in `occ-bridge.cjs` **passes every test but does
  nothing in the shipped app** — this cost five rounds of "still broken"
  before it was found. When you touch `buildBrushTransform`, `scaleLocal`,
  `booleanInputLocal`, `buildItemShapeLocal`, `performCsg`, `splitItem`,
  the export builder, or any op body: **edit BOTH files in the same commit**,
  and grep the bridge for the same landmine (`git grep -n "scaleShape\|t.scale\|buildBrushTransform" electron/occ-bridge.cjs`).
  `bridgeParity.test.js` (src/three/occ/**tests**) machine-checks the core
  ops by running BOTH implementations and diffing the geometry — extend it
  when adding an op — and `e2e/bridge-parity.spec.js` covers the real IPC
  path. Those catch result drift; a bridge-only crash or an op the suites
  don't cover still needs this rule + an Electron smoke check.

## Native OCC addon (native/occ-addon)

- Built against OpenCASCADE 8.0.1 at `~/occ-8.0.1-arm64`. CMakeLists'
  `find_package` HINTS list that path first, falling back to `~/occ-8.0-arm64`
  (8.0.0) then `~/occ-arm64` (7.9.0) and finally system Homebrew paths — the
  same source builds against any of them, so an un-upgraded machine keeps
  working. Bump the CI cache key and the Containerfile's clone tag together
  with this path or they silently keep building the old version.
- **Pin `-DCMAKE_OSX_ARCHITECTURES=arm64` when building OCC on macOS.** 8.0.1's
  CMake picks x86_64 by default on an arm64 Mac (it lays the build out under
  `mac64/clang/`), and the failure is quiet: the addon still LINKS -- ld only
  warns "ignoring file ... found architecture 'x86_64', required architecture
  'arm64'" -- and only blows up at require() time with `symbol not found in
flat namespace`. 8.0.0 defaulted to arm64, so an upgrade inherits the trap.
  Check with `lipo -archs ~/occ-8.0.1-arm64/lib/libTKernel.8.0.1.dylib`.
- **Each op is written ONCE, against `src/occ_js.h`; N-API and JavaScriptCore
  are adapters.** The iPad has no Node, so the ops cannot take
  `Napi::CallbackInfo`: each is `Val Op(Js& js)` over a small engine interface
  (`js[0]`, `js.num(v, fallback)`, `js.f64(v)`, `js.makeObject()`...), and
  `napi_binding.cc` (Node/Electron) and `jsc_binding.cc` (iPad) implement that
  interface and register `occjs::Ops()`. The core is split by topic:
  `occ_kernel.cc` (shape store, cancel, tessellation), `occ_select.cc` (edge /
  face matching and persistent names), `occ_build.cc` (primitives, sweeps,
  transforms), `occ_modify.cc` (boolean, chamfer/fillet, push/pull, draft,
  shell, hole), `occ_io.cc` (STEP, mesh sewing, the op table), with
  `occ_core.h` declaring what they share. A new op is a function in the right
  topic file, a declaration in `occ_core.h` and a row in `Ops()` -- never an
  adapter change, and never `napi.h` in a core file (the iPad build compiles
  them without Node). `jscBridge.test.js` (macOS only; the addon build makes
  `build/occ_jsc_host` there) runs the unchanged `occ-bridge.cjs` under both
  engines and requires identical results. Two things it found:
  `JSObjectGetTypedArrayBytesPtr` returns the BUFFER's start, not the view's,
  so a subarray needs its `byteOffset` added (its subarray case fails without
  it); and OCC's face order for some ops (shell) changes from RUN to run in
  one engine, counts unchanged, so meshes are compared as sorted triangle
  sets, exact coordinates and winding kept.
- **`npm run build` goes through `native/occ-addon/build.sh`, not bare
  cmake-js.** macOS 27 removed Rosetta, and this machine's Intel Homebrew
  (`/usr/local/bin/cmake`, `ninja`, `pkg-config`) sits first on PATH, so
  cmake-js died with `spawn Unknown system error -86` (EBADARCH) and
  `electron:start` failed at its first step. The script uses the first cmake
  whose `--version` runs, and passes `--prefer-make` when the PATH ninja
  cannot run (cmake-js picks ninja whenever one exists). An arm64
  `/opt/homebrew/bin/brew install cmake` is the durable fix for the machine.
- **The addon must compile under BOTH clang and gcc.** macOS dev builds with
  clang; the Linux e2e container and `dist:linux` build with gcc, and gcc is
  the stricter of the two. The trap already hit: gcc rejects copy-initialising
  a base handle from a factory's derived return value
  (`Handle(Geom2d_Curve) c = GCE2d_MakeSegment(...).Value();` →
  "conversion from 'handle<Geom2d_TrimmedCurve>' ... requested") while clang
  accepts it, so the short spelling builds green on macOS and breaks Linux
  only. Bind the derived handle to its own name first, then upcast. Verify a
  gcc build (`npm run e2e:image`) after touching the addon's C++.
- **Simplify's deviation is a certified BOUND -- never swap it for sampling.**
  meshoptimizer's own error is an estimate (about 3x over on a real part), and
  probing vertices, centroids and edge midpoints under-read too: 0.050 mm where
  brute force found 0.079 mm inside the triangles. `mesh_tools.cpp` bounds it
  instead (distance to one triangle is convex; seam-split and coplanar-quad
  candidates; halving across the longest edge down to a size bound), and where
  it strays it locks the nearest ORIGINAL vertex and re-runs -- tightening the
  whole request cost two thirds of the reduction, and locking whole triangles
  half of it. `simplifyMesh.test.js` checks the bound against brute force; keep
  that check. The bound runs on `std::thread`s: pure geometry on read-only
  arrays, no OCC state, so safe in the OCC worker (gcc links `Threads`).
- OCC 8.0.0 removed `TopTools_ListIteratorOfListOfShape.hxx`. Iterate
  `TopTools_ListOfShape` (an `NCollection_List`) with a range-based `for` loop
  instead of that iterator. If a future OCC bump reintroduces a similar
  removed-header break, prefer the range-based-for fix over re-adding the old
  header.
- `BooleanOp`'s union path (`occ_modify.cc`) sets `SetFuzzyValue(1e-5)` on the
  `BRepAlgoAPI_Fuse` and then runs `ShapeUpgrade_UnifySameDomain` on the
  result (falling back to the raw fuse if unification throws). This is
  required so independently-built abutting solids (e.g. multiple extruded
  prisms) don't leave hairline-gap seams / sliver coplanar faces that a later
  chamfer or fillet rejects with "geometry rejected the operation". Scoped to
  `union` only — `cut`/`intersection` are unaffected and must stay that way.
  Preserve both the fuzzy value and the unify step in any rewrite of this
  function.

## OCC cancellation (long-op abort) — how it works, what breaks it

A long OCC build is ONE synchronous native call. The worker thread hosting it
(`electron/occ-worker.cjs` → `occ-bridge.cjs` → the addon) is blocked and cannot
receive a "cancel" message. So cancel is **cooperative via shared memory**, and
this is the only shape that works — the two alternatives both failed hard:

- **Do NOT `worker.terminate()` mid-op.** worker_threads share the process
  address space; OCC keeps non-thread-safe globals (`g_shapes`, the shape store,
  BOP internals). Terminating a worker mid-build corrupts them and crashes with
  `libc++abi: terminating due to uncaught exception of type Napi::Error`.
- **Do NOT move the addon to an Electron `utilityProcess`.** It segfaults
  (`EXC_BAD_ACCESS`) loading the native addon in that context — the app quits
  instantly at startup. (Not fully root-caused; if you retry it, it needs live
  debugging of the addon load, not a blind reland.)

The working mechanism (keep all three pieces in lockstep):

1. **Shared flag.** `main.cjs` owns a one-int32 `SharedArrayBuffer`
   (`occCancelBuffer`), passes it to the worker via `workerData`, and flips
   element 0 to 1 in the `occ:cancel` IPC handler. The worker clears it to 0
   before each op (safe — the thread is free between ops). `occClient.cancelOcc`
   (renderer) triggers the IPC; the Viewport `cancelEpoch` effect and the
   `inputs.jsx` preview-supersede call it, each also `clearSolids()`.
2. **Native polls it.** `occ_kernel.cc` aliases the SAB as `g_cancelPtr`
   (`SetCancelBuffer`). `CancelIndicator : Message_ProgressIndicator` returns it
   from `UserBreak()`; `CancelRange()` hands a range rooted at that indicator
   into every heavy `.Build(...)` (boolean, chamfer, fillet, pushpull prism,
   loft, pipe, draft, cylinder) and the meshing (`BRepMesh_IncrementalMesh` via
   the `IMeshTools_Parameters` + range overload). OCC throws at the next
   checkpoint. For OUR OWN hot loops that aren't OCC algorithms (the
   per-triangle face-building loop in `MakeSolidFromMesh`), poll
   `CancelRequested()` directly every ~1024 iterations and throw.
3. **Soft backstop.** `occClient.runOp` still discards a result that lands after
   the cancel epoch changed — for an op that finished before the flag was seen.

**Landmines (each was a real, painful bug):**

- **`BRepBuilderAPI_Sewing` ignores `UserBreak`.** Threading a `Message_Progress-
Range` into `sew.Perform(range)` does NOT make sewing abortable. It was the
  emboss bottleneck. Do not assume passing a range makes a stage cancellable —
  only some algorithms honor it (booleans/meshing do; sewing does not).
- **`MakeSolidFromMesh` has TWO independent knobs — don't conflate them.**
  `(positions, indices, skipCaps, fastSew)`:
  - `skipCaps` — skip the tri/face REJECTION caps (`kMaxTris`/`kMaxFaces`, e.g.
    "too many curved faces"). Those caps guard an IMPORTED mesh from hanging a
    later boolean; they're wrong for export (no boolean) AND for the emboss
    stamp/body (a legitimately dense CURVED wrap that MUST be booleaned — unify
    can't merge curved faces, so at print resolution the count exceeds the cap).
  - `fastSew` — sew with `BRepBuilderAPI_Sewing` cutting OFF and skip the coplanar
    `UnifySameDomain` pass. Near-instant, but the un-cut per-triangle shell won't
    unify and its faces don't share edges — fine when the solid is only
    tessellated/written (EXPORT), fatal when it's booleaned (no unify ⇒ face count
    ~= triangle count ⇒ slow/rejected). Cutting-off also returns nothing for some
    hard meshes, so the `fastSew` branch has a full-sew fallback.
  - So: **import** = `(false,false)` cutting+unify+caps; **export** = `(true,true)`
    fast, no caps; **emboss faceted body** = `(true,false)` cutting+unify, no caps
    (a clean OCC tessellation — cutting is safe); **JIT input-fallback sew**
    (`solidFromMesh` op — the orchestrator sewing an upstream step's baked mesh
    as a downstream op's input) = `(true,false)` for the same reason — with caps
    ON a dense emboss relief was rejected and the throw escaped the recalc
    (stuck regen dialog; the sew is now also try/caught → recipe-rebuild
    fallback, `recalcSewInput.test.js`). The **conform emboss STAMP** is
    the exception: `(true,true)` — cutting-ON _hangs_ resolving the wrapped
    prism's near-touching bent triangles, so it sews cutting-OFF and relies on
    per-shell `OrientClosedSolid` + `ShapeFix_Shell` (in `MakeSolidFromMesh`) to
    fix face orientation instead. Keep cutting ON for any OTHER booleaned solid.
- **Conform emboss on a CLOSED wall must WRAP, not clamp, at the curve seam.**
  `buildDevelopableConformMesh#sampleAt` wraps the arc-length parameter modulo
  the closed loop (closure detected by the small first↔last gap; open S-curve
  walls still clamp). Clamping squashed seam-adjacent text into degenerate
  self-intersecting slivers — missing/garbled letters AND minutes-long booleans,
  triggered by wherever the user happened to click (`embossRingWrap.test.js`
  drives the real repro scene through the op).
- **Conform emboss: the stamp mesh MUST be consistently wound.**
  `prismFromLoops` (`embossTessellate.js`) can emit mixed-handedness triangles for
  holed glyphs (O/A/e); sewn, that's a watertight but inconsistently-oriented
  solid → reversed render normals that OCC's global `OrientClosedSolid` can't fix
  per-face. `orientWindingConsistent` flood-fills a consistent winding at the
  source (regression test in `embossTessellate.test.js`); keep it. A CLEAN stamp
  boolean is ~3s (measured; a clean 12k-face fuse is <1s) — conform emboss is NOT
  inherently O(faces²). If it goes slow, the mesh is DIRTY (self-intersecting /
  non-watertight), not "too many faces": check the boolean's inputs are watertight
  rather than reaching for the `kMaxFaces` cap. (History: a coarsening experiment
  once made this look like an 88s O(faces²) wall — it wasn't; see the
  `conform-emboss-rework` memory.)
- **OCC kernel faults are converted to exceptions — keep `OSD::SetSignal`.**
  `occjs::Init` (`occ_kernel.cc`) calls `OSD::SetSignal(Standard_False)`: hardware faults
  inside OCC algorithms (ChFi3d's chamfer builder NULL-derefs on degenerate
  stripes — observed via `PerformSetOfSurf` after a resolution switch) become
  catchable `Standard_Failure` instead of a SIGSEGV that kills the whole app
  (the addon shares the process via worker_thread). Removing it re-opens
  app-death on any kernel fragility. The faulted op fails like rejected
  geometry; the step settles as `regenFailed`.
- **`BRepAlgoAPI_Fuse`'s two-shape constructor silently DROPS a COMPOUND tool.**
  A multi-letter emboss stamp is a compound (one sewn solid per letter); fusing it
  the two-argument way returns just the body — "missing letters", no error.
  `BooleanOp` explodes compound args/tools into a `TopTools_ListOfShape` and uses
  `SetArguments`/`SetTools` for all three ops. Don't revert to the two-shape ctor.
- **`MakeChamfer` / `MakeFillet` can say `IsDone()` and hand back a broken
  solid.** A bevel wider than the material it runs along -- 1 mm off both
  sides of a cog's 1.4 mm tooth tips, 0.6 mm off both rims of a 1.0 mm wall --
  comes back with overlapping faces and an open surface, drawn as triangles
  spanning the air. `ChamferShape` / `FilletShape` now run
  `BRepCheck_Analyzer` on every attempt (`RequireValidBevel`) and throw
  `InvalidBevel`, which skips the unify / face-rim retries: those fix slivers,
  not an oversize distance, and on an 860-edge rim each one is another full
  bevel (the refusal took 48 s with them, 12 s without). A test that only
  checked "some triangles came back" passed on the broken result
  (`hollowChamferRepro`); check the mesh is closed -- every welded edge shared
  by exactly two triangles -- as `cogBevel.test.js` does.
  BRepCheck is not enough on its own: at 0.4 mm the cog passes it yet its top
  face meshes with a patch missing on every tooth (240 open edges, identical
  at every mesher setting tried), and the stricter `BRepAlgoAPI_Check` flags
  GOOD results too, so it can't discriminate. Each attempt therefore also
  meshes its result (`OpenEdgeCount`) and refuses one with OPEN edges -- an
  edge used by three triangles is tolerated, because a good embossed ring
  chamfer has one (a degenerate sliver) and draws fine.
  Both checks are made AGAINST THE USER'S BODY (`BevelBrokeBody`), not an
  ideal: an imported mesh can arrive failing BRepCheck with a few open edges
  already (MultiSystem2's base: 3, from a Split's degenerate triangles), and
  the absolute check refused every chamfer on it, at any size. A bevel is
  refused when it opens MORE edges than its source had, or makes a valid body
  invalid -- and never judged against the merged retry copy, since merging
  itself can open the mesh (3 to 7 there). Selection is the other trap: the
  endpoint match's "points on the curve" fallback took any edge within 0.5 mm
  of both ends of a picked segment, which on a mesh body picks up seams
  between coplanar triangles (unbevellable) and hole-wall seams; it is 1e-3
  now (`holeRimChamfer.test.js`). Still unsolved there: the upper half of each
  boss-hole rim, whose "flat" top faces are 1-7 um out of plane -- a loose
  merge lets the chamfer run but leaves faces the mesher can't close (79 open
  edges), so it was not kept. Nor was FLATTENING the mesh before sewing
  (snapping runs of triangles within 10 um / 0.6 deg onto a fitted plane,
  vertices shared by runs to their least-squares point): the base then sewed
  closed with merged faces, but the upper arc still failed, bevels that
  worked before (the left hole's rim; a chamfer on a sewn emboss result,
  `recalcSewInput.test.js`) stopped working, and moving vertices up to 20 um
  folded sliver triangles until a fold-back guard was added. The upper arc
  alone fails on a CLEAN all-OCC stepped block too ("doesn't fit") while the
  whole rim works there: a bevel along an arc that ends against a step wall
  is an OCC limit, not only STL noise.
  The live preview must SAY when a bevel fails -- on the shared tool error
  line (`toolError` / `ToolErrorLine`, as emboss and draft do), in one short
  sentence: it used to swallow the error and keep its last good preview, so a
  too-big distance on the cog meant 30 s of nothing and a 4 s toast. The status
  line hides while a tool error shows -- it sits in the same place and covered
  the error's second line.
- **A hook placed after a component's early `return null` blanks the whole
  app.** The chamfer dialog's bevel-limit `useMemo` went below its "tool
  closed" return; opening the tool added a hook, React threw, and six e2e
  specs saw an empty white window. Vitest renders no components, so only the
  e2e suite catches this.
- **`UnifySameDomain` can merge a mesh into a face BRepMesh can't triangulate --
  and `TessellateInto` skips such a face SILENTLY.** On MultiSystem2's base STL
  (closed, 0 open edges) the import sew's coplanar merge made two faces that
  meshed to nothing: a 4 mm patch of the top vanished from the body and from
  every Split piece and cut built on it, and the recalc's input sew
  (`solidFromMesh`) lost them again on each rebuild. `MakeSolidFromMesh` now
  counts the merged result's open mesh edges (`OpenEdgeCount`) and keeps the
  unmerged faces when merging opened it (`meshSew.test.js`). Measured
  cost: +0.7 s on that 14k-triangle import; none visible on a 50k/100k-triangle
  curved mesh. Degenerate triangles already baked into a mesh (a Split's output
  had zero-area ones) still leave a zero-width gap; that is the input, not the
  sew.
- **Sewing can turn a PATCH of a correctly wound mesh inside-out.** Where the
  surface pinches (four triangles on one edge -- beside MultiSystem2's right
  boss), sewing's orientation pass, and `ShapeFix_Shell`'s, carries across the
  pinch onto the wrong side; the patch is drawn from behind and looks missing,
  though the shell is closed and its volume right. When the input is
  consistently wound (every edge walked equally often each way),
  `MakeSolidFromMesh`'s `adoptWinding` turns the sewn faces that disagree with
  their source triangle -- the SMALLER of the agree/disagree groups, never a
  fixed side: turning the larger one reversed the whole solid, the display and
  volume still looked right, and every overlapping boolean came back EMPTY
  while all unit tests passed. `meshSew.test.js` cuts through the piece to
  catch both.
- **A sewn triangle shell can come out INSIDE-OUT despite `OrientClosedSolid`.**
  Its point classification silently fails on sewn tessellations; an inside-out
  tool vanishes from a union and inverts a difference. `MakeSolidFromMesh`
  measures each solid with `BRepGProp::VolumeProperties` and reverses on negative
  volume — signed volume is ground truth. Keep that guard.
- **Do NOT hand-build a shared-topology shell to skip sewing.** Building faces
  from shared `TopoDS_Edge`s (index-buffer topology) is fast and yields a valid
  6-face solid, but downstream `chamfer`/`fillet` reject it ("no suitable edges")
  — the manual faces lack the pcurves/edge-sharing that sewing produces, and
  `ShapeFix_Shape` didn't fully repair it. Sewing is load-bearing for downstream
  op compatibility; the fast path is _cutting-off sewing_, not _no sewing_.
- **This is native-only — no `occOps.js` / `occ-bridge.cjs` op-body change.**
  The cancel range + fast-sew live entirely in the addon (shared by both JS
  impls), so the lockstep rule is satisfied by rebuilding the addon
  (`cd native/occ-addon && npm run build`). The only JS surface is the SAB
  plumbing (`main.cjs` / `occ-worker.cjs` / `occClient.cancelOcc`) and the
  `setCancelBuffer` re-export in `occ-bridge.cjs`. vitest can't exercise cancel
  (no worker) — validate abort behavior in the Electron app.

## Packaging the mac app (scripts/afterPack.cjs)

The addon links OpenCASCADE by `@rpath`, so the hook copies the dylibs into
`Contents/Resources/occ-libs` and patches paths. Three rules, each from a real
break:

- **Bundle the OCC the addon was COMPILED against.** The candidate list mirrors
  CMakeLists' HINTS (8.0.1, then 8.0, then `occ-<arch>`). It used to take
  `~/occ-<arch>` unconditionally, which shipped 7.9 dylibs beside an addon
  linked to 8.0.1.
- **Leave no absolute rpath in the .node, and give each copied dylib
  `@loader_path`.** An absolute rpath resolves on the build machine and nowhere
  else, so the bundle passes every local test and fails everywhere else; the
  dylibs need their own rpath because dyld resolves a dylib's `@rpath` siblings
  against THAT dylib's rpaths, not the addon's.
- **The hook throws if a required dylib is missing from the bundle**, so this
  fails the build instead of shipping an app that cannot load its kernel.

To check a build is self-contained, load the addon with the app's own binary
from an unrelated directory -- it then has only the bundled path to resolve
through:

```bash
ELECTRON_RUN_AS_NODE=1 release/mac-arm64/PurpleCAD.app/Contents/MacOS/PurpleCAD \
  -e "require('<abs path>/occ_addon.node'); console.log('ok')"
```

## Stress analysis and generative design

Lives in `src/three/fea/` and is documented in **`src/three/fea/README.md`** --
read that before touching any of it. It is a voxel FEA (stress colouring) and a
SIMP topology optimiser (generative design) over one shared load case, checked
against closed-form answers, with a dozen landmines recorded from the bugs that
produced them: node indexing, load transfer onto material that exists, grid
symmetry, ramp scaling, and why the stress material must be unlit.

Two things that reach outside that directory. Its workers CAN be terminated
mid-solve, unlike the OCC worker -- pure JS, no shared native state. And a
solved field is never stored on the item: it is mesh-sized, and items are
frozen into every downstream op's `regenerator.source`.

## Agent API (src/api)

Named commands that build, inspect and render a model, called as
`window.__api.call(name, args)` and documented in **`src/api/README.md`**. It is
the surface the planned MCP server exposes, so its contract is deliberately
stricter than the store's: mm in the user's Z-up frame only, a command returns
only once the model has settled, and nothing throws. New commands are covered in
`e2e/agent-api.spec.js` -- vitest cannot reach the scene or the OCC bridge.

## iPad app (ios/app)

The renderer in a WKWebView, and `occ-bridge.cjs` unchanged in JavaScriptCore
on its own thread -- documented in **`ios/app/README.md`**, with the Phase 0
measurements in `ios/spike/README.md`. Its contract with the renderer is
`window.electronAPI`: a renderer change that adds or reshapes an
`electronAPI` call has to land in `ios/app/PurpleCAD/js/electron-shim.js` too,
or it works on the desktop and silently does nothing on the iPad. The
iPad also runs `electron/kvStore.cjs` unchanged (over its own SQLite shim,
`js/db-host.js`), so a new `kvStore` query may use only the better-sqlite3
calls that shim provides -- `prepare().run/get/all`, `exec`, `pragma`,
`transaction` -- or the shim grows with it. Check a
change there with the smoke run (`--smoke`), in the simulator at least.

**Touch and the Pencil are the mouse and the wheel, not a second input
path.** `touchInput.js` turns pointer events of type `touch` / `pen` into
calls to the viewport's own `onMouseDown/Move/Up` and `onMouseWheel`, by the
rules in `touchGestures.js` (pure, `touchGestures.test.js`): the Pencil is the
mouse; a finger tap is a click, a one-finger drag the Shift+wheel orbit (a pan
in a sketch), two fingers the wheel pan plus `zoomBy`, a held finger the
sketch long-press menu, a double tap on empty space Home. A finger on a
transform handle drags it. Shift comes from the on-screen toggle
(`touchShift`). So a new mouse behaviour reaches the iPad for free, and a new
gesture belongs in the rules, not in a handler. `e2e/touch-input.spec.js`
dispatches the pointer events an iPad sends; WebKit's own side (no second,
compatibility click after a tap) can only be checked on an iPad.

## Variables / formulas

- Dimension distances, extrude depths, and chamfer/fillet parameters can
  be either bare numbers or formula strings referencing variables.
- Resolution happens through `geometryParams.js#resolveValue` (which
  reads variables from the store). Bare numbers are legacy scene-unit
  values; strings are user-facing mm formulas that get divided by
  `MM_PER_UNIT` after evaluation.
- Variable changes invalidate every regenerator's `regeneratedAt` flag so
  the next regen pass rebuilds downstream CSG / chamfer items.
- **The Electron bridge can't evaluate formula depths — resolve them BEFORE
  the IPC boundary.** `occClient.js#deepResolveDepth` converts every formula
  depth to a scene-unit number so the bridge only sees numbers (its
  `resolveDepth` does `parseFloat`, so `"Height-WallThickness"` becomes NaN →
  the 1-unit fallback and the body silently collapses). It must recurse into
  EVERY place a depth hides: `item.depth`, `regenerator.source` (chamfer/…),
  AND `regenerator.extrudeDefs` (the embedded prisms of `extrudeUnion` /
  `extrudeCut`). Missing the last one built a formula-height wall used as a cut
  HOST at 1 unit — a multi-hole cut that looked like a deep gouge on a collapsed
  box (`occClient.test.js` pins the extrudeDefs recursion).
- **`withLivePolygons` has the SAME recursion requirement for the SAME reason.**
  The bridge can't re-derive an extrude's profile from its sketch, so the
  renderer pre-bakes the live polygon2D into every item first. It must recurse
  into `regenerator.extrudeDefs` (a fused body's embedded prisms), not only
  `regenerator.source` — otherwise a fused body used as a cut HOST keeps its
  polygons frozen at the resolution they were saved at, so the extrude cut
  reverts to low-res curves while the same body shown standalone (whose defs are
  re-derived per-def in `regenerateExtrudeUnion`) is finer. occOps hides this
  (it re-derives in-process); only the bridge builds from the baked polygon
  (`withLivePolygonsFusedDefs.test.js`).
- **The bake now happens CENTRALLY at the occClient boundary — but an
  INTERACTIVE CSG caller that skipped it still shipped a stale profile.**
  `occClient.callOp`'s Electron branch runs `bakeArgPolygons` (live polygon)
  alongside `resolveArgDepths` (depth) on EVERY op's args, so any caller that
  hands raw items to `performCsg`/etc. gets the live polygon baked for free —
  the regen path already called `withLivePolygons` by hand, but the
  interactive extrude runners (`runExtrudeUnion`/`runCutExtrudes`/… in
  `extrudeBoolean.js`) did not, so a boss extruded onto a sketch's HOST solid
  reached the bridge with the host's FROZEN profile and rebuilt the host at its
  old shape ("Extrude N extends for no reason" after the source sketch was
  edited post-creation). Diagnosis dead-end worth remembering: the occOps
  (vitest) path CANNOT reproduce it — it re-derives internally — so a green
  unit run means nothing here; the divergence is bridge-vs-occOps, caught only
  by reasoning about the stored-polygon path (occClient.test.js pins
  `bakeArgPolygons` on `broken-extrude.pcad`, whose Extrude 2 froze a triangle
  over a live quad). Both `bakeArgPolygons` and `resolveArgDepths` are
  Electron-branch-only for the same reason: occOps handles both internally.

## Precision: prefer decimal.js

- **Strongly prefer `decimal.js` for any calculation where precision
  matters** — user-entered arithmetic, unit conversions (mm ↔ scene units),
  money-like/exact values, dimension rounding, accumulating sums, and
  anything whose result is shown to the user or stored. Native JS `+ - * /`
  carries binary-float noise (`0.1 + 0.2 = 0.30000000000000004`); decimal.js
  is exact in decimal.
- The formula evaluator (`utils/formulas.js`) and geometry-parameter
  resolution (`geometryParams.js` — `resolveValue`, `formatAsFormula`)
  already run on decimal.js. Keep new value-resolution / formatting code on
  the same path rather than reintroducing raw float maths.
- **Convert to a JS `number` only at the boundary** where the value is
  handed to three.js, WebGL/`Float32Array`, the OCC native addon, or the
  hot constraint-solver loops — those consume doubles and can't take
  `Decimal`, and Decimal in a per-frame/per-iteration hot path is far too
  slow. Do the exact maths in Decimal, then `.toNumber()` at the edge.
- decimal.js has no `hypot`/`sin`/`cos`; geometry/trig stays on doubles.
  The preference is about the numbers users type, see, and store — not the
  linear-algebra/geometry core.

## Coordinate system

- The SCENE is three.js Y-up; STL/STEP exports rotate `+π/2` around X to the
  Z-up convention every CAD reader assumes. Neither changes.
- **The UX shows a Z-up right-handed frame — the SAME frame as the exports:
  user X, Y, Z = internal x, −z, y.** Every UI surface that shows an axis
  letter or an axis-labeled value (transform panel, plane dialog, pattern
  spacing, the world axis indicator) maps through
  `src/utils/axisDisplay.js#DISPLAY_AXES`. A hardcoded axis letter in a
  dialog LIES about the internal component under it — new axis-labeled UI
  must route through that table (label + key + sign; the sign applies to
  signed quantities like position/rotation/spacing, never lengths/scales).
  `axisDisplay.test.js` pins the mapping to the export rotation.
- Caveat: per-component Euler edits map component-wise (user Y° = −rot.z,
  user Z° = rot.y); single-axis rotations are exact, but the COMPOSITION
  order of multi-axis Euler edits is still the internal XYZ order.
- Extrudes start at the sketch plane (base at local z=0, top at z=±depth)
  — they do NOT straddle the plane. Don't add midpoint-centering back.
- Negative depths are valid (backwards extrude). `THREE.ExtrudeGeometry`
  only takes positive `depth`, so negative-depth code paths extrude by
  `abs(depth)` then `translate(0, 0, -abs(depth))`.
- **An offset extrude CUT tracks the host face it was started from.** Its
  `startOffset` is a frozen scene-unit distance; if the body it cuts is later
  resized by a variable (a shorter `Height`), a fixed offset leaves the cut
  floating above the body and it removes nothing — "the cut isn't preserved".
  `regenerateExtrudeUnion` (the `isCut` branch) re-derives each prism's
  `startOffset` every regen from the host's LIVE far-face extent along the cut
  normal (`hostFaceExtentAlongNormal`) plus the authored `cutStartInset`
  (0 = start exactly at the face; stored at commit in `runCutExtrudes`; absent
  ⇒ 0, which is correct for old top-anchored cuts). Only prisms with a non-zero
  `startOffset` re-anchor — a cut from the sketch plane (offset 0) stays put.
  `cutTracksHostFace.test.js` drives the real shrink-Height repro.
  **The inset belongs to the offset it was measured for.** A cut made at offset
  0 stores inset 0 unmeasured; the timeline Edit (`retargetFusedExtrude`) used
  to change the offset and keep that 0, so the rebuild started the cut at the
  host's top -- MultiSystem2's boss cut ran 1.2 mm high and left a thin floor.
  Both paths now measure it with `cutStartInsetFor` (`cutOffsetEdit.test.js`).

## Display ↔ OCC-rebuild parity (the "reverts to an earlier state" bug class)

Every object exists as **two representations that must stay in lockstep**:

1. **What the renderer draws** — the mesh: analytic/`ExtrudeGeometry`/baked
   `geometryData`, placed by `mesh.position/rotation/scale` (three.js order
   `T·R·S`, with `S` per-axis in the LOCAL geometry frame).
2. **What OCC rebuilds** — `buildItemShapeLocal` (recipe/live-sketch) →
   `scaleLocal` → `transformShape`, positioned by `buildBrushTransform`.

Every operation on an existing body — boolean, split, chamfer/fillet,
shell/hole/emboss/draft, sweep, pattern, STL/STEP export, and timeline
regeneration — consumes representation #2. **The recurring bug is #2 silently
diverging from #1**, so the op applies to an earlier / different size, position,
scale, or resolution than what's on screen. The invariant to preserve:

> `worldBBox(OCC rebuild) == worldBBox(mesh geometry × mesh T·R·S)` for the
> same item, at the current live state.

Established landmines (each was a real bug — extend this list, never shrink it):

- **Per-axis scale.** `buildBrushTransform` returns the full `{x,y,z}`;
  `scaleLocal` applies uniform via `scaleShape`, non-uniform via the affine
  `scaleShapeXYZ`. Collapsing to `scale.x` silently drops a stretch.
- **Extrude centroid offset is UNSCALED.** The renderer adds it via
  `mesh.position` (which `mesh.scale` never touches); scaling it shifts a
  scaled extrude. A square profile hides this (centroid `(0,0)`) — test an
  off-centre profile.
- **Non-uniform scale is origin-sensitive.** It must hit the SAME geometry
  about the SAME origin the renderer uses. For a `csg` whose baked
  `geometryData` IS the display truth, a non-uniform scale must sew that baked
  mesh (`booleanInputLocal`), not a re-derived recipe that can build a
  differently-sized/centred shape.
- **Use the LIVE state, never a frozen snapshot.** Live sketch polygon
  (`extrudeWithLivePolygon`), current per-axis scale/rotation/position, current
  `printPrecision`. Timeline replay must apply every `transform` instruction
  (`applyInstruction`); regeneration must rebuild upstream inputs first.
- **The fix must land in BOTH OCC implementations.** `occOps.js`/`csgUtils.js`
  (tests) AND `electron/occ-bridge.cjs` (the shipped app). A green suite with an
  un-mirrored bridge is the trap that hid every bug above — see the ⚠️ note under
  "OCC execution boundary".
- **EVERY structural timeline mutation must relink + forward-invalidate.**
  Ops carry FROZEN source snapshots, so any change to entry ORDER — insert,
  delete, and REORDER — must run `relinkSourceChain` (re-bind each later op's
  source to the new accumulation) AND `dirtyEntriesFrom` (rebuild from the first
  affected index). `reorderHistory` once did neither: a chamfer moved before an
  emboss kept the embossed body as its source (chamfer step still showed the
  emboss) and the emboss re-stamped on its stale input (doubled relief) — steps
  chained to the old order's GEOMETRY, not the new order's OPERATIONS. When
  adding any new timeline mutation, mirror `deleteHistoryEntry`'s tail
  (`reorderRelink.test.js` is the template).
- **An edit invalidates from the first step it reaches, never the whole
  timeline.** A step only references what came before it, so
  `invalidateEdit` (internals.js) marks entries dirty -- and live bodies stale
  -- from the earliest entry the edit rewrote (`firstChangedIndex`); a
  variable starts at the first entry naming it or a variable computed from it
  (`firstEntryNaming`).  Only a resolution change marks everything.  The
  extrude edits used to mark EVERY entry: editing the last extrude of
  `recalc-overload.pcad` re-sewed its 14k-triangle import and re-ran every
  boolean and chamfer, 11.7 s for nothing.  Sketch edits marked NO entry, so a
  grown circle never reached the extrusion on it (`dirtyFromStep.test.js`).
  A new edit path returns `invalidateEdit(state.history, newHistory, items)`
  rather than `markCsgDirty` / `dirtyAllEntries`.
- **A relink that SWAPS the source kind changes the op's FRAME — two traps.**
  A relinked source is a different object delivering a different local frame (an
  extrude = raw local, z 0..depth; a csg = bbox-centred by its `centerOffset`),
  and relink binds the snapshot from the PRE-recalc accumulation, so its
  transform can be stale. Consequences (each was a real bug, both directions of
  the same reorder):
  1. _Emboss anchors are authored-frame absolutes._ The face point and
     developable `aMin/aMax` don't survive a frame swap — the relief jumped by
     half the body height. `commitEmboss` records `sourceCenterOffset` (the
     authoring frame) and `regenerateItems.js#shiftEmbossFrame` translates the
     anchors by (authored − current) each regen; `backfillEmbossFrames` derives
     the record for pre-existing documents at EVERY load path (it must run at
     load, while the frozen source is still the authored one).
  2. _`resolveChainedPosition`'s brush delta is only valid for the SAME source
     moving._ After a swap, (new brush − stored base) is a frame difference,
     not a movement — it double-counted and the whole object jumped. The
     orchestrator tracks items RECOMPUTED this pass; a later same-item op then
     refreshes `regenerator.source` from the accumulated pre-entry state (the
     live previous result — the JIT model) and drops the stored position to
     re-anchor from scratch. Gizmo moves are separate `transform` entries, so
     dropping is safe. GATED for boolean/extrudeUnion sources: their
     `originalCentre` re-localisation frame isn't reproducible from the
     accumulated item (refreshing broke the union-source chamfer recentring —
     `chamferRetargetPosition.test.js` is the guard).
     `reorderPosition.test.js` drives BOTH reorder directions of the real scene
     through the full store + recalc pipeline and asserts the world bbox never
     moves — extend it when touching relink/anchor code.
- **Not every op builds on the previous step's result — check `sourceDescribesPrev`.**
  An APPENDED chamfer merges the prior chamfer's selection and re-runs on the
  PRE-chamfer source; feeding it the previous entry's result (JIT cached solid /
  sewn mesh / refreshed snapshot) hands it a body whose selected rim was already
  beveled — coordinate matching misses, and the normal fallback then selects a
  ring's INNER rim too (the diametrically-opposite inner edge has the identical
  adjacent-normal pair — an inherent ambiguity of `NormalSetMatches` on
  revolved bodies, now guarded by `SameSideAsSpec`: the sign of
  dot(normal, midpoint − bodyCentre) must match between the stored segment and
  the candidate, so a stale selection skips gracefully instead of grabbing the
  opposite rim — the reorder-a-chamfer-before-the-emboss case). The orchestrator compares the frozen source's (type,
  regenerator kind) against the previous step's result; on mismatch the op
  rebuilds from its own recipe with no input shortcut (`chamferHighRes.test.js`).
  Relatedly, `attemptFaceRim` must feed only the WIRE(s) containing the selected
  edges — a holed face has separate inner/outer boundary wires.
- **A chained op's position must RE-ANCHOR to its live source, not be kept.**
  chamfer/emboss/hole/shell/draft/pushpull store `regenerator.basePosition` = the
  SOURCE brush position they were placed against. Each recalc,
  `resolveChainedPosition` shifts the item by how far that brush point moved
  (`regenerateItems.js`). Keeping the absolute position (the old code) meant an
  insert/edit that repointed the source via `relinkSourceChain` rebuilt the
  geometry on the NEW source while the position stayed pinned to the OLD one — the
  recurring "insert a chamfer after a chamfer shifts the body" bug. Key it on the
  brush point ALONE, never `centerOffset`: a resolution change re-tessellates and
  nudges the bbox centre, and re-anchoring on that would jitter the body every
  toggle. Every commit/edit path that sets `position` must also store
  `basePosition` (else the next recalc computes a spurious delta) — gizmo MOVES
  are separate `transform` instructions, so `basePosition` re-anchoring preserves
  them for free.
- **STL/STEP export builds from the BAKED mesh, not a recipe rebuild.**
  `exportLocalSolid` (both OCC impls) sews each item's `geometryData` — the exact
  high-res mesh already on screen at the active precision — into a solid via
  `makeSolidFromMesh(pos, idx, /*skipCaps*/ true)`, and only rebuilds the recipe
  (`buildItemShapeLocal`) for items with no baked mesh (primitives / extrudes).
  Rebuilding the recipe re-runs the whole OCC chain (slow) and for an emboss/csg
  re-derives geometry that DIVERGES from the baked view. `skipCaps` bypasses the
  boolean-safety tri/face caps AND the coplanar `UnifySameDomain` pass — export
  only tessellates/writes the solid, never booleans it, and unify is slow + alters
  the triangles. Do NOT reintroduce the timeline solid cache here: it's keyed by
  ENTRY id (not item id) and is sparse (clean steps retain nothing), so an
  item-id lookup silently misses and every export falls back to the slow rebuild —
  the exact bug this replaced.

- **An extrude's profile is matched back to its sketch by a stale POINT — a
  later shape drawn there steals it.** `profileCentroid` is the point that was
  CLICKED at create time; nothing moves it when the sketch is edited, and the
  retarget preselect deliberately carried it over. Move the shape and draw a
  new one over the abandoned spot and the rebuild hands the extrude to the new
  shape (a second cog in one sketch swapped a 20-tooth gear for a 28-tooth one
  — geometry AND position). Matching now narrows to the shape the profile was
  built from (`textShapeIdx`, via `regionsForProfile`/`regionsWithShapes` in
  `closedLoops.js`) before any geometry test, falling back to geometry when
  that index no longer resolves (a deleted shape renumbers the rest), and
  `profileAnchor` refuses to containment-test an anchor that has fallen outside
  its own stored outline. **An op's FROZEN source is the case to test**: the
  extrude ITEM's outline is kept live, so every single-function check on it
  passed while the chamfer — which rebuilds from a snapshot whose outline and
  anchor are stale TOGETHER — still came out on the wrong cog.
  `extrudeStaleAnchor.test.js` drives the real document through the store and a
  full recalc for exactly that reason.
  A profile now also records WHICH SKETCH SHAPES bound it (`loopShapes`: the
  outer loop's shape indices and each hole's), and `regionsForProfile` /
  `bestProfileMatchIndex` narrow by that first.  Concentric rings defeated
  every geometric test: they share an anchor and a centroid, and once grown 4 %
  a ring's stored area is nearer its neighbour's -- Extruded 5 in
  `recalc-overload.pcad` took the inner ring twice (`profileLoopShapes.test.js`).
  Older documents get `loopShapes` at load (`backfillLoopShapes`) only where the
  sketch still has exactly one region matching the stored outline.

- **A profile carries its exact curves (`curves2D`), and every copy of it
  must too.** The polygon is samples; `curves2D` records which polygon edges
  lie on which arc / bezier / ellipse (`{start, count, ...}` runs, edge k from
  vertex k to k+1), and extrude, revolve, sweep (profile AND path) and loft
  build exact OCC edges from it, so a bore is one cylindrical face rather than
  one plane per sample (`exactCurveExtrude.test.js`). The runs index the
  polygon's vertices: anything that re-derives or reverses the polygon must
  re-derive or move the runs with it (`extrudeWithLivePolygon`, `windLoop`),
  and anything that copies a profile field by field must copy `curves2D` (the
  sweep tool's copies once dropped it). A profile WITHOUT `curves2D` -- every
  document from before -- deliberately stays faceted: its saved chamfer and
  face selections were picked on the facets.
- **A Split's pieces are re-cut from their source, not kept as baked
  meshes.** They used to carry no recipe, so a resolution change (or an
  upstream edit) never reached them -- MultiSystem2's extruded circles stayed
  blocky through four Splits. A plane-split piece carries `regenerator:
  { kind: "split", sourceId, plane, side }`; the recalc re-cuts a Split step's
  pieces TOGETHER (`isSplitGroup` / `regenerateSplitGroup` -- a createGroup
  has no single `geomTargetId`), and a later op builds a piece by RE-CUTTING
  its source too (`splitPieceLocal`, both OCC implementations), framed on the
  recipe's `center` (where the piece's mesh is centred; a piece may have been
  moved since). It used to sew the piece's baked mesh, as for `simplify`: a
  float32 copy whose "flat" faces aren't, so a chamfer the unsplit body took
  at once failed instantly on its piece (`splitPieceChamfer.test.js`). A
  piece whose re-cut was refused (`regenFailed`) still sews its mesh. A re-cut must divide the source AT the plane or
  it is refused: a plane lying on one of the source's faces grazes it and
  OCC's difference returns the WHOLE body. Old documents get the recipe at
  load (`backfillSplitRecipes`: the plane both pieces have a face in, facing
  each other, checked to separate them). Mesh-fallback splits get none
  (`splitResolution.test.js`).
- **Frozen sources nest — NEVER let dense meshes ride the chain.** Each op's
  `regenerator.source` snapshot contains the prior item INCLUDING its
  `geometryData` and ITS nested source… stacking ops on one body stores
  O(k²) mesh copies (three 90k-tri displacement maps OOM'd the renderer at
  1.4 GB when the path tracer allocated on top). `pruneNestedSourceGeometry`
  (`textureDisplace.js`) keeps the level-1 baked mesh (the rebuild base) and
  strips `geometryData` from everything deeper — recipes/frames/params stay.
  Apply it when committing any op whose results are mesh-dense, and guard
  unbounded density up front (`assertTriBudget` — both the tool AND regen
  paths; the regen path missing it OOM'd vitest before the guard). Density
  guards are TWO-layer: the pre-flight estimate carries a measured slop
  factor (bisection refinement of pathological OCC wall tessellations ran
  3–10× the equilateral estimate — a 9.4M-tri mesh where 0.6M was expected),
  and `refineMesh` enforces the `HARD_MAX_TRIS` ceiling DURING refinement as
  ground truth. Estimates alone cannot see sliver cascades.

**Checklist when adding/altering any op or feature that touches existing bodies:**

1. Route through the shared `buildItemShapeLocal` + `buildBrushTransform` +
   `scaleLocal` + `transformShape` path — don't hand-roll a second transform.
2. Honour per-axis scale AND rotation AND position together (full `T·R·S`).
3. For a `csg` with baked `geometryData`, a non-uniform scale uses the baked
   mesh, not a recipe re-derivation.
4. Read the item's live state, not a value cached at create time.
5. Add a regression test in `src/three/occ/__tests__/occ.smoke.test.js` that
   would FAIL if the op ignored scale/rotation/position — assert the OCC world
   bbox equals `display-local-size × scale` (the existing "boolean … respects …
   scale" tests are the template). Prefer an off-centre / non-uniform / rotated
   case, since symmetric ones mask offset and origin errors.

**Keeping the list current:** whenever a new "applies to an earlier state" bug
surfaces, the fix is not done until (a) a regression test lands in the smoke
suite and (b) a one-line landmine is appended above. Treat that list as
append-only institutional memory — the next feature reads it before touching
the rebuild path.

## Tool dialogs: create + edit symmetry

Every tool that produces a persistent output (a `csg` item, a sketch
modification, an offset, etc.) gets BOTH a creation UI and an edit path that
re-opens the SAME UI — never a create-only flow.

- **Creation UI.** 3D Modify tools (Hole, Shell, Push/Pull, Emboss, Draft,
  Revolve, …) use a bottom-bar overlay (`overlayBar.js` — `BAR_STYLE`, `LBL`,
  `barBtn`, `pickBtn`) with pick phases and a live, debounced ghost preview
  (`useDebouncedPreview`, `useEscapeKey` from `inputs.jsx`). Simpler
  parametric creators (Box, Plane, Split, Mirror, Pattern) use a portal dialog
  mounted in `Viewport.jsx`. A phase machine in `uiSlice.js` (e.g. `holeTool`,
  `embossTool`) holds the in-progress picks/params; Cancel/Esc removes the
  in-progress output via the per-item/per-sketch undo.
- **Committed output carries its recipe.** Confirm writes a `csg` item whose
  `regenerator: { kind, …sources, …params, regeneratedAt }` can rebuild the
  geometry from its live sources; `regenerateItems.js` re-derives it when an
  upstream sketch/body changes.
- **Edit re-opens the same UI.** The Timeline step gets an **Edit** button
  (`beginHoleEdit`/`beginEmbossEdit`/…) that re-enters the tool's params phase
  seeded from the frozen recipe, plus **Retarget** where a source can be
  re-picked. Editing updates the entry IN PLACE (`updateHoleEntry`,
  `updatePushPullParams`, `retarget*Entry`) — no new timeline step.
- **Sketch-value edits mirror this too.** A dimension / offset / chamfer size
  opens the shared distance-input overlay (`SketchOverlays.jsx`); double-clicking
  the committed constraint re-opens the same input seeded from its stored value,
  and Cancel restores the prior value (offsets live-preview, so Cancel re-previews
  the original rather than undoing).

When adding a new output-producing tool, follow this: build the create overlay/
dialog, store a regenerator recipe, and wire a Timeline Edit (and Retarget where
sources are picked) that reuses the creation UI.

## Misc

- **The app window never navigates.** A web link calls
  `window.electronAPI.openExternal(url)` (main opens http(s) only in the system
  browser; anything else is refused). `main.cjs` backs this up: a new-window
  request or a navigation to another origin is cancelled, and a web address
  goes to the browser instead. In e2e, Playwright keeps waiting on a navigation
  the app cancelled and will not click anything afterwards, although Electron
  reports it isn't loading and the page works -- so a test that provokes one
  does it LAST (`smoke.spec.js` "license links ...").
- **Persistence is load-once, write-through -- and the store exists only
  after the load.** `src/store/db.js` fetches settings, the project list and
  the active project's data once (`initDb`, before `main.jsx` imports the app),
  serves reads from that cache, and writes through asynchronously; a project
  is `loadProject`ed before a switch reads it, so project switch / create /
  delete / duplicate are async. It used to be ~25 synchronous IPC calls, which
  an iPad web view can't make. The one synchronous channel left
  (`dbCallSync`) is for writes made while the window unloads. Because
  `window.__store` now appears a moment after the page loads, an e2e
  `beforeAll` must wait for the app (`.toolbar`) before ANY test touches the
  store: a failure restarts the worker, and the next test otherwise meets an
  app still loading (`smoke.spec.js` lost two tests that way).
- **A new item's id comes from `maxItemId(history) + 1`, never a local
  count.** Four hand-rolled counters scanned only single `create` steps and
  missed a Split's `createGroup` pieces: in MultiSystem2 a new sketch took a
  deleted piece's id and a merged extrude took the surviving piece's, so two
  objects shared an id (a doubled object-list entry; the extrude Edit opened
  on the piece). `itemIdAfterSplit.test.js` fails if that counting pattern
  reappears anywhere in `src`.
- The `_cameraControls` slot on the store is a deliberate non-reactive
  handle for toolbar buttons that need access to viewport helpers (eg
  `dropSelectedToGround`). Don't `useStore.subscribe` to it.
- Per-frame constant-on-screen-size scaling for the axis indicator,
  transform handles, and bounding-box dimension labels happens in
  `cameraControls/animateLoop.js` — don't scale them elsewhere or the
  per-frame pass will fight you. Each entry caches its authored scale
  on userData.baseScale on first sight.
- **Sketch constraint markers are the toolbar's icons, OFFSET from their
  anchor in screen pixels** (`sceneObjects/constraintIconSprites.js`:
  `CONSTRAINT_ICON_OFFSET_PX`, `CONSTRAINT_ICON_SIZE_PX`). Each is a sprite whose
  `center` is moved off the quad, so the anchor stays on the geometry while the
  picture sits beside it; the render loop sizes it in pixels every frame. A
  distance's marker is tied to its value label instead (`besideLabel`) and is
  re-placed every frame beside the label's TEXT, whose on-screen width changes
  with the view. The
  artwork is the same component the toolbar renders
  (`components/icons/constraintIconArt.jsx`) -- change an icon there, not in
  two places. Anything that hit-tests a constraint must go through
  `constraintIconScreenPos`, which adds the offset; projecting
  `constraintIconLocalPos` alone aims at the anchor, where the marker no longer
  is (an e2e click that did that silently selected the point underneath).
- **Components are the tree's folders.** The UI says "Component"; the data
  model is still `folders` / `folder-N` ids. A component can carry a
  `motion` (rotation about, or a slide along, a picked axis) -- saved on the
  folder, and folders are now written into the .pcad (they used to be lost on
  a file round trip). Playing a motion is DISPLAY ONLY
  (`componentMotionTool.js` moves meshes from a captured rest pose and puts
  them back); it never touches items or the timeline. Collision detection
  (`componentCollision.js`, three-mesh-bvh) counts only surfaces that CROSS:
  coplanar faces and faces meeting along a shared edge are contact, and pairs
  already crossing at rest (a pin in its hole) are ignored for that run. The
  BVH is built `indirect` -- by default it reorders the rendered geometry's
  index in place, which picking reads.
- **Text and the cog are "contour primitives": one shape, several cached closed
  outlines relative to its `x, y`, locked by a same-named constraint.** Their
  outlines bypass the pairwise-intersect loop finder (`closedLoops.js` feeds
  them in directly) and are drawn contour by contour (`sketchOverlays.js`
  `contourShape`); deleting the constraint explodes them into lines. A new
  primitive of this kind has to be added to BOTH of those, to `translateShape`
  / `rotateShape` / the extent points in `sketchGeometry.js`, to `sketchTrim`'s
  skip list, and to the double-click editor list in `sketchClickHandler.js`.
  An outline must have no zero-length segment: OCC's wire builder rejects the
  whole profile (the cog's first cut had a duplicated base-circle point).
- **Sketch region finding enumerates EVERY simple cycle -- and that explodes
  on overlap.** `findClosedLoopsWithShapes` returns each cycle through the split
  arcs/lines, which includes every union of adjacent regions, and
  `groupLoopsWithHoles` is all-pairs over them. Six overlapping circles (a
  pasted set of three concentric circles nudged over its original) gave 6211
  loops / 1.28M points and 142 s of grouping on the main thread: the whole
  window stopped taking input, with nothing in the console. The DFS step budget
  did not help -- it bounds the search, not the OUTPUT. Past
  `MAX_ENUMERATED_CYCLES` (128) the finder now returns the arrangement's faces
  instead (`arrangementFaces`: half-edge tracing, linear); below it the output
  is unchanged, because saved extrudes are matched against it, unions
  included. Region finding runs on EVERY sketch change, so anything slow here
  is paid per nudge. Also: the splitter only divides a line where another
  CROSSES it (`lineCrossIntersect` rejects endpoint parameters), so a line
  that merely ENDS on another does not split the region (`loopFaces.test.js`).
- **The 3D ground ruler is centred on the RAW camera target — never add a
  screen-space shift to it.** The compact axis indicator shifts right by
  `camRight * halfPanelWidth` to clear the left panel, but `camRight` rotates
  with the view; applying that same shift to the spread-out ruler swept the
  whole grid of numbers around the target on every orbit ("the ruler jumps
  when rotating after a pan"). `updateRuler3D` takes `targetRef.current.x/z`
  directly.
- **A ruler row viewed edge-on garbles into overlapping text — this is
  expected geometry, not a position bug.** Each label is scaled to render at a
  CONSTANT on-screen size regardless of distance (`animateLoop.js`'s
  `gizmoScale` per label), but that only fixes apparent SIZE — it can't fix
  POSITION compression. When the camera's forward direction swings close to
  parallel with a row's own axis (continuous during any orbit), evenly-spaced
  world points compress toward the vanishing point and same-size neighbouring
  labels overlap into an illegible cluster. The fix is `ndcGapPx` +
  `rulerFadeOpacity` (`sceneSetup.js`): project the label and its next grid
  step through the camera, measure the actual on-screen pixel gap, and fade
  the label out below a legibility floor — don't try to reposition anything,
  the positions are already world-stable and correct (`rulerFade.test.js`).
- **That crowding check must not project a "next step" point that's BEHIND the
  camera.** `Vector3.project()` doesn't clip it — it divides by a negative w
  and can flip/explode the NDC coords — spiking the measured gap to garbage
  and snapping a label's opacity discontinuously (a blink/teleport) instead of
  fading smoothly. `pointBehindCamera` (`sceneSetup.js`) gates the check: skip
  it and stay fully opaque when the neighbour is behind the camera's view
  plane, since it isn't actually crowding the on-screen label.
- **The 3D ground ruler's cross-point is rebuilt fresh, every frame, from the
  CAMERA's own forward ray — never from `targetRef.current` (the orbit pivot).**
  `navigation.js`'s `setOrbitAnchor` (fired on the FIRST tick of a new
  Shift+scroll session) reassigns that pivot INSTANTLY, in one frame, to
  wherever the screen-centre ray hits — the model's surface once "Home" has
  framed it, i.e. on essentially every rotate right after resetting the view
  (measured directly against `test-files/bad-cut-extrude.pcad`: target
  `(0.42,-1.20,2.56)` → `(2.62,1.00,4.76)`, camera distance 30.1 → 26.3, in one
  frame). Three rounds of gliding the tracked centre past that reassignment
  (position-only threshold, then position+viewHeight, then a smoothstep ease)
  each closed one gap but not the next — the deeper problem was chasing a
  bookkeeping variable that can be arbitrarily reassigned at all. The fix:
  `groundRayCrossing` (`sceneSetup.js`) takes the camera's position + its
  ACTUAL forward ray through the centre of the _visible_ 3D area (canvas minus
  the left panel) and intersects it with the ground, called fresh every frame
  with no persisted "target" reference. The camera's true orientation has no
  discontinuity — it only ever changes by exactly how much input actually
  rotated it — so this needs no smoothing at all. Orbiting around a
  ground-level pivot keeps the crossing point pinned almost exactly to that
  pivot throughout, matching the old behaviour for the common case, but
  leaves nothing for the anchor-recentre to unsettle. Verified against the
  live repro: the fine tier (105 labels) no longer flips at all through the
  same rotate that used to flood it in one frame.
- **The ruler's ground-ray crossing read the camera's transform ONE FRAME
  STALE — every wheel tick while rotating flickered the numbers on the
  off-axis coordinate.** `renderer.render()` (end of `animate()`) is what
  normally refreshes `camera.matrixWorld` via the scene graph (the camera is
  `scene.add`ed), but the ruler block reads it EARLIER in that same frame
  (`unproject`/`project` for the ground-ray and label-fade projections).
  Without an explicit `cam.updateMatrixWorld()` first, the FIRST rendered
  frame after any position/orientation change (each wheel tick while
  rotating) computed the crossing from the PREVIOUS frame's transform, then
  self-corrected the very next frame once `render()` caught up — confirmed
  by instrumented logging showing the SAME `camPos` producing two different
  `(x,z)` values, the first one only ever appearing for exactly one frame.
  Visually this read as "the ruler numbers jiggle on the opposite axis to
  the one they label": each label's OWN-axis coordinate is quantized to a
  grid step (invisible for a one-frame swap unless it's near a step
  boundary), but the ROW's off-axis coordinate (`cz`/`cx` shared by the whole
  row) is continuous and flickered directly. Fix: `cam.updateMatrixWorld()`
  at the top of `animateLoop.js`'s per-frame UI-overlay block, before
  anything reads the camera's world transform. Not covered by an automated
  test — it's a render-loop frame-ordering issue, not a pure-function bug,
  and a screenshot-diff test risks GPU-timing flakiness; verified only via
  instrumented reproduction (see this bullet and don't regress the ordering).
- **`panelAwareLookAt`'s compensating yaw used the WRONG rotation axis —
  the pivot swung left/right as the view was rotated up/down (pitch
  changed).** It used `camera.rotateOnWorldAxis(worldY, angle)`, which is
  only equivalent to a pure horizontal-NDC shift when the camera is looking
  level (pitch 0) — as pitch moves away from level, rotating around the
  WORLD Y axis instead of the camera's OWN current up vector picks up a
  roll-like component, so the resulting NDC-x shift of the pivot varies with
  pitch instead of staying constant. Fix: `camera.rotateOnAxis(localY,
angle)` — `rotateOnAxis` treats its axis as LOCAL (object-space), i.e. the
  camera's own up post-`lookAt`, which keeps the yaw a pure horizontal shift
  at any pitch. `panelAwareLookAt.test.js` pins this directly (a pure-camera
  unit test, no e2e needed): project the pivot at a spread of pitch angles
  and assert NDC-x stays constant — confirmed this test actually fails
  against the old `rotateOnWorldAxis` code (a real ~0.09 NDC swing at pitch
  ±1.4 rad), not a tautology.
- **The orbit-anchor ring itself had the same "wrong centre" bug — and fixing
  only the raycast (not the camera's actual orientation) left it half-fixed
  AND introduced a new jerk.** `getOrbitAnchor` raycasts through
  `(panel/canvasW, 0)` instead of raw NDC `(0,0)`, matching `handleHome`'s
  visible-area centring. But `camera.lookAt(target)` ALWAYS puts `target` at
  raw NDC `(0,0)` no matter which world point `target` is — a structural
  property of a symmetric lookAt, proved by measurement (shifting which point
  is picked only shifts the rest of the scene the wrong way once the camera
  re-centres on it). So sampling the anchor off-centre and then `lookAt`-ing
  onto it is a REAL camera reorientation, not a no-op: on `bad-cut-extrude.pcad`
  after a plain pan, the first Shift+scroll tick recomputed `targetRotationY`
  from 0.785 to a base of 0.668 (a real ~6.7° swing) purely from this
  mismatch — "holding shift while panning jerks back to a previous spot".
  Fix: `panelAwareLookAt` (`sceneSetup.js`) calls `camera.lookAt(target)` then
  applies an ADDITIONAL yaw (`rotateOnWorldAxis`, sized from the camera's
  horizontal FOV) so `target` renders at NDC `(+frac, 0)` — the visible area's
  true centre — instead. This must be the ONLY panel-compensation mechanism,
  applied at EVERY 3D-view (non-sketch) lookAt call site: initial camera
  creation (`sceneSetup.js#createCamera`), every `navigation.js` pan/zoom/orbit
  branch, the Home/orientation-change tween (`animateLoop.js`), and the
  projection-mode-switch camera recreation (`useViewportCamera.js`) — missing
  even one reintroduces the mismatch at that boundary. Two things that already
  assumed the visible-area centre (`getOrbitAnchor`'s raycast and the ruler's
  `groundRayCrossing`) were already correct and stayed unchanged; `handleHome`
  dropped its own asymmetric `frame` parameter (would double-compensate now
  that the tween's lookAt does it) and the axis indicator dropped its
  `camRight`-based manual shift for the same reason. Verified empirically: the
  pivot's projected NDC-x stayed ~0.1456 (`= panel/canvasW`, exactly the
  expected visible-centre value) across Home, a pan, and every subsequent
  rotate tick — where before the fix it would read ~0 (raw canvas centre).
- **Re-anchoring the orbit pivot on every NEW Shift+scroll session — even
  when nothing panned in between — drifts the pivot on a mere PAUSE.**
  `getOrbitAnchor`'s panel-shifted crosshair ray is not the rotation axis
  itself; as the camera orbits a fixed `target`, that ray sweeps a cone
  around it rather than tracing the same 3D point. Re-sampling it (which used
  to happen unconditionally whenever `shiftScrollSessionTimer` had lapsed —
  the ring-hide timeout, ALSO reused as "should I re-anchor") lands on a
  nearby but different point than the existing `target` even with the camera
  completely stationary, at a magnitude that scales with distance-to-surface
  — "hold shift, rotate, pause half a second, rotate again: view jumps".
  **First attempt (event-classification flag, insufficient) then GROUND-TRUTH
  fix (`navigation.js`):** a boolean set by "did a pan branch run this event"
  fixed every synthetic repro but real trackpad hardware can still deliver a
  wheel event MISCLASSIFIED as a pan during what the user experiences as one
  continuous rotate gesture (a momentum-scroll tail after an earlier real pan,
  or a modifier-key race on the first event of a new gesture) — the flag
  can't tell a genuine pan from a misclassified blip, so it can still
  re-anchor onto a bogus point. The robust fix compares AGAINST GROUND TRUTH
  instead of trusting event classification: every session start still
  raycasts a fresh anchor, but only APPLIES it (`setOrbitAnchor`) when it
  differs from the EXISTING `target` by more than `ANCHOR_STABLE_FRACTION`
  (5%) of the current view distance — scaling with distance matches "varies
  with zoom" directly. Below that, it's resampling noise (a pause, OR a stray
  sub-threshold blip that nudged `target` by a hair) and is left alone,
  keeping only the ring redrawn. A real, deliberate pan moves the visible
  centre by far more than 5% of view distance, so it still re-anchors
  correctly. `orbit-anchor-session.spec.js` pins both directions (pause alone
  must not move `getViewTarget()`; a pan before rotating still must) — a
  third case (a tiny non-shift "blip" injected mid-pause) was hand-verified
  to no longer amplify into a full re-anchor jump, though hardware-specific
  momentum/modifier-race timing couldn't be reproduced in Playwright's
  synthetic wheel events, so treat real-device testing as the final word here.
- **A ruler-centring fix needs to be verified with SCREENSHOTS at realistic
  frame intervals, not just a numeric log of state.** An earlier glide
  attempt's numeric trace looked "gradual enough" (tier flipping over several
  ticks), but screenshotting the same rotate at 20ms intervals showed almost
  the entire label set changing within the first couple of frames — an
  ease-out cubic front-loads ~24% of its motion into the first 9% of its
  duration, which is mathematically continuous but visually indistinguishable
  from a snap. Keep this in mind for ANY future "is this transition smooth"
  claim on this ruler.
