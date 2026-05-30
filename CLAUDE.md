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

## Variables / formulas

- Dimension distances, extrude depths, and chamfer/fillet parameters can
  be either bare numbers or formula strings referencing variables.
- Resolution happens through `geometryParams.js#resolveValue` (which
  reads variables from the store). Bare numbers are legacy scene-unit
  values; strings are user-facing mm formulas that get divided by
  `MM_PER_UNIT` after evaluation.
- Variable changes invalidate every regenerator's `regeneratedAt` flag so
  the next regen pass rebuilds downstream CSG / chamfer items.

## Coordinate system

- Viewport is Y-up. STL/STEP exports rotate `+π/2` around X to match the
  Z-up convention every CAD reader assumes.
- Extrudes start at the sketch plane (base at local z=0, top at z=±depth)
  — they do NOT straddle the plane. Don't add midpoint-centering back.
- Negative depths are valid (backwards extrude). `THREE.ExtrudeGeometry`
  only takes positive `depth`, so negative-depth code paths extrude by
  `abs(depth)` then `translate(0, 0, -abs(depth))`.

## Misc

- The `_cameraControls` slot on the store is a deliberate non-reactive
  handle for toolbar buttons that need access to viewport helpers (eg
  `dropSelectedToGround`). Don't `useStore.subscribe` to it.
- Per-frame constant-on-screen-size scaling for the axis indicator,
  transform handles, and bounding-box dimension labels happens in
  `cameraControls/animateLoop.js` — don't scale them elsewhere or the
  per-frame pass will fight you. Each entry caches its authored scale
  on userData.baseScale on first sight.
