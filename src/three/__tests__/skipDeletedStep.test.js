// A step whose body is deleted before anything reads it is never seen, so a
// recalc past the deletion must not rebuild it.  "Pi 3 TV Case" fused an
// extrude onto an imported Pi board and deleted the result at once; every
// recalc still ran that 48 s fuse, which looked like the STEP being rebuilt.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import {
  recalculateTimeline,
  unseenBeforeDelete,
} from "../regenerateOrchestrator.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const FIXTURE = JSON.parse(
  fs.readFileSync("test-files/bad-cut-extrude.pcad", "utf8"),
);

// The fixture with Cut 4 (entry 12) deleted straight after it was made.
const withCutDeleted = () => {
  const doc = structuredClone(FIXTURE);
  doc.history.push({
    id: 99,
    label: "Deleted",
    itemId: 4,
    instruction: { type: "delete", itemId: 4 },
  });
  doc.activeHistoryId = null;
  return doc;
};

const entry = (id) => useStore.getState().history.find((e) => e.id === id);

describe("a step deleted before anything reads it", () => {
  it("is not rebuilt by a recalc past the deletion", async () => {
    useStore.getState().loadDocument(withCutDeleted());
    await recalculateTimeline(true);
    // Left dirty rather than rebuilt; the steps before it still rebuild.
    expect(entry(12).dirty, "deleted cut's step").toBe(true);
    expect(entry(11).dirty, "Extruded 3's step").toBe(false);
  }, 300000);

  it("is rebuilt when the timeline is viewed at that step", async () => {
    useStore.getState().loadDocument(withCutDeleted());
    await recalculateTimeline(true);
    useStore.setState({ activeHistoryId: 12 });
    await recalculateTimeline();
    expect(entry(12).dirty, "deleted cut's step, viewed").toBe(false);
  }, 300000);

  it("is still rebuilt when a geometry step comes between it and the deletion", () => {
    const history = [
      { instruction: { type: "create", item: { id: 4, type: "csg" } } },
      {
        instruction: {
          type: "modify",
          itemId: 7,
          patches: { regenerator: {} },
        },
      },
      { instruction: { type: "delete", itemId: 4 } },
    ];
    expect(unseenBeforeDelete(history, 0, 4, 2)).toBe(false);
    // Without the step between, nothing can read it.
    expect(unseenBeforeDelete([history[0], history[2]], 0, 4, 1)).toBe(true);
    // Viewed before the deletion: it is on screen.
    expect(unseenBeforeDelete([history[0], history[2]], 0, 4, 0)).toBe(false);
  });
});
