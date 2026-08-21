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
```

**Run the e2e suite through podman** (`npm run test:e2e:podman`). It builds
the addon, rebuilds better-sqlite3, builds the VITE_E2E renderer and runs
Playwright under xvfb inside the container, so a run doesn't depend on the
state of the host toolchain or steal the desktop's focus. Build the image
once with `npm run e2e:image` (~15 min the first time -- the OCC 8.0.1 source
build is its own layer and is reused by every later app-code rebuild; app
edits rebuild only the COPY layers, ~1 min). The podman VM needs more than
its 2 GiB default: `podman machine set --memory 8192 --cpus 8`.

The container is an ADDITIONAL lane, not a replacement. Its addon links a
LINUX OCC, so it verifies the JS/renderer/store/IPC surface but NOT the exact
native binary the shipped macOS app runs -- run `npm run test:e2e` on macOS
before a release, and whenever a change touches `binding.cc` or the addon
build. `E2E_NO_SANDBOX=1` (set in the image) makes `e2e/launch.js` pass
`--no-sandbox`, which rootless containers require; the macOS run keeps the
sandbox on.

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
  `bridgeParity.test.js` (src/three/occ/__tests__) machine-checks the core
  ops by running BOTH implementations and diffing the geometry — extend it
  when adding an op — and `e2e/bridge-parity.spec.js` covers the real IPC
  path.  Those catch result drift; a bridge-only crash or an op the suites
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
- **The addon must compile under BOTH clang and gcc.** macOS dev builds with
  clang; the Linux e2e container and `dist:linux` build with gcc, and gcc is
  the stricter of the two. The trap already hit: gcc rejects copy-initialising
  a base handle from a factory's derived return value
  (`Handle(Geom2d_Curve) c = GCE2d_MakeSegment(...).Value();` →
  "conversion from 'handle<Geom2d_TrimmedCurve>' ... requested") while clang
  accepts it, so the short spelling builds green on macOS and breaks Linux
  only. Bind the derived handle to its own name first, then upcast. Verify a
  gcc build (`npm run e2e:image`) after touching `binding.cc`.
- OCC 8.0.0 removed `TopTools_ListIteratorOfListOfShape.hxx`. Iterate
  `TopTools_ListOfShape` (an `NCollection_List`) with a range-based `for` loop
  instead of that iterator. If a future OCC bump reintroduces a similar
  removed-header break, prefer the range-based-for fix over re-adding the old
  header.
- `BooleanOp`'s union path (`binding.cc`) sets `SetFuzzyValue(1e-5)` on the
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
2. **Native polls it.** `binding.cc` aliases the SAB as `g_cancelPtr`
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
    the exception: `(true,true)` — cutting-ON *hangs* resolving the wrapped
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
  `binding.cc`'s `Init` calls `OSD::SetSignal(Standard_False)`: hardware faults
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
  op compatibility; the fast path is *cutting-off sewing*, not *no sewing*.
- **This is native-only — no `occOps.js` / `occ-bridge.cjs` op-body change.**
  The cancel range + fast-sew live entirely in `binding.cc` (shared by both JS
  impls), so the lockstep rule is satisfied by rebuilding the addon
  (`cd native/occ-addon && npm run build`). The only JS surface is the SAB
  plumbing (`main.cjs` / `occ-worker.cjs` / `occClient.cancelOcc`) and the
  `setCancelBuffer` re-export in `occ-bridge.cjs`. vitest can't exercise cancel
  (no worker) — validate abort behavior in the Electron app.

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
- **A relink that SWAPS the source kind changes the op's FRAME — two traps.**
  A relinked source is a different object delivering a different local frame (an
  extrude = raw local, z 0..depth; a csg = bbox-centred by its `centerOffset`),
  and relink binds the snapshot from the PRE-recalc accumulation, so its
  transform can be stale. Consequences (each was a real bug, both directions of
  the same reorder):
  1. *Emboss anchors are authored-frame absolutes.* The face point and
     developable `aMin/aMax` don't survive a frame swap — the relief jumped by
     half the body height. `commitEmboss` records `sourceCenterOffset` (the
     authoring frame) and `regenerateItems.js#shiftEmbossFrame` translates the
     anchors by (authored − current) each regen; `backfillEmbossFrames` derives
     the record for pre-existing documents at EVERY load path (it must run at
     load, while the frozen source is still the authored one).
  2. *`resolveChainedPosition`'s brush delta is only valid for the SAME source
     moving.* After a swap, (new brush − stored base) is a frame difference,
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
  brush point ALONE, never `centerOffset`: a resolution toggle re-tessellates and
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

- **Frozen sources nest — NEVER let dense meshes ride the chain.** Each op's
  `regenerator.source` snapshot contains the prior item INCLUDING its
  `geometryData` and ITS nested source… stacking ops on one body stores
  O(k²) mesh copies (three 90k-tri displacement maps OOM'd the renderer at
  1.4 GB when the path tracer allocated on top).  `pruneNestedSourceGeometry`
  (`textureDisplace.js`) keeps the level-1 baked mesh (the rebuild base) and
  strips `geometryData` from everything deeper — recipes/frames/params stay.
  Apply it when committing any op whose results are mesh-dense, and guard
  unbounded density up front (`assertTriBudget` — both the tool AND regen
  paths; the regen path missing it OOM'd vitest before the guard).  Density
  guards are TWO-layer: the pre-flight estimate carries a measured slop
  factor (bisection refinement of pathological OCC wall tessellations ran
  3–10× the equilateral estimate — a 9.4M-tri mesh where 0.6M was expected),
  and `refineMesh` enforces the `HARD_MAX_TRIS` ceiling DURING refinement as
  ground truth.  Estimates alone cannot see sliver cascades.

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

- The `_cameraControls` slot on the store is a deliberate non-reactive
  handle for toolbar buttons that need access to viewport helpers (eg
  `dropSelectedToGround`). Don't `useStore.subscribe` to it.
- Per-frame constant-on-screen-size scaling for the axis indicator,
  transform handles, and bounding-box dimension labels happens in
  `cameraControls/animateLoop.js` — don't scale them elsewhere or the
  per-frame pass will fight you. Each entry caches its authored scale
  on userData.baseScale on first sight.
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
  ACTUAL forward ray through the centre of the *visible* 3D area (canvas minus
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
