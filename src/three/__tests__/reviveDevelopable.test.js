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
  it("rebuilds the curve from the frozen wall (~unchanged radius)", () => {
    const before = Math.max(...emb.faceSet.developable.curve.map(R));
    const r = reviveDevelopable(emb.faceSet, emb.source);
    const after = Math.max(...r.developable.curve.map(R));
    expect(before).toBeCloseTo(after, 1); // ~2.2 either way
  });
  it("rebuilds the curve at the live (resized) wall radius", () => {
    const live = extrudeWithLivePolygon(emb.source, [sk], null); // circles r=3.2
    const before = Math.max(...emb.faceSet.developable.curve.map(R));
    const r = reviveDevelopable(emb.faceSet, live);
    const after = Math.max(...r.developable.curve.map(R));
    expect(before).toBeLessThan(2.3); // was ~2.2
    expect(after).toBeGreaterThan(3.0); // now ~3.2 (rebuilt from live wall)
    expect(after).toBeLessThan(3.4);
  });
});
