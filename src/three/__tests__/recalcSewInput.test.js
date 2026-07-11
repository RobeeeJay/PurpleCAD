// Selecting a dirty step must never abort the recalculation.  Regression from
// test-files/failing-recalculate-scene.pcad: the JIT input-fallback sew of an
// upstream EMBOSS result (a dense, legitimately curved baked mesh) hit the
// imported-mesh face caps in makeSolidFromMesh and THREW — the rejection
// escaped recalculateTimeline uncaught, so the regen dialog never closed.
// Two guards under test: solidFromMesh skips the import caps (a step's own
// baked mesh is a clean OCC tessellation, not an import), and a sew failure
// falls back to the recipe rebuild instead of aborting the pass.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { recalculateTimeline } from "../regenerateOrchestrator.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

describe("recalc with a sewn emboss-result input", () => {
  it("completes when selecting the dirty chamfer step", async () => {
    const doc = JSON.parse(
      fs.readFileSync("test-files/failing-recalculate-scene.pcad", "utf8"),
    );
    useStore.getState().loadDocument(doc);
    await recalculateTimeline();

    // The user selects the next (dirty) Chamfered step — the JIT bound moves
    // past it and it recomputes with the emboss result as its input.
    useStore.getState().restoreToHistory(23);
    await recalculateTimeline();

    const item = useStore.getState().items.find((i) => i.regenerator);
    expect(item.geometryData).toBeTruthy();
    expect(item.regenerator.regenFailed).toBeFalsy();
    // Settled at the active precision — not left dirty to re-trigger forever.
    expect(item.regenerator.regeneratedAt).not.toBe("dirty");
  }, 240000);
});
