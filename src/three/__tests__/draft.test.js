// Draft op: taper selected faces about a neutral (main) face's plane.

import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { draftItem } from "../occClient.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const O = { x: 0, y: 0, z: 0 };
const S = { x: 1, y: 1, z: 1 };
const cube = { id: 1, type: "cube", position: O, rotation: O, scale: S };

// Top face is the neutral plane (the part isn't tapered there); the +X side face
// gets the draft.
const topNeutral = { nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 };
const plusXFace = { nx: 1, ny: 0, nz: 0, cx: 1, cy: 0, cz: 0 };

// Greatest un-centred x among the bottom (y < -0.5) vertices.
const bottomMaxX = (res) => {
  const { positions } = res.geometryData;
  const { cx, cy } = res.centerOffset;
  let mx = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] + cx,
      y = positions[i + 1] + cy;
    if (y < -0.5) mx = Math.max(mx, x);
  }
  return mx;
};

describe("draft op", () => {
  it("tapers the selected side face about the neutral plane", async () => {
    const res = await draftItem({
      source: cube,
      neutral: topNeutral,
      faces: [plusXFace],
      angleDeg: 12,
      flip: false,
      allItems: [cube],
      printPrecision: 0.1,
    });
    expect(res).toBeTruthy();
    expect(res.geometryData.positions.length).toBeGreaterThan(0);
    // The +X face was vertical (bottom x = 1); drafting it about the top neutral
    // plane moves the bottom edge in (or out) — so it's no longer at 1.
    expect(Math.abs(bottomMaxX(res) - 1)).toBeGreaterThan(0.1);
  });

  it("flip reverses the taper direction", async () => {
    const base = await draftItem({
      source: cube,
      neutral: topNeutral,
      faces: [plusXFace],
      angleDeg: 12,
      flip: false,
      allItems: [cube],
      printPrecision: 0.1,
    });
    const flipped = await draftItem({
      source: cube,
      neutral: topNeutral,
      faces: [plusXFace],
      angleDeg: 12,
      flip: true,
      allItems: [cube],
      printPrecision: 0.1,
    });
    // One tapers in (bottom x < 1), the other out (> 1) — opposite sides of 1.
    expect((bottomMaxX(base) - 1) * (bottomMaxX(flipped) - 1)).toBeLessThan(0);
  });
});
