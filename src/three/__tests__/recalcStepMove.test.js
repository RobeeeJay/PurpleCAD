// Moving to another timeline step while a recalculation runs must leave the
// scene shown at the step moved to.  The pass replayed the step that was
// active when it BEGAN, so opening an extrusion's Edit during a recalc showed
// the body it had merged into as hidden -- and Combine, ticked there, found
// nothing to merge with (an intermittent e2e failure until this was traced).
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { recalculateTimeline } from "../regenerateOrchestrator.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

describe("a recalculation that finishes after a step change", () => {
  it("shows the scene at the step moved to", async () => {
    const doc = JSON.parse(
      fs.readFileSync("test-files/multisystem2.pcad", "utf8"),
    );
    // Make the last step, the cut, rebuild: real OCC work to wait on.
    const cut = doc.history.find((e) => e.id === 14).instruction.item;
    cut.geometryData = null;
    cut.regenerator.regeneratedAt = "dirty";
    useStore.getState().loadDocument(doc);
    await recalculateTimeline();
    // Piece 3 is consumed by the cut, so hidden at the last step; at the
    // Split that made it, it is on show.
    const running = recalculateTimeline(true);
    useStore.getState().restoreToHistory(2);
    await running;
    const s = useStore.getState();
    expect(s.activeHistoryId).toBe(2);
    const piece = s.items.find((i) => i.id === 3);
    expect(piece?.visible, "piece 3 at the Split step").not.toBe(false);
    expect(
      s.items.some((i) => i.id === 14),
      "the cut, made later",
    ).toBe(false);
  }, 300000);
});
