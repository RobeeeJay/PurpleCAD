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

  it("createHighlightHelpers exposes clearHL (used by cameraControls' modifier-keyup handler)", () => {
    // Regression for: chamfering/bevelling an extruded face stopped
    // working because `onModifierUp` in cameraControls.js calls
    // `clearHL(faceHighlightRef)` directly, but the highlights.js
    // refactor made clearHL private to the factory.  Releasing Alt then
    // threw "clearHL is not defined", which silently broke whatever the
    // user was doing next.  The keyup handler is the only caller that
    // needs the visual-only clearer — so it has to come back out of the
    // helpers object explicitly.
    const scene = new THREE.Scene();
    const refs = {
      faceHighlightRef: makeFakeRef(),
      edgeHighlightRef: makeFakeRef(),
      pointHighlightRef: makeFakeRef(),
    };
    const helpers = createHighlightHelpers({
      scene,
      ...refs,
      itemsRef: { current: [] },
    });
    expect(typeof helpers.clearHL).toBe("function");
    // And it should be safe to call on an empty ref (the keyup handler
    // fires on every modifier release, regardless of whether a highlight
    // is currently shown).
    expect(() => helpers.clearHL(refs.faceHighlightRef)).not.toThrow();
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

    // Pass an explicit hit.point on the -Y face — pendingFaceSelection
    // now records this as the centroid sample (cx/cy/cz) so that
    // click-commit's seed-finding and the OCC face matcher can
    // disambiguate coplanar faces without needing to compute a vertex
    // average (which can fall outside non-convex faces).
    helpers.applyFaceHighlight(
      {
        object: cube,
        face: { normal: new THREE.Vector3(0, -1, 0) },
        point: new THREE.Vector3(0.3, -1, 0.2),
      },
      0x88ccff,
    );
    expect(helpers.pendingFaceSelection).toMatchObject({
      itemId: 1,
      nx: 0,
      ny: -1,
      nz: 0,
    });
    expect(helpers.pendingFaceSelection.cx).toBeCloseTo(0.3, 6);
    expect(helpers.pendingFaceSelection.cy).toBeCloseTo(-1, 6);
    expect(helpers.pendingFaceSelection.cz).toBeCloseTo(0.2, 6);
  });

  it("BFS-connectivity highlight: a stepped CSG-like mesh's TWO coplanar +Y faces aren't both highlighted at once", () => {
    // Regression for: "Highlighting a face highlights other faces on
    // that object which share the same direction."  Construct a mesh
    // with two parallel +Y-facing top faces at the SAME y (= coplanar)
    // but NOT connected by shared edges — like a CSG step.  Hovering
    // one must NOT light up the other.
    // Vertex order chosen so the cross-product normal is +Y.
    const positions = new Float32Array([
      // Square 1 (top of left plateau) at y=1, XZ from (0,0) to (1,1):
      0, 1, 0, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0,
      // Square 2 (top of right plateau) at y=1, far away at X∈[3,4]:
      3, 1, 0, 3, 1, 1, 4, 1, 1, 3, 1, 0, 4, 1, 1, 4, 1, 0,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    mesh.userData.itemId = 1;
    mesh.updateMatrixWorld(true);
    const scene = new THREE.Scene();
    const refs = {
      faceHighlightRef: makeFakeRef(),
      edgeHighlightRef: makeFakeRef(),
      pointHighlightRef: makeFakeRef(),
    };
    const helpers = createHighlightHelpers({
      scene,
      ...refs,
      itemsRef: { current: [{ id: 1, type: "csg" }] },
    });
    // Hover the LEFT plateau: faceIndex = 0 picks triangle 0 there.
    helpers.applyFaceHighlight(
      {
        object: mesh,
        face: { normal: new THREE.Vector3(0, 1, 0) },
        faceIndex: 0,
      },
      0x88ccff,
    );
    const hl = refs.faceHighlightRef.current;
    expect(hl).toBeTruthy();
    const posAttr = hl.geometry.getAttribute("position");
    // Left plateau has 2 triangles ⇒ 6 vertices.  Right plateau (which
    // shares the same normal but isn't connected) must NOT be in the
    // overlay — otherwise we'd see 12 vertices.
    expect(posAttr.count).toBe(6);
    // Every overlay vertex MUST come from the left plateau (x in [0, 1]).
    for (let i = 0; i < posAttr.count; i++) {
      expect(posAttr.getX(i)).toBeLessThanOrEqual(1.0001);
    }
  });
});
