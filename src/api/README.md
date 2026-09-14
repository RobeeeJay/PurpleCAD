# Agent API

Named commands with JSON arguments that build, inspect and render a model.
They run in the renderer, where the store, the scene and the geometry live, and
are reached through one door:

```js
await window.__api.call("feature.extrude", { sketchId: 3, depth: "Thick" });
// -> { ok: true, result: { id, name, bboxMm, volumeMm3, ... } }
// -> { ok: false, error: { code, message, details } }
window.__api.list(); // every command, with its description and JSON schema
```

`window.__api` exists in every build, not only E2E: it is the app's real
surface, and the MCP transport (phase 2 of the plan) reaches it the same way the
e2e suite does. `e2e/agent-api.spec.js` drives it exactly as an agent will.

## The contract

- **Millimetres, in the user's Z-up frame**, in and out. Scene units (mm ÷ 10)
  and the internal Y-up axes never cross the boundary; `frames.js` is the only
  place either conversion happens.
- **Settled on return.** A command returns once no OCC operation is pending and
  no recalculation is running, held across a 250ms quiet window (`settle.js`),
  so an agent never polls. Changing a variable and reading `body.list` straight
  after gives the rebuilt size -- the e2e test checks exactly that.
- **Never throws.** Every outcome is a result. A bug comes back as
  `{ code: "INTERNAL" }`, since a throw would reach an MCP client as a transport
  error with the reason lost.
- **Results carry enough to check.** A command that makes a body returns its
  bounding box and volume, measured from the surface on screen.

Error codes: `BAD_ARGS`, `UNKNOWN_COMMAND`, `CONFIRMATION_REQUIRED`,
`NOT_FOUND`, `BAD_SHAPE`, `BAD_CONSTRAINT`, `SKETCH_UNSOLVED`, `NO_PROFILE`,
`GEOMETRY_REJECTED`, `EMPTY_RESULT`, `NO_VIEWPORT`, `RENDER_FAILED`, `TIMEOUT`,
`INTERNAL`.

Sketch planes, named in the user frame:

| Plane | local x → | local y → | extrudes toward |
| ----- | --------- | --------- | --------------- |
| XY    | X         | Y         | +Z              |
| XZ    | X         | Z         | −Y              |
| YZ    | Y         | Z         | +X              |

## Adding a command

`defineCommand({ name, description, input, run })` in a module under
`commands/`, imported from `index.js`. The description is what an agent reads to
decide how to use the command, so it says what the arguments mean in mm and
what comes back. Arguments are validated against `input` before `run` sees them.
Cover it in `e2e/agent-api.spec.js` -- vitest cannot reach the scene or the OCC
bridge, so a green unit run says nothing about a command.

## What cost time, so it does not again

- **A bare number in a stored length is read as SCENE units.** The store treats
  numeric `distance`s and depths as legacy scene units and strings as mm
  formulas, so mm from an agent is stored as a string (`8` becomes `"8"`).
- **Deselect a sketch after creating it.** Adding selects the item, a selected
  sketch drops the viewport into sketch mode with a camera fly-in, and the
  timeline recalculation is DEFERRED while sketch mode is on -- so nothing would
  settle.
- **Commits go through `occClient`, never `occOps`**, and inside
  `withCommitGuard`, exactly as the tool dialogs do. `occOps` is the vitest path;
  calling it from here would pass the tests and do something different in the
  shipped app, and an unguarded commit can be cancelled by a preview into an
  empty result with no error.
- **Measure a body by its own geometry.** A stress field or an optimisation
  preview swaps the mesh on screen, so `meshWorldData` reads the geometry kept
  aside in `userData` when there is one.
- **Shared item shapes are shared, not copied.** `feature.extrude` commits
  through the extrude tool's own `buildExtrudeDef`; a second hand-kept copy of
  the item shape would drift.
