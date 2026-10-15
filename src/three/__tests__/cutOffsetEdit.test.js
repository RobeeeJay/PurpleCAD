// Editing an extrude cut's Offset from the timeline must keep the cut where
// the dialog put it.  An offset cut is re-anchored to its host's face on every
// rebuild, by the inset (offset less the host's height above the sketch
// plane) measured when it was made; the edit changed the offset but kept the
// old inset, so the rebuilt cut started at the host's top instead -- on
// MultiSystem2 1.2 mm higher than asked, stopping short of the bottom face
// and leaving a thin floor across both boss holes.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { recalculateTimeline } from "../regenerateOrchestrator.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

// World y of every surface of `item` crossed by the vertical line at (x, z).
function surfacesAt(item, x, z) {
  const p = item.geometryData.positions;
  const idx = item.geometryData.indices;
  const o = item.position;
  const v = (k) => [p[k * 3] + o.x, p[k * 3 + 1] + o.y, p[k * 3 + 2] + o.z];
  const ys = [];
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [v(idx[t]), v(idx[t + 1]), v(idx[t + 2])];
    const d = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
    if (Math.abs(d) < 1e-12) continue;
    const u = ((x - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (z - a[2])) / d;
    const w = ((b[0] - a[0]) * (z - a[2]) - (x - a[0]) * (b[2] - a[2])) / d;
    if (u < 0 || w < 0 || u + w > 1) continue;
    ys.push(+(a[1] + u * (b[1] - a[1]) + w * (c[1] - a[1])).toFixed(3));
  }
  return [...new Set(ys)].sort((m, n) => m - n);
}

describe("editing an extrude cut's offset", () => {
  it("still cuts through the bottom face of MultiSystem2's base", async () => {
    const doc = JSON.parse(
      fs.readFileSync("test-files/multisystem2.pcad", "utf8"),
    );
    // As the dialog commits a cut made from the sketch plane: no offset, and
    // so no inset measured.
    const cut = doc.history.find((e) => e.id === 14).instruction.item;
    const profiles = cut.regenerator.extrudeDefs.map((d) => d.profile);
    cut.regenerator.extrudeDefs = cut.regenerator.extrudeDefs.map(
      ({ startOffset, ...d }) => d,
    );
    cut.regenerator.cutStartInset = 0;
    useStore.getState().loadDocument(doc);
    await recalculateTimeline();

    // Then Edit in the timeline: Offset 1 mm.  The cut runs from 1 mm above
    // the sketch plane (y -0.307) to 5 mm below it (y -0.907), well past the
    // base's bottom face at y -0.796.
    useStore.getState().retargetFusedExtrude(14, profiles, "-6", 0.1);
    await recalculateTimeline();
    const item = useStore.getState().items.find((i) => i.id === 14);
    const inset = item.regenerator.cutStartInset;
    // Nothing of the base may remain on either boss axis.
    const left = surfacesAt(item, -11.68, -4.7);
    const right = surfacesAt(item, 11.68, -4.7);
    expect(
      [...left, ...right],
      `inset ${inset}; surfaces on the axes: left ${left}, right ${right}`,
    ).toEqual([]);
  }, 240000);
});
