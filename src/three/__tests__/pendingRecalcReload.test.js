// A sketch edit whose recalc has not run yet must survive a save and reload.
// The recalc is deferred while the sketch is open, and finds the steps to
// rebuild by their `dirty` flag alone; the steps themselves still say they
// were built at this resolution.  saveTimeline used to strip `dirty`, so an
// edit saved before its recalc (the app closed, or the project switched, with
// the sketch still open) reloaded as clean, and the cut built on that sketch
// kept its old hole for good -- Cut 12 in the "Pi 3 TV Case" project.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import * as db from "../../store/db.js";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { recalculateTimeline } from "../regenerateOrchestrator.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const FIXTURE = JSON.parse(
  fs.readFileSync("test-files/bad-cut-extrude.pcad", "utf8"),
);

const cutVolume = () => {
  const g = useStore.getState().items.find((i) => i.id === 4).geometryData;
  const p = g.positions;
  const ix = g.indices;
  let v = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const [a, b, c] = [ix[t] * 3, ix[t + 1] * 3, ix[t + 2] * 3];
    v +=
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
      p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
};

// Grow the four corner holes of Sketch 1, which Cut 4 drills.
const growHoles = () => {
  for (const idx of [4, 11, 12, 13]) {
    const s = useStore.getState().items.find((i) => i.id === 1).shapes[idx];
    useStore.getState().updateSketchShape(1, idx, { ...s, r: s.r * 1.5 });
  }
};

describe("a sketch edit saved before its recalc", () => {
  it("is rebuilt when the document is reloaded", async () => {
    useStore.getState().loadDocument(structuredClone(FIXTURE));
    await recalculateTimeline();
    const before = cutVolume();
    growHoles();
    await recalculateTimeline();
    const rebuilt = cutVolume();
    expect(
      Math.abs(rebuilt - before),
      `the edit changes the cut: ${before} -> ${rebuilt}`,
    ).toBeGreaterThan(1e-3);

    // The same edit, saved and reloaded before any recalc ran.
    useStore.getState().loadDocument(structuredClone(FIXTURE));
    await recalculateTimeline();
    growHoles();
    const { history } = db.getTimeline();
    const s = useStore.getState();
    useStore.getState().loadDocument(
      structuredClone({
        history,
        variables: s.variables,
        folders: s.folders,
        activeHistoryId: s.activeHistoryId,
      }),
    );
    // The viewport recalcs on load only when a body says it is stale, so the
    // reloaded cut has to come back marked so before any recalc runs.
    const stamp = useStore.getState().items.find((i) => i.id === 4)
      .regenerator.regeneratedAt;
    expect(stamp, `reloaded cut is stamped ${stamp}`).toBe("dirty");
    await recalculateTimeline();
    const reloaded = cutVolume();
    expect(
      reloaded,
      `reloaded cut ${reloaded}, rebuilt in place ${rebuilt}, before the edit ${before}`,
    ).toBeCloseTo(rebuilt, 6);
  }, 300000);
});
