// Hole op: cut a plain / threaded hole into a body, and rebuild a "hole"
// regenerator from its embedded source.

import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { holeItem } from "../occClient.js";
import { regenerateItemsForResolution } from "../regenerateItems.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const O = { x: 0, y: 0, z: 0 };
const S = { x: 1, y: 1, z: 1 };
const cube = { id: 1, type: "cube", position: O, rotation: O, scale: S };
// Hole drilled into the top face (0,1,0) straight down, mm sizes.
const holeRecipe = (extra) => ({
  point: { x: 0, y: 1, z: 0 },
  dir: { x: 0, y: -1, z: 0 },
  length: 12,
  diameter: 6,
  pitch: 1,
  tolerance: 0,
  threaded: false,
  ...extra,
});
const tris = (g) => g.indices.length / 3;

describe("hole op", () => {
  it("cuts a plain hole into the body", async () => {
    const res = await holeItem({
      source: cube,
      hole: holeRecipe(),
      allItems: [cube],
      printPrecision: 0.1,
    });
    expect(res).toBeTruthy();
    // A solid cube is 12 triangles; the bore adds the cylinder wall + rim.
    expect(tris(res.geometryData)).toBeGreaterThan(20);
  });

  it("cuts a real threaded hole (far more faces than a plain bore)", async () => {
    const plain = await holeItem({
      source: cube,
      hole: holeRecipe({ threaded: false }),
      allItems: [cube],
      printPrecision: 0.1,
    });
    const threaded = await holeItem({
      source: cube,
      hole: holeRecipe({ threaded: true }),
      allItems: [cube],
      printPrecision: 0.1,
    });
    expect(threaded).toBeTruthy();
    expect(tris(threaded.geometryData)).toBeGreaterThan(
      tris(plain.geometryData) * 3,
    );
  });

  it("opens through the surface even when the entry lands below it", async () => {
    // The bore starts outside the face, so a slightly-sunken pick still cuts an
    // OPEN hole (not an internal void).  Check the top face (y=1) keeps a ring.
    const ringTris = async (yEntry) => {
      const res = await holeItem({
        source: cube,
        hole: holeRecipe({ point: { x: 0, y: yEntry, z: 0 }, length: 8 }),
        allItems: [cube],
        printPrecision: 0.05,
      });
      const { positions: pos, indices: idx } = res.geometryData;
      let n = 0;
      for (let i = 0; i < idx.length; i += 3) {
        let onTop = true;
        for (let k = 0; k < 3; k++)
          if (Math.abs(pos[idx[i + k] * 3 + 1] - 1) > 1e-3) {
            onTop = false;
            break;
          }
        if (onTop) n++;
      }
      return n;
    };
    expect(await ringTris(1)).toBeGreaterThan(8); // entry on the face
    expect(await ringTris(0.7)).toBeGreaterThan(8); // entry 3mm below
  });

  it("bores no smaller than the thread crest, so no cylinder hides the thread", async () => {
    // With a tolerance the groove grows outward; the bore must grow with it, or
    // a smooth cylindrical wall is left standing in front of (hiding) the thread.
    const res = await holeItem({
      source: cube,
      // 6 mm major, 1 mm pitch, 1 mm tolerance (all ÷10 in local units).
      hole: holeRecipe({ threaded: true, tolerance: 1, length: 12 }),
      allItems: [cube],
      printPrecision: 0.05,
    });
    const pos = res.geometryData.positions;
    // Innermost cut surface radius about the hole axis (x = z = 0, along Y).
    let minR = Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const y = pos[i + 1];
      if (y > 0.95 || y < -0.5) continue; // skip the top face + far side
      const r = Math.hypot(pos[i], pos[i + 2]);
      if (r > 0.05 && r < minR) minR = r;
    }
    // Thread crest ≈ 0.346 local; the pre-fix smooth bore sat at ≈ 0.246.
    expect(minR).toBeGreaterThan(0.31);
  });

  it("keeps the thread inside the bore, not spiralling across the face", async () => {
    // The thread is offset into the part so its lead-in turn lands on the entry
    // face — no groove geometry should poke above the top face (y=1).
    const res = await holeItem({
      source: cube,
      hole: holeRecipe({ threaded: true, length: 12 }),
      allItems: [cube],
      printPrecision: 0.05,
    });
    const pos = res.geometryData.positions;
    let above = 0;
    for (let i = 1; i < pos.length; i += 3) if (pos[i] > 1.002) above++;
    expect(above).toBe(0);
  });

  it("rebuilds a hole regenerator from its embedded source", async () => {
    const item = {
      id: 2,
      type: "csg",
      position: O,
      rotation: O,
      scale: S,
      geometryData: null,
      regenerator: {
        kind: "hole",
        hole: holeRecipe({ threaded: true }),
        source: cube,
        centerOffset: { cx: 0, cy: 0, cz: 0 },
        regeneratedAt: "dirty",
      },
    };
    const out = await regenerateItemsForResolution([item], 0.1);
    const u = out.find((i) => i.id === 2);
    expect(u.geometryData).toBeTruthy();
    expect(u.geometryData.positions.length).toBeGreaterThan(0);
  });
});
