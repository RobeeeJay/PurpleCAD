// Regression: holding Option/Alt while hovering a cube face used to
// highlight BOTH the hovered face AND its opposite (back) face because
// the triangle-vs-hit-normal match was Math.abs(dot) > 0.999.  With
// `Math.abs`, an anti-parallel back-face triangle (dot = -1) compares
// the same as the front-face triangle (dot = +1).  The fix is a signed
// dot test.

import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { createHighlightHelpers } from "../cameraControls/highlights.js";

vi.mock("../../store", () => {
  const useStore = () => null;
  useStore.getState = () => ({ curveResolution: null, variables: [] });
  return { useStore };
});

function makeCubeMesh() {
  // 2×2×2 cube at origin — six axis-aligned faces, each split into 2
  // triangles ⇒ 12 triangles total, 2 per face.
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial(),
  );
  mesh.userData.itemId = 1;
  mesh.updateMatrixWorld(true);
  return mesh;
}

function makeFakeRef() {
  return { current: null };
}

describe("hover face highlight (Alt-hover) does not include the opposite face", () => {
  it("hovering +Y on a cube highlights only the +Y face triangles, not -Y", () => {
    const cube = makeCubeMesh();
    const scene = new THREE.Scene();
    const faceHighlightRef = makeFakeRef();
    const edgeHighlightRef = makeFakeRef();
    const pointHighlightRef = makeFakeRef();
    const itemsRef = { current: [{ id: 1, type: "cube" }] };

    const helpers = createHighlightHelpers({
      scene,
      faceHighlightRef,
      edgeHighlightRef,
      pointHighlightRef,
      itemsRef,
    });

    // Simulate a raycast hit on the cube's +Y face.
    helpers.applyFaceHighlight(
      {
        object: cube,
        face: { normal: new THREE.Vector3(0, 1, 0) },
      },
      0x88ccff,
    );

    const hl = faceHighlightRef.current;
    expect(hl).toBeTruthy();
    const posAttr = hl.geometry.getAttribute("position");
    // Two triangles share the +Y face ⇒ 6 vertices.  With the old
    // Math.abs(dot) bug this would be 12 (top + bottom face).
    expect(posAttr.count).toBe(6);
    // Every vertex y MUST be the cube's +Y top (== +1).  A leaked
    // back-face triangle would have y = -1.
    for (let i = 0; i < posAttr.count; i++) {
      expect(posAttr.getY(i)).toBeCloseTo(1, 6);
    }
  });

  it("hovering -Z highlights only the -Z face, not +Z", () => {
    const cube = makeCubeMesh();
    const scene = new THREE.Scene();
    const refs = {
      faceHighlightRef: makeFakeRef(),
      edgeHighlightRef: makeFakeRef(),
      pointHighlightRef: makeFakeRef(),
    };
    const helpers = createHighlightHelpers({
      scene,
      ...refs,
      itemsRef: { current: [{ id: 1, type: "cube" }] },
    });

    helpers.applyFaceHighlight(
      { object: cube, face: { normal: new THREE.Vector3(0, 0, -1) } },
      0x88ccff,
    );

    const posAttr =
      refs.faceHighlightRef.current.geometry.getAttribute("position");
    expect(posAttr.count).toBe(6);
    for (let i = 0; i < posAttr.count; i++) {
      expect(posAttr.getZ(i)).toBeCloseTo(-1, 6);
    }
  });

  it("pendingFaceSelection records the SIGNED hit normal (not |normal|)", () => {
    const cube = makeCubeMesh();
    const scene = new THREE.Scene();
    const refs = {
      faceHighlightRef: makeFakeRef(),
      edgeHighlightRef: makeFakeRef(),
      pointHighlightRef: makeFakeRef(),
    };
    const helpers = createHighlightHelpers({
      scene,
      ...refs,
      itemsRef: { current: [{ id: 1, type: "cube" }] },
    });

    helpers.applyFaceHighlight(
      { object: cube, face: { normal: new THREE.Vector3(0, -1, 0) } },
      0x88ccff,
    );
    expect(helpers.pendingFaceSelection).toEqual({
      itemId: 1,
      nx: 0,
      ny: -1,
      nz: 0,
    });
  });
});
