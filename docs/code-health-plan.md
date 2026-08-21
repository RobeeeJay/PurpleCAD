# Code health plan — file size, regression hot spots, test gaps

Measured on the current `main` (post dead-code cleanup). Every number below
came from a command, not an estimate; the commands are given so they can be
re-run. Where something is inferred rather than measured, it says so.

## How the numbers were produced

| Figure | Command |
| --- | --- |
| File sizes | `find src electron native/occ-addon/src -name '*.js' -o -name '*.jsx' -o -name '*.cjs' -o -name '*.cc' \| grep -v __tests__ \| xargs wc -l` |
| Fix density | `git log --format='%H%x09%s'` filtered to `fix:`/`revert:` (127 commits), then `git show --name-only` per commit |
| Unit coverage | `npm run test:coverage` → `coverage/coverage-final.json` (v8, statements) |

**Important caveat.** The coverage figures are **vitest only**. The 76 Playwright
e2e specs are *not* instrumented, so anything reading 0% in `cameraControls/`
and `components/` is still exercised end-to-end — it just has no *unit-level*
safety net and no assertions on its internals. Read 0% as "no fast, local
regression test", not "completely untested".

---

## 1. Current state

207 non-test source files, 69,446 lines.

| Bucket | Files |
| --- | --- |
| > 1000 lines | 10 |
| 501–1000 | 31 |
| 201–500 | 63 |
| ≤ 200 | 103 |

The ten over 1000 lines:

| Lines | File |
| --- | --- |
| 2677 | `native/occ-addon/src/binding.cc` |
| 2416 | `src/three/occOps.js` |
| 1927 | `src/three/cameraControls.js` |
| 1802 | `electron/occ-bridge.cjs` |
| 1671 | `src/store/sketchSlice.js` |
| 1382 | `src/store/historySlice.js` |
| 1316 | `src/three/cameraControls/sketchInteraction.js` |
| 1275 | `src/store/uiSlice.js` |
| 1215 | `src/components/viewport/SketchOverlays.jsx` |
| 1133 | `src/three/regenerateItems.js` |

---

## 2. Options for smaller files

Ordered by value-per-risk. These are options, not a committed sequence.

### Option A — Extract cohesive tool/feature modules (proven here)

The pattern already applied to `sketchInteraction.js` (2958 → 1316) and
`sketchSlice.js` (2443 → 1671): find a self-contained concern, move it to a
sibling factory, compose it back.

Remaining candidates, in descending confidence:

| Target | Extract | Est. lines |
| --- | --- | --- |
| `occOps.js` (2416) | One module per op family: booleans, extrude/prism, chamfer/fillet, emboss, export, mesh/sew | ~400 each |
| `historySlice.js` (1382) | Timeline mutation (insert/delete/reorder/relink) vs. replay/restore vs. entry-edit | ~400 each |
| `uiSlice.js` (1275) | Per-tool phase machines (hole/emboss/draft/texture/pushpull) out of the shared slice | ~500 total |
| `SketchOverlays.jsx` (1215) | Dimension overlays / constraint overlays / distance-input overlay | ~400 each |
| `regenerateItems.js` (1133) | One regenerator per file, dispatch table stays | ~350 each |
| `cameraControls.js` (1927) | Plane pick, primitive preview, split pick, view capture | ~600 total |

**Risk:** low-moderate. Mechanical, and the e2e suite catches breakage — but note
the Project-tool extraction shipped a real runtime bug (`activeSketchForProject`
was shared with the Text tool) that only e2e caught. Extraction is not free.

### Option B — Split the twin OCC implementations by op, together

`occOps.js` (2416) and `occ-bridge.cjs` (1802) are required to stay in lockstep
(CLAUDE.md). Splitting them *in parallel*, op-family by op-family, makes each
pair small enough to diff by eye and makes drift obvious in review.

**Risk:** moderate — highest-consequence code in the repo. Do one family per PR,
with `bridgeParity.test.js` extended each time.

### Option C — Break up `binding.cc` (2677, the largest file)

Currently one translation unit: primitives, booleans, chamfer/fillet, meshing,
sewing, cancellation, STEP/STL. Split into `binding_*.cc` around those seams with
a shared `occ_common.h`.

**Risk:** moderate. Needs a CMakeLists change; no JS behaviour change, and the
addon smoke test plus `bridgeParity` cover the surface.

### Option D — Component-level splits (UI)

`Timeline.jsx` (912), `TreeView.jsx` (820), `ConstrainSection.jsx` (914),
`timelineIcons.jsx` (828). Icons are pure data and split trivially; the other
two split along row-rendering vs. drag/drop vs. state.

**Risk:** low, but see §3 — these are also regression hot spots, so pair with
tests rather than doing the split alone.

### Option E — Enforce the ceiling mechanically

CLAUDE.md sets a 500-line soft ceiling; nothing enforces it. Add a CI check that
fails when a *newly added or grown* file crosses the line (a ratchet, not a
retro-fit). Cheap, and stops regrowth after the work above.

### What NOT to do

- Splitting `sketchInteraction.js` further. What's left (1316) is mouse-event
  dispatch sharing heavy mutable closure state; further cuts shuffle wiring
  rather than isolating concerns.
- Splitting purely by line count. `constraintIcons.js` (953) is a flat icon
  builder — big but uniform and low-churn.

---

## 3. Where regressions actually happen

127 `fix:`/`revert:` commits analysed. Raw touch counts favour big files, so the
table below is **fixes per 100 lines** (min. 3 fixes, 150 lines).

| Fixes/100L | Fixes | Lines | File |
| --- | --- | --- | --- |
| 2.77 | 11 | 397 | `src/components/Viewport.jsx` |
| 2.34 | 4 | 171 | `src/components/toolbar/CombineSection.jsx` |
| 2.04 | 4 | 196 | `src/App.jsx` |
| 1.94 | 6 | 309 | `src/three/cameraControls/emboss.js` |
| 1.90 | 12 | 630 | `src/three/sceneSetup.js` |
| 1.79 | 5 | 279 | `src/three/cameraControls/navigation.js` |
| 1.78 | 8 | 450 | `src/three/regenerateOrchestrator.js` |
| 1.69 | 6 | 354 | `src/three/csgUtils.js` |
| 1.56 | 8 | 514 | `src/three/cameraControls/animateLoop.js` |
| 1.51 | 7 | 463 | `src/components/toolbar/BevelSection.jsx` |

By subsystem (file-touches across those 127 commits):

| Touches | Subsystem |
| --- | --- |
| 91 | camera + interaction (`cameraControls*`) |
| 87 | UI components |
| 39 | OCC pipeline (`occOps` / bridge / native) |
| 36 | store slices |
| 25 | regen / CSG recipes |
| 18 | scene building |
| 11 | sketch geometry + solver |

### Why these are the hot spots

1. **Camera + interaction (91).** Frame-timing and screen-space maths with no
   unit-testable seam — the pivot-centring, ruler-jiggle and orbit-anchor bugs
   were all in this cluster, and each needed instrumented Playwright repros to
   diagnose. `sceneSetup.js` alone took 12 fixes.
2. **UI components (87).** `Viewport.jsx` is the wiring hub; a change to any
   tool tends to land here. Highest fix density in the repo.
3. **OCC dual implementation (39).** Every drift between `occOps.js` and
   `occ-bridge.cjs` is invisible to vitest by construction — the occOps path
   re-derives internally, so a stale-polygon or depth bug only appears in the
   shipped app.
4. **Recipe/regen (25).** The "applies to an earlier state" class documented at
   length in CLAUDE.md: frozen snapshots diverging from live state.
5. **Sketch solver (11).** Low count, but each is high-severity — the projection
   refit silently mis-binding every later constraint is the recent example.

---

## 4. Test coverage gaps

Overall **34.3% statement coverage** (unit tests only; 209 files).

| Coverage | Area | Statements |
| --- | --- | --- |
| **0.2%** | components (UI) | 5833 |
| **4.3%** | cameraControls (interaction) | 7893 |
| 31.1% | sceneObjects (scene build) | 1988 |
| 41.7% | electron | 1635 |
| 66.2% | store slices | 2963 |
| 77.1% | three (geometry / OCC) | 7659 |
| 97.5% | utils | 122 |

The shape is clear: **pure geometry is well covered, everything stateful or
interactive is not.** That matches CLAUDE.md's own note that vitest runs in node
with no DOM and no `Worker`.

### Highest-risk files (large × fix-prone × uncovered)

`risk = fixes-per-100-lines × (1 − unit coverage)`:

| Risk | Fixes | Lines | Unit cov | File |
| --- | --- | --- | --- | --- |
| 2.77 | 11 | 397 | 0.0% | `src/components/Viewport.jsx` |
| 1.94 | 6 | 309 | 0.0% | `src/three/cameraControls/emboss.js` |
| 1.79 | 5 | 279 | 0.0% | `src/three/cameraControls/navigation.js` |
| 1.64 | 12 | 630 | 14.1% | `src/three/sceneSetup.js` |
| 1.51 | 7 | 463 | 0.0% | `src/components/toolbar/BevelSection.jsx` |
| 1.50 | 8 | 514 | 3.6% | `src/three/cameraControls/animateLoop.js` |
| 1.30 | 5 | 377 | 2.2% | `src/three/cameraControls/texture.js` |
| 0.88 | 17 | 1927 | 0.0% | `src/three/cameraControls.js` |

### Workflows with no e2e spec

23 e2e specs exist. Comparing them against the shipped toolbar, these user
workflows have **no** end-to-end coverage:

- **Sketch underlay** — import a PNG/JPEG, place, scale, edit, remove (brand new,
  and the drag + file-picker paths are untested by anything)
- **Scene inspector** — opening it, expanding, filtering, Copy JSON
- **Project tool** — projecting body edges into a sketch (click + marquee + the
  refit-on-source-move path that just caused the constraint corruption)
- **SVG import** — parse, place, scale, confirm
- **Variables** — create/rename/delete a variable and confirm dependent geometry
  rebuilds (only indirectly touched)
- **Revolve / Sweep** — `sweep.js` is 906 lines at 0% unit coverage with no spec
- **Mirror 3D / Pattern 3D** dialogs
- **Material editing**, **cross-section view**, **solo/visibility**, **folders**

### Recommended coverage work, in priority order

1. **Pure-function extraction from the 0% hot spots.** The pattern that worked
   for `panelAwareLookAt` and `groundRayCrossing`: pull the maths out of the
   render loop into a pure helper and unit-test it. `navigation.js`,
   `animateLoop.js` and `emboss.js` all have extractable geometry.
2. **e2e specs for the four highest-value uncovered workflows** — Project tool,
   underlay, SVG import, revolve/sweep. Project tool first: it has already caused
   silent document corruption.
3. **A document-integrity assertion** usable from any test: every sketch's
   constraints reference in-range shapes and don't contradict their geometry.
   `sceneInspector.js` already computes exactly this — wire it into
   `timeline-walk.spec.js` so *any* future structural mutation that renumbers
   shapes fails a test instead of silently corrupting a file.
4. **Extend `bridgeParity.test.js`** to cover every op, not just the core ones —
   this is the only automated defence against the occOps/bridge drift that
   causes the highest-severity, hardest-to-diagnose bugs.
5. **Fix the flaky smoke tooltip test** (`smoke.spec.js:74`). It alternates
   pass/fail across identical runs, which erodes trust in the suite.

---

## 5. Suggested sequencing

Each step is independently shippable and leaves the suite green.

| # | Work | Why first |
| --- | --- | --- |
| 1 | Document-integrity assertion in `timeline-walk` (§4.3) | Cheapest defence against the worst failure mode; reuses code that exists |
| 2 | Project-tool + underlay e2e specs | Two newest, least-covered, already-bitten workflows |
| 3 | Extract pure maths from `navigation.js` / `animateLoop.js`; unit-test | Turns the #1 regression cluster from e2e-only into unit-testable |
| 4 | Split `regenerateItems.js` per regenerator | Best size-to-risk ratio of the large files; well covered already (77% area) |
| 5 | Split `occOps.js` + `occ-bridge.cjs` in parallel, one op family per PR | Biggest files; needs the parity tests from step 6 to be safe |
| 6 | Extend `bridgeParity` to all ops | Prerequisite for step 5 |
| 7 | Line-count ratchet in CI (§2E) | Locks in the gains |
| 8 | `binding.cc` split | Highest risk, least urgent |

## 6. Open questions

- Should the 500-line ceiling be enforced (fail CI) or advisory (warn)?
- Is instrumenting the Playwright run for coverage worth it? It would replace the
  caveat in this document with real numbers for `components/` and
  `cameraControls/`, but adds build complexity.
- `binding.cc` split — worth it, or is a single well-sectioned C++ file fine
  given it changes rarely?
