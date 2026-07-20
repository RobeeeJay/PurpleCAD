// An extrude cut anchored to a host face must TRACK that face as the body
// resizes (a variable change), not float off it.  Regression for: shrinking a
// walled body's Height made the top-rim cut vanish because its startOffset was
// a frozen absolute above the now-shorter walls.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { hostFaceExtentAlongNormal } from "../csgUtils.js";
import { ensureOcc } from "../occ/init.js";
import { recalculateTimeline } from "../regenerateOrchestrator.js";
import { useStore } from "../../store";

describe("hostFaceExtentAlongNormal", () => {
  it("measures the host's far-face distance along the normal from the origin", () => {
    // A unit box from y=0..4; +Y normal, origin at the base plane -> top = 4.
    const host = {
      position: { x: 0, y: 0, z: 0 },
      geometryData: {
        positions: [
          -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, -1, 4, -1, 1, 4, -1, 1, 4, 1,
          -1, 4, 1,
        ],
      },
    };
    const top = hostFaceExtentAlongNormal(
      [host],
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 0 },
    );
    expect(top).toBeCloseTo(4, 6);
    // A host position offset shifts the measured face.
    const shifted = hostFaceExtentAlongNormal(
      [{ ...host, position: { x: 0, y: 1.5, z: 0 } }],
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 0 },
    );
    expect(shifted).toBeCloseTo(5.5, 6);
    // No geometry -> null (caller keeps the stored offset).
    expect(
      hostFaceExtentAlongNormal(
        [{ position: { x: 0, y: 0, z: 0 } }],
        {
          x: 0,
          y: 1,
          z: 0,
        },
        { x: 0, y: 0, z: 0 },
      ),
    ).toBe(null);
  });
});

describe("extrude cut tracks the host face across a Height change", () => {
  beforeAll(async () => {
    await ensureOcc();
  }, 60000);

  // Count interior (hole-wall) vertices above the floor — a proxy for "the cut
  // is present".  The outer walls sit at |x|~6 / |z|~4.5; anything interior and
  // above the floor belongs to a bore.
  const interiorPts = (g) => {
    const p = g?.positions;
    if (!p?.length) return 0;
    let n = 0;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i],
        y = p[i + 1],
        z = p[i + 2];
      const nearOuter =
        Math.abs(Math.abs(x) - 6) < 0.2 || Math.abs(Math.abs(z) - 4.5) < 0.2;
      if (!nearOuter && y > 0.25) n += 1;
    }
    return n;
  };

  it("keeps the four holes when Height is reduced below the authored value", async () => {
    const doc = JSON.parse(
      fs.readFileSync("test-files/var-change-fail.pcad", "utf8"),
    );
    useStore.getState().loadDocument(doc);
    await recalculateTimeline(true);
    const base = interiorPts(
      useStore.getState().items.find((i) => i.id === 4).geometryData,
    );
    expect(base).toBeGreaterThan(300); // four bores at the authored Height=50

    // Shrink Height 50 -> 25 (well below the cut's authored 50 mm start).
    useStore
      .getState()
      .setVariables(
        doc.variables.map((v) =>
          v.name === "Height" ? { ...v, formula: "25" } : v,
        ),
      );
    await recalculateTimeline(false);
    const it4 = useStore.getState().items.find((i) => i.id === 4);
    // Body shrank...
    const zs = it4.geometryData.positions.filter((_, i) => i % 3 === 1);
    expect(Math.max(...zs)).toBeCloseTo(2.5, 1);
    // ...and the cut is STILL there (tracked the top), not lost.
    expect(interiorPts(it4.geometryData)).toBeGreaterThan(300);
  }, 120000);
});
