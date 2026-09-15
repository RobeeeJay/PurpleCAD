// buildPatternPreviewObjects must emit one solid highlight per selected source
// shape plus one bold dashed line per preview copy — so the duplicated geometry
// is highlighted and the copies read as not-yet-committed.

import { describe, it, expect, vi } from "vitest";

vi.mock("three/addons/lines/Line2.js", () => ({
  Line2: class {
    constructor(g, m) {
      this.geometry = g;
      this.material = m;
    }
    computeLineDistances() {}
  },
}));
vi.mock("three/addons/lines/LineMaterial.js", () => ({
  LineMaterial: class {
    constructor(o) {
      // Every real three material carries userData; the screen-space dash
      // sizing keeps its settings there.
      this.userData = {};
      Object.assign(this, o);
    }
  },
}));
vi.mock("three/addons/lines/LineGeometry.js", () => ({
  LineGeometry: class {
    setPositions() {}
  },
}));
vi.mock("../../sceneObjects.js", () => ({
  getSketchShapePoints: () => [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
  ],
}));

import { buildPatternPreviewObjects } from "../sketchPatternPreview.js";

// getSize echoes the vector back so resolutionOf never touches `window`.
const renderer = { getSize: (v) => v };

describe("buildPatternPreviewObjects", () => {
  it("emits a solid highlight per source and a dashed line per copy", () => {
    const objs = buildPatternPreviewObjects({
      sketchMesh: {},
      sourceShapes: [{}, {}], // 2 selected sources
      copyShapes: [{}, {}, {}], // 3 preview copies
      color: 0xff8844,
      renderer,
    });

    expect(objs).toHaveLength(5);
    const highlights = objs.slice(0, 2);
    const copies = objs.slice(2);
    // Sources: solid, thicker, drawn on top of the copies, in the normal
    // sketch-selection colour.
    expect(highlights.every((o) => o.material.dashed === false)).toBe(true);
    expect(highlights.every((o) => o.renderOrder === 1009)).toBe(true);
    expect(highlights.every((o) => o.material.color === 0x44aaff)).toBe(true);
    // Copies: dashed, in the tool colour, slightly transparent.
    expect(copies.every((o) => o.material.dashed === true)).toBe(true);
    expect(copies.every((o) => o.material.color === 0xff8844)).toBe(true);
    expect(copies.every((o) => o.material.opacity < 1)).toBe(true);
    // Their dashes are sized in screen pixels, refreshed per frame, so the
    // copies keep reading as dashed at any zoom rather than going solid.
    expect(copies.every((o) => o.material.userData.screenDash)).toBe(true);
  });

  it("renders highlights even when there are no copies yet", () => {
    const objs = buildPatternPreviewObjects({
      sketchMesh: {},
      sourceShapes: [{}],
      copyShapes: [],
      color: 0x123456,
      renderer,
    });
    expect(objs).toHaveLength(1);
    expect(objs[0].material.dashed).toBe(false);
  });
});
