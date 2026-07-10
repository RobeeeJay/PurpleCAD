// Switching to high-quality print resolution must keep an appended chamfer on
// the rim it was authored on.  Regression: the JIT recompute fed the appended
// chamfer (whose merged selection re-runs on the PRE-chamfer source) the
// previous entry's RESULT solid — a body whose selected outer rim was already
// beveled away — so the coordinate matches missed and the normal fallback
// selected the ring's INNER rim too (a diametrically-opposite inner edge has
// the identical adjacent-normal pair).  The orchestrator now rebuilds from the
// recipe whenever the frozen source doesn't describe the previous step's
// result (sourceDescribesPrev).
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { recalculateTimeline } from "../regenerateOrchestrator.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

// For the final chamfered item: radii of the TOP boundary (z ~ zmax) in mesh
// local frame.  An unchamfered inner rim keeps minR(top) at the inner radius;
// a chamfered inner rim pushes it outward by ~the chamfer amount.
function topRadii(item) {
  const P = item.geometryData.positions;
  let zmax = -1e9;
  for (let i = 0; i < P.length; i += 3) zmax = Math.max(zmax, P[i + 2]);
  let minR = 1e9,
    maxR = -1e9;
  for (let i = 0; i < P.length; i += 3) {
    if (Math.abs(P[i + 2] - zmax) > 1e-4) continue;
    const r = Math.hypot(P[i], P[i + 1]);
    minR = Math.min(minR, r);
    maxR = Math.max(maxR, r);
  }
  return { zmax, minR, maxR };
}

describe("high-res chamfer selection", () => {
  it("stays on the outer rim after switching to print resolution", async () => {
    const doc = JSON.parse(
      fs.readFileSync("test-files/high-quality-chamfer-fail.pcad", "utf8"),
    );
    useStore.getState().loadDocument(doc);
    await recalculateTimeline();
    let item = useStore.getState().items.find((i) => i.regenerator);
    const before = topRadii(item);
    console.log("preview 0.1:", JSON.stringify(before));

    // Switch to high-quality print resolution (0.01) — dirties every entry.
    useStore.setState({ printPrecisionMm: 0.01 });
    useStore.getState().toggleCurveResolution();
    await recalculateTimeline();
    item = useStore.getState().items.find((i) => i.regenerator);
    const after = topRadii(item);
    console.log("print 0.01:", JSON.stringify(after));

    // The inner rim must stay UNchamfered: its top radius unchanged (within
    // tessellation noise).  The bug pushes it outward by ~the chamfer amount.
    expect(Math.abs(after.minR - before.minR)).toBeLessThan(0.03);
  }, 240000);
});
