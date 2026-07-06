import { describe, it, expect, vi } from "vitest";
vi.mock("three/addons/lines/Line2.js", () => ({ Line2: class {} }));
vi.mock("three/addons/lines/LineMaterial.js", () => ({
  LineMaterial: class {},
}));
vi.mock("three/addons/lines/LineGeometry.js", () => ({
  LineGeometry: class {
    setPositions() {}
  },
}));
import { readFileSync } from "fs";
import { reviveDevelopable } from "../regenerateItems.js";
import { extrudeWithLivePolygon } from "../csgUtils.js";
const R = (c) => Math.hypot(c.u, c.v);
describe("reviveDevelopable", () => {
  const d = JSON.parse(
    readFileSync("test-files/cylinder-emboss-32.pcad", "utf8"),
  );
  const emb = d.history[3].instruction.patches.regenerator;
  const sk = d.history[1].instruction.item;
  it("no-op when outer radius unchanged", () => {
    const r = reviveDevelopable(emb.faceSet, emb.source, emb.source);
    expect(r).toBe(emb.faceSet);
  });
  it("scales curve+arc to the live resized radius, preserving order/count", () => {
    const live = extrudeWithLivePolygon(emb.source, [sk], null); // circles r=3.2
    const before = Math.max(...emb.faceSet.developable.curve.map(R));
    const r = reviveDevelopable(emb.faceSet, live, emb.source);
    const after = Math.max(...r.developable.curve.map(R));
    expect(r.developable.curve.length).toBe(
      emb.faceSet.developable.curve.length,
    );
    expect(before).toBeLessThan(2.3); // was ~2.2
    expect(after).toBeGreaterThan(3.0); // now ~3.2
    expect(after).toBeLessThan(3.4);
    // arc scaled by same ratio
    const ar = r.developable.arc,
      ao = emb.faceSet.developable.arc;
    expect(ar[ar.length - 1] / ao[ao.length - 1]).toBeCloseTo(
      after / before,
      3,
    );
  });
});
