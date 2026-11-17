// Shell (hollow) op: the native makeShell hollows a solid to a wall, and the
// "shell" regenerator rebuilds from its embedded source on regen.

import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { shellItem } from "../occClient.js";
import { regenerateItemsForResolution } from "../regenerateItems.js";
import { createRequire } from "module";

const occ = createRequire(import.meta.url)(
  "../../../native/occ-addon/build/Release/occ_addon.node",
);

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

  // A union comes back from OCC as a COMPOUND, even when it holds one solid --
  // every extrudeUnion body (the "Lid" of a Pi case) is one.  The inward offset
  // of a compound came back as a bare shell with no solid, so the cut failed
  // and every thickness was refused as "too large", even 0.2 mm on a 10 mm
  // slab.  Each solid is now hollowed on its own.
  const box = (x1, y1, z1, x2, y2, z2) => occ.makeBox(x1, y1, z1, x2, y2, z2);
  const volume = (id) => occ.shapeVolume(id);

  it("hollows a union body, which OCC hands back as a compound", () => {
    // Two overlapping boxes fuse to one 4 x 1 x 2 solid inside a compound.
    const u = occ.booleanOp(
      [box(0, 0, 0, 3, 1, 2), box(1, 0, 0, 4, 1, 2)],
      "union",
    );
    const t = 0.1;
    const shelled = occ.makeShell(u, t);
    expect(shelled, "makeShell refused a one-solid union").not.toBe(0);
    const wall = 4 * 1 * 2 - (4 - 2 * t) * (1 - 2 * t) * (2 - 2 * t);
    expect(volume(shelled)).toBeCloseTo(wall, 4);
  });

  it("hollows every solid of a union that stays in separate pieces", () => {
    const u = occ.booleanOp(
      [box(0, 0, 0, 1, 1, 1), box(3, 0, 0, 4, 1, 1)],
      "union",
    );
    const t = 0.1;
    const shelled = occ.makeShell(u, t);
    expect(shelled, "makeShell refused a two-solid union").not.toBe(0);
    const wall = 2 * (1 - (1 - 2 * t) ** 3);
    expect(volume(shelled)).toBeCloseTo(wall, 4);
  });
});
