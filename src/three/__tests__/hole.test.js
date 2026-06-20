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
