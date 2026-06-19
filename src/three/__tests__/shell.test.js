// Shell (hollow) op: the native makeShell hollows a solid to a wall, and the
// "shell" regenerator rebuilds from its embedded source on regen.

import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { shellItem } from "../occClient.js";
import { regenerateItemsForResolution } from "../regenerateItems.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const O = { x: 0, y: 0, z: 0 };
const S = { x: 1, y: 1, z: 1 };
const tris = (g) => g.indices.length / 3;

describe("shell op", () => {
  it("hollows a cube into a wall (inner + outer faces)", async () => {
    const cube = { id: 1, type: "cube", position: O, rotation: O, scale: S };
    const res = await shellItem({
      source: cube,
      thickness: 0.2,
      allItems: [cube],
      printPrecision: 0.1,
    });
    expect(res).toBeTruthy();
    // A solid cube tessellates to 12 triangles; a hollow shell adds the inner
    // wall, so the count must be well above that.
    expect(tris(res.geometryData)).toBeGreaterThan(12);
    expect(res.centerOffset).toBeTruthy();
  });

  it("rebuilds a shell regenerator from its source (chained-op style)", async () => {
    const cube = { id: 1, type: "cube", position: O, rotation: O, scale: S };
    const shelled = {
      id: 2,
      type: "csg",
      position: O,
      rotation: O,
      scale: S,
      geometryData: null,
      regenerator: {
        kind: "shell",
        thickness: 0.2,
        source: cube,
        centerOffset: { cx: 0, cy: 0, cz: 0 },
        regeneratedAt: "dirty",
      },
    };
    const out = await regenerateItemsForResolution([shelled], 0.1);
    const u = out.find((i) => i.id === 2);
    expect(u.geometryData).toBeTruthy();
    expect(u.geometryData.positions.length).toBeGreaterThan(0);
    expect(tris(u.geometryData)).toBeGreaterThan(12);
  });

  it("rejects a wall thicker than the body fits", async () => {
    const cube = { id: 1, type: "cube", position: O, rotation: O, scale: S };
    // The cube spans -1..1; a 5-unit wall can't fit, so the op should throw a
    // descriptive error rather than return junk geometry.
    await expect(
      shellItem({
        source: cube,
        thickness: 5,
        allItems: [cube],
        printPrecision: 0.1,
      }),
    ).rejects.toThrow();
  });
});
