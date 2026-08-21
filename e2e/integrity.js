// Shared document-integrity assertion for the e2e suite.
//
// A sketch's constraints address its shapes BY INDEX, so any structural
// mutation that inserts, removes or reorders shapes has to remap them.  When
// one forgets (a projection refit did exactly this), nothing throws — the
// constraints silently re-bind to the wrong shapes, and the damage only shows
// up later as geometry lurching across the sketch on the next drag.
//
// This reuses the scene inspector's own checks (src/three/sceneInspector.js)
// so there's a single definition of "bound to the wrong shape", exercised both
// by the debug UI and by every test that calls this.

import { expect } from "@playwright/test";
import { buildInspectorRows } from "../src/three/sceneInspector.js";

// Pull the live items out of the running app and check every sketch.
export async function assertDocumentIntegrity(page, label = "document") {
  const items = await page.evaluate(() =>
    // Strip the heavy baked meshes — only shapes/constraints matter here, and
    // a displacement mesh would make this serialise hundreds of MB.
    window.__store.getState().items.map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type,
      shapes: i.shapes,
      constraints: i.constraints,
    })),
  );
  const problems = [];
  for (const row of buildInspectorRows(items)) {
    if (!row.sketch) continue;
    for (const c of row.sketch.constraints) {
      if (c.dangling)
        problems.push(
          `${label}: sketch #${row.id} "${row.name}" constraint ${c.idx} (${c.type}) ` +
            `references a shape that doesn't exist: ` +
            c.dangling.map((d) => `${d.field}=${d.idx}`).join(", ") +
            ` (sketch has ${row.sketch.shapeCount} shapes)`,
        );
      else if (c.mismatch)
        problems.push(
          `${label}: sketch #${row.id} "${row.name}" constraint ${c.idx} (${c.type}) ` +
            `contradicts the geometry it names — ${c.mismatch} ` +
            `(refs ${c.refs.map((r) => `${r.field}=${r.idx}`).join(", ")})`,
        );
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);
}
