# Timeline & History

[← Materials & Variables](materials-variables.md) · [Contents](README.md) · Next: [Importing & Exporting →](import-export.md)

Everything you make is recorded, in order, on the **Timeline** panel
(bottom-left). It's not just an undo list — it's the editable recipe for the
whole model.

## How the timeline works

- Each action — adding a primitive, extruding a sketch, a boolean, a fillet — is
  a **step** in the list, with an icon and a label ("Added Cube", "Fillet",
  "Boolean"…).
- The model you see is the result of replaying every step in order.
- Steps that depend on earlier ones **rebuild automatically** when something
  upstream changes. Edit a sketch and its extrude, the fillet on that extrude,
  and the boolean it feeds into all re-run.

## Editing an earlier step

Most steps have an **Edit** button (a pencil). Clicking it:

- Restores the view to **just before** that step, so you see the geometry the
  operation worked on.
- Re-opens the tool's UI **seeded from the original settings**.

Change a value or re-pick a source (**Retarget**, where available) and the step
updates **in place** — no duplicate is created — and everything after it
rebuilds. This is how you change a hole's diameter, a fillet's radius, or which
face an emboss sits on, long after you made it.

## Reordering & deleting steps

- **Delete** a step to remove that operation; downstream steps re-bind to the
  new order and rebuild.
- **Reorder** steps to change the build order. PurpleCAD relinks each later
  step's source to the new arrangement so the model stays consistent.

## Undo & redo

- **Ctrl/Cmd-Z** — undo. **Ctrl/Cmd-Shift-Z** — redo.
- The undo/redo counts show at the bottom of the Timeline panel.
- Undo covers sketch edits, tool commits, transforms — the same actions the
  timeline records.

## Recalculation

When a change forces downstream steps to rebuild, a brief **Recalculating**
indicator appears while the geometry kernel re-runs the affected operations. For
a big model this can take a moment; the model updates when it finishes.

## Why this matters

Because the timeline is editable, you're never locked in. Model roughly first,
then go back and dial in exact dimensions; try a different fillet radius; move an
operation earlier or later — all without rebuilding from scratch. It's the core
of working parametrically.

---

Next: **[Importing & Exporting →](import-export.md)**
