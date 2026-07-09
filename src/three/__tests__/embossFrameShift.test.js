// After a timeline reorder/delete relinks an emboss's source to a DIFFERENT
// kind of body (extrude ↔ bbox-centred csg), the emboss's face/faceSet anchors
// — absolute coordinates in the frame it was AUTHORED in — must be translated
// into the CURRENT source's frame, or the relief jumps by the frame delta
// (≈ half the body height for an extrude→chamfer swap).

import { describe, it, expect, vi } from "vitest";

vi.mock("../occClient.js", () => ({
  chamferOrFilletItem: vi.fn(),
  pushPullFaces: vi.fn(),
  shellItem: vi.fn(),
  holeItem: vi.fn(),
  embossItem: vi.fn(),
  draftItem: vi.fn(),
  revolveItem: vi.fn(),
  pipeItem: vi.fn(),
  loftItem: vi.fn(),
  pattern3dItem: vi.fn(),
  performCsg: vi.fn(),
}));
vi.mock("../../store", () => {
  const useStore = () => null;
  useStore.getState = () => ({ variables: [] });
  return { useStore };
});

const { shiftEmbossFrame } = await import("../regenerateItems.js");

const face = { cx: 2.5, cy: 0, cz: 2.5, nx: 1, ny: 0, nz: 0 };
const faceSet = {
  developable: {
    axis: [0, 0, 1],
    e1: [1, 0, 0],
    e2: [0, 1, 0],
    curve: [],
    arc: [0],
    norms: [],
    aMin: 0,
    aMax: 5,
  },
};

describe("shiftEmbossFrame", () => {
  it("translates anchors when the relinked source is bbox-centred", () => {
    // Authored on the raw extrude (offset 0); relinked onto a chamfer csg whose
    // frame is bbox-centred at z=2.5 — anchors must shift by -2.5 along z.
    const regen = { sourceCenterOffset: { cx: 0, cy: 0, cz: 0 } };
    const source = {
      type: "csg",
      regenerator: { kind: "chamfer", centerOffset: { cx: 0, cy: 0, cz: 2.5 } },
    };
    const r = shiftEmbossFrame(face, faceSet, regen, source);
    expect(r.face.cz).toBeCloseTo(0); // 2.5 - 2.5
    expect(r.face.cx).toBeCloseTo(2.5); // unchanged axis
    expect(r.faceSet.developable.aMin).toBeCloseTo(-2.5);
    expect(r.faceSet.developable.aMax).toBeCloseTo(2.5);
  });

  it("no-op when the frames match (same-kind source)", () => {
    const regen = { sourceCenterOffset: { cx: 0, cy: 0, cz: 2.5 } };
    const source = {
      type: "csg",
      regenerator: { kind: "chamfer", centerOffset: { cx: 0, cy: 0, cz: 2.5 } },
    };
    const r = shiftEmbossFrame(face, faceSet, regen, source);
    expect(r.face).toBe(face);
    expect(r.faceSet).toBe(faceSet);
  });

  it("no-op for legacy recipes without the authored-frame record", () => {
    const r = shiftEmbossFrame(face, faceSet, {}, { type: "extrude" });
    expect(r.face).toBe(face);
    expect(r.faceSet).toBe(faceSet);
  });
});
