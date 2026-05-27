// End-to-end smoke tests for STL + STEP export.  Verifies that the native
// C++ addon's export pipeline produces valid output.

import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { makeCube, makeSphere } from "../primitives.js";
import { tessellate } from "../tessellate.js";

// The store import chain pulls in DOM-only modules; mock it so this test
// file can run in node.
vi.mock("../../../store", () => {
  const useStore = () => null;
  useStore.getState = () => ({ variables: [] });
  return { useStore };
});

describe("occOps.exportSTL / exportSTEP", () => {
  it("exportSTL emits a valid binary STL for a scene", async () => {
    const { ops } = await import("../../occOps.js");
    const items = [
      { id: 1, type: "cube", position: { x: 0, y: 0, z: 0 } },
      { id: 2, type: "sphere", position: { x: 4, y: 0, z: 0 } },
    ];
    const buf = await ops.exportSTL({ items });
    expect(buf).toBeInstanceOf(ArrayBuffer);
    // 80-byte header + 4-byte count + 50 bytes per triangle.
    expect(buf.byteLength).toBeGreaterThan(84);
    const view = new DataView(buf);
    const triCount = view.getUint32(80, true);
    expect(triCount).toBeGreaterThan(0);
    expect(buf.byteLength).toBe(84 + triCount * 50);
  });

  it("exportSTL returns null for an empty scene", async () => {
    const { ops } = await import("../../occOps.js");
    expect(await ops.exportSTL({ items: [] })).toBeNull();
  });

  it("exportSTEP emits an ISO-10303-21 file", async () => {
    const { ops } = await import("../../occOps.js");
    const items = [{ id: 1, type: "cube", position: { x: 0, y: 0, z: 0 } }];
    const content = await ops.exportSTEP({ items });
    expect(typeof content).toBe("string");
    expect(content.startsWith("ISO-10303-21;")).toBe(true);
    expect(content.trim().endsWith("END-ISO-10303-21;")).toBe(true);
  });

  it("export pipeline preserves chamfers on CSG items", async () => {
    // Regression for: "Exported STL and Step files do not seem to include
    // chamfers or bevels."  buildItemShapeLocal must use chamferShapeBy
    // (not chamferShape) so face-mode chamfers and saved angleRad are
    // honoured during regeneration; otherwise the regenerated shape is
    // identical to the source and the export drops the chamfer.
    const { buildItemShapeLocal } = await import("../../occOps.js");
    const { tessellate: tess } = await import("../tessellate.js");
    const cube = { id: 1, type: "cube", position: { x: 0, y: 0, z: 0 } };
    const chamfered = {
      id: 2,
      type: "csg",
      position: { x: 0, y: 0, z: 0 },
      regenerator: {
        kind: "chamfer",
        source: cube,
        subGeo: {
          edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
          faces: [],
        },
        amount: 0.1,
        segments: 1,
      },
    };
    const baseShape = buildItemShapeLocal(cube, [cube]);
    const chamferedShape = buildItemShapeLocal(chamfered, [cube, chamfered]);
    expect(chamferedShape).toBeTruthy();
    const baseGeo = tess(baseShape, 0.01);
    const chamferedGeo = tess(chamferedShape, 0.01);
    // Chamfering an edge adds a new sloped face — the tessellation must
    // have more triangles than the unmodified cube.
    expect(chamferedGeo.index.count).toBeGreaterThan(baseGeo.index.count);
  });

  it("tessellates OCC primitives and produces non-empty geometries", () => {
    const cubeGeo = tessellate(makeCube(), 0.01);
    const sphereGeo = tessellate(makeSphere(), 0.01);
    expect(cubeGeo.getAttribute("position").count).toBeGreaterThan(0);
    expect(sphereGeo.getAttribute("position").count).toBeGreaterThan(0);
  });
});
