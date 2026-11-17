// Shell (hollow) op: the native makeShell hollows a solid to a wall, and the
// "shell" regenerator rebuilds from its embedded source on regen.

import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { shellItem } from "../occClient.js";
import { regenerateItemsForResolution } from "../regenerateItems.js";
import { createRequire } from "module";
import fs from "fs";

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

  // An open shell: the picked faces are removed, so the body becomes a tray
  // (or a box with no lid) rather than a closed hollow.  The volumes tell the
  // two apart: open-topped, the cavity runs up to the top face.
  it("leaves the picked face open", () => {
    const t = 0.1;
    const top = { faces: [{ nx: 0, ny: 1, nz: 0, cx: 1, cy: 2, cz: 1 }] };
    const open = occ.makeShell(box(0, 0, 0, 2, 2, 2), t, top);
    expect(open, "makeShell refused an open-topped shell").not.toBe(0);
    const tray = 8 - (2 - 2 * t) * (2 - t) * (2 - 2 * t);
    expect(volume(open), "volume of a box open at the top").toBeCloseTo(
      tray,
      4,
    );
  });

  it("opens a face of a union body too", () => {
    const u = occ.booleanOp(
      [box(0, 0, 0, 3, 1, 2), box(1, 0, 0, 4, 1, 2)],
      "union",
    );
    const t = 0.1;
    const top = { faces: [{ nx: 0, ny: 1, nz: 0, cx: 2, cy: 1, cz: 1 }] };
    const open = occ.makeShell(u, t, top);
    expect(open, "makeShell refused to open a union body").not.toBe(0);
    expect(volume(open)).toBeCloseTo(
      4 * 1 * 2 - (4 - 2 * t) * (1 - t) * (2 - 2 * t),
      4,
    );
  });

  it("opens the face through the shellItem op", async () => {
    const cube = { id: 1, type: "cube", position: O, rotation: O, scale: S };
    const closed = await shellItem({
      source: cube,
      thickness: 0.2,
      allItems: [cube],
      printPrecision: 0.1,
    });
    const open = await shellItem({
      source: cube,
      thickness: 0.2,
      openFaces: [{ nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 }],
      allItems: [cube],
      printPrecision: 0.1,
    });
    // Area of the triangles lying in the top plane: the whole 2 x 2 face
    // when closed, only the rim around the opening when open.
    const topArea = (g) => {
      const p = g.positions;
      const ix = g.indices;
      let top = -Infinity;
      for (let i = 1; i < p.length; i += 3) top = Math.max(top, p[i]);
      let area = 0;
      for (let k = 0; k < ix.length; k += 3) {
        const v = [ix[k], ix[k + 1], ix[k + 2]].map((j) => [
          p[3 * j],
          p[3 * j + 1],
          p[3 * j + 2],
        ]);
        if (v.some((q) => Math.abs(q[1] - top) > 1e-6)) continue;
        const [a, b, c] = v;
        area +=
          Math.abs(
            (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]),
          ) / 2;
      }
      return area;
    };
    expect(topArea(closed.geometryData)).toBeCloseTo(4, 4);
    expect(
      topArea(open.geometryData),
      "top rim around the opening",
    ).toBeCloseTo(4 - 1.6 * 1.6, 4);
  });

  // OCC's open shell can report success and hand back the body UNCHANGED:
  // opening the small ledge face of the Pi case's cut body (14 faces) gave the
  // same volume and the same 14 faces, which the app committed as a "shell".
  // A shell always removes material, so a result that removed none is refused.
  it("refuses an open shell that removed nothing, rather than passing the body through", () => {
    const brep = fs.readFileSync(
      new URL("../../../test-files/pi3-case-cut.brep", import.meta.url),
      "utf8",
    );
    const body = occ.shapeFromBrep(brep);
    const before = volume(body);
    const top = {
      faces: [{ nx: 0, ny: 1, nz: 0, cx: -1.73, cy: 1.8, cz: -5.07 }],
    };
    const opened = occ.makeShell(body, 0.05, top);
    expect(opened, "the top face should open").not.toBe(0);
    expect(volume(opened)).toBeLessThan(before * 0.9);
    const ledge = {
      faces: [{ nx: 0, ny: 1, nz: 0, cx: 0.24, cy: 0.9093, cz: -5.07 }],
    };
    const result = occ.makeShell(body, 0.05, ledge);
    expect(
      result === 0 ? "refused" : `volume ${volume(result)} of ${before}`,
    ).toBe("refused");
  });
});
