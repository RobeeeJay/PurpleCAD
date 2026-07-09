// Reordering timeline steps must keep the OBJECT where it was — both
// directions.  Regression for two bugs: (1) moving the chamfer before the
// emboss without relinking chained the steps to the old order's geometry;
// (2) the REVERSE move left the moved op's frozen source with the OLD order's
// transform, so resolveChainedPosition double-counted the source-brush delta
// and the whole body jumped by half its height (position y 5 instead of 2.5).
// The orchestrator now refreshes a stale source from the accumulated state
// whenever the same item's input step was recomputed earlier in the pass.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { recalculateTimeline } from "../regenerateOrchestrator.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

// World bbox of an item: rotate mesh-local positions by item.rotation (XYZ),
// scale, add position.
function worldBBox(item) {
  const { positions } = item.geometryData;
  const r = item.rotation || { x: 0, y: 0, z: 0 };
  const s = item.scale || { x: 1, y: 1, z: 1 };
  const p = item.position || { x: 0, y: 0, z: 0 };
  const cx = Math.cos(r.x || 0),
    sx = Math.sin(r.x || 0);
  const cy = Math.cos(r.y || 0),
    sy = Math.sin(r.y || 0);
  const cz = Math.cos(r.z || 0),
    sz = Math.sin(r.z || 0);
  let mn = [1e9, 1e9, 1e9],
    mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < positions.length; i += 3) {
    let x = positions[i] * (s.x ?? 1),
      y = positions[i + 1] * (s.y ?? 1),
      z = positions[i + 2] * (s.z ?? 1);
    // XYZ euler
    let y1 = y * cx - z * sx,
      z1 = y * sx + z * cx;
    y = y1;
    z = z1;
    let x1 = x * cy + z * sy,
      z2 = -x * sy + z * cy;
    x = x1;
    z = z2;
    let x2 = x * cz - y * sz,
      y2 = x * sz + y * cz;
    x = x2;
    y = y2;
    x += p.x;
    y += p.y;
    z += p.z;
    mn = [Math.min(mn[0], x), Math.min(mn[1], y), Math.min(mn[2], z)];
    mx = [Math.max(mx[0], x), Math.max(mx[1], y), Math.max(mx[2], z)];
  }
  return { mn, mx, c: mn.map((v, k) => (v + mx[k]) / 2) };
}

describe("reorder chamfer before emboss keeps the object in place", () => {
  it("world bbox centre unchanged", async () => {
    const doc = JSON.parse(
      fs.readFileSync("test-files/reorder-timeline-fail.pcad", "utf8"),
    );
    useStore.getState().loadDocument(doc);
    await recalculateTimeline();
    let st = useStore.getState();
    const before = worldBBox(st.items.find((i) => i.id === 2));
    console.log("BEFORE pos", st.items.find((i) => i.id === 2).position);
    console.log("BEFORE bbox c", before.c.map((v) => v.toFixed(3)).join(","));

    useStore.getState().reorderHistory(5, 4); // chamfer before emboss
    await recalculateTimeline();
    st = useStore.getState();
    const item = st.items.find((i) => i.id === 2);
    const after = worldBBox(item);
    console.log("AFTER pos", item.position);
    console.log("AFTER bbox c", after.c.map((v) => v.toFixed(3)).join(","));
    console.log(
      "DELTA",
      after.c.map((v, k) => (v - before.c[k]).toFixed(3)).join(","),
    );
    for (let k = 0; k < 3; k++)
      expect(Math.abs(after.c[k] - before.c[k])).toBeLessThan(0.25);
  }, 240000);

  it("REVERSE reorder (emboss moved before chamfer) keeps the object in place", async () => {
    const doc = JSON.parse(
      fs.readFileSync("test-files/reorder-timeline-before.pcad", "utf8"),
    );
    useStore.getState().loadDocument(doc);
    await recalculateTimeline();
    let st = useStore.getState();
    const before = worldBBox(st.items.find((i) => i.id === 2));
    console.log("R2 BEFORE c", before.c.map((v) => v.toFixed(3)).join(","));

    // Before-file order: chamfer(5) then emboss(4); move emboss BEFORE chamfer.
    useStore.getState().reorderHistory(4, 5);
    await recalculateTimeline();
    st = useStore.getState();
    const item = st.items.find((i) => i.id === 2);
    const after = worldBBox(item);
    console.log("R2 AFTER  c", after.c.map((v) => v.toFixed(3)).join(","));
    console.log("R2 pos", JSON.stringify(item.position));
    console.log(
      "R2 DELTA",
      after.c.map((v, k) => (v - before.c[k]).toFixed(3)).join(","),
    );
    for (let k = 0; k < 3; k++)
      expect(Math.abs(after.c[k] - before.c[k])).toBeLessThan(0.25);
  }, 240000);
});
