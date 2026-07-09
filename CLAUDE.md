# Working notes for Claude

This file captures conventions and expectations established while iterating
on this codebase. Read it before making changes.

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
npx vitest run         # all 433+ tests, runs in ~7s
npx vite build         # production bundle, ~3s
```

Both must succeed before declaring work done. The build sometimes catches
issues vitest misses (native module leaking into the renderer bundle, etc.).
Vite 4.5.x is pinned; `vite.config.js` marks `occOps.js` as external so
the Node.js `createRequire` usage doesn't pollute the browser bundle.

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
- **500-line ceiling.** As soon as a file grows past ~500 lines of code,
  look to split cohesive functionality into sibling modules (and re-export
  from the original if it's an import hub). Don't let modules sprawl;
  prefer a small focused file per concern. Test files are exempt from the
  hard ceiling but still benefit from topic-based splitting when large.

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
  Vitest cannot catch a bridge drift (it never loads the `.cjs`); the only
  guard is this rule + a manual Electron smoke check.

## Native OCC addon (native/occ-addon)

- Built against OpenCASCADE 8.0.0 at `~/occ-8.0-arm64`. CMakeLists' `find_package`
  HINTS list that path first, falling back to `~/occ-arm64` (7.9.0, the prior
  install) and then system Homebrew paths — the same source builds against
  either version.
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
    (a clean OCC tessellation — cutting is safe). The **conform emboss STAMP** is
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

- Viewport is Y-up. STL/STEP exports rotate `+π/2` around X to match the
  Z-up convention every CAD reader assumes.
- Extrudes start at the sketch plane (base at local z=0, top at z=±depth)
  — they do NOT straddle the plane. Don't add midpoint-centering back.
- Negative depths are valid (backwards extrude). `THREE.ExtrudeGeometry`
  only takes positive `depth`, so negative-depth code paths extrude by
  `abs(depth)` then `translate(0, 0, -abs(depth))`.

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
