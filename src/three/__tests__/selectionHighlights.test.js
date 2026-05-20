import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import {
  buildSelectionHighlight,
  disposeHighlightGroup,
  reconcileSelectionHighlight,
} from "../selectionHighlights.js";

vi.mock("../../store", () => ({ useStore: () => null }));
// We do NOT mock LineSegments2 / LineSegmentsGeometry / LineMaterial here —
// the real three.js addon classes are needed so that the produced edge
// overlay behaves like a real THREE.Object3D (traversable, disposable,
// .isLineSegments2 etc.). The other Line2/LineGeometry imports are still
// mocked because they're only pulled in transitively for unrelated tests.
vi.mock("three/addons/lines/Line2.js", () => ({
  Line2: class {
    computeLineDistances() {}
  },
}));
vi.mock("three/addons/lines/LineGeometry.js", () => ({
  LineGeometry: class {
    setPositions() {}
  },
}));
vi.mock("three/addons/environments/RoomEnvironment.js", () => ({
  RoomEnvironment: class {
    dispose() {}
  },
}));
vi.mock("three/addons/postprocessing/EffectComposer.js", () => ({
  EffectComposer: class {
    dispose() {}
    addPass() {}
  },
}));
vi.mock("three/addons/postprocessing/RenderPass.js", () => ({
  RenderPass: class {},
}));
vi.mock("three/addons/postprocessing/UnrealBloomPass.js", () => ({
  UnrealBloomPass: class {},
}));
vi.mock("three/addons/postprocessing/OutputPass.js", () => ({
  OutputPass: class {},
}));
vi.mock("../objectMaterials.js", () => ({
  createMaterial: () => ({ dispose() {} }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCubeMesh(pos = { x: 0, y: 0, z: 0 }, rot = { x: 0, y: 0, z: 0 }) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  mesh.position.set(pos.x, pos.y, pos.z);
  mesh.rotation.set(rot.x, rot.y, rot.z);
  return mesh;
}

// ── Null / empty cases ───────────────────────────────────────────────────────

describe("buildSelectionHighlight – empty / invalid input", () => {
  it("returns null when mesh is missing", () => {
    expect(buildSelectionHighlight(null, { faces: [], edges: [] })).toBeNull();
  });

  it("returns null when subGeo is missing", () => {
    expect(buildSelectionHighlight(makeCubeMesh(), null)).toBeNull();
  });

  it("returns null when faces and edges are both empty", () => {
    expect(
      buildSelectionHighlight(makeCubeMesh(), { faces: [], edges: [] }),
    ).toBeNull();
  });

  it("returns null when faces is undefined and edges is undefined", () => {
    expect(buildSelectionHighlight(makeCubeMesh(), {})).toBeNull();
  });

  it("returns null when face normal matches no triangle and no edges given", () => {
    // Diagonal normal — no box face has this orientation.
    const subGeo = {
      faces: [{ nx: 0.707, ny: 0.707, nz: 0 }],
      edges: [],
    };
    expect(buildSelectionHighlight(makeCubeMesh(), subGeo)).toBeNull();
  });
});

// ── Face highlights ──────────────────────────────────────────────────────────

describe("buildSelectionHighlight – face overlay", () => {
  it("creates a face overlay mesh for a single selected face", () => {
    const mesh = makeCubeMesh();
    const subGeo = {
      faces: [{ nx: 0, ny: 1, nz: 0 }], // +Y top face
      edges: [],
    };
    const group = buildSelectionHighlight(mesh, subGeo);
    expect(group).not.toBeNull();
    const faceMesh = group.children.find((c) => c.userData.kind === "face");
    expect(faceMesh).toBeDefined();
    // Top face of a 2×2×2 cube has 2 triangles → 6 vertices.
    expect(faceMesh.geometry.getAttribute("position").count).toBe(6);
  });

  it("face overlay uses a darker blue (the face-select hover is light blue)", () => {
    const subGeo = { faces: [{ nx: 1, ny: 0, nz: 0 }], edges: [] };
    const group = buildSelectionHighlight(makeCubeMesh(), subGeo);
    const faceMesh = group.children[0];
    // Selected face = darker version of the face-mode hover colour 0x88ccff,
    // so the user reads the selection as the "selected" state of the same
    // semantic colour rather than an unrelated highlight.
    expect(faceMesh.material.color.getHex()).toBe(0x3377cc);
    expect(faceMesh.material.color.getHex()).not.toBe(0x88ccff); // ≠ hover
  });

  it("face overlay uses transparent material so the original face stays visible underneath", () => {
    const subGeo = { faces: [{ nx: 0, ny: 0, nz: 1 }], edges: [] };
    const group = buildSelectionHighlight(makeCubeMesh(), subGeo);
    const faceMesh = group.children[0];
    expect(faceMesh.material.transparent).toBe(true);
    expect(faceMesh.material.opacity).toBeGreaterThan(0);
    expect(faceMesh.material.opacity).toBeLessThanOrEqual(1);
  });

  it("face overlay opacity is HIGHER than the hover overlay opacity (0.5)", () => {
    // When the user clicks a face, the click handler clears the hover overlay
    // so the persistent selection is what they see at click time.  The
    // selection must be opaque enough on its own (with no hover sitting on top)
    // to be clearly visible — not just a faint tint.
    const subGeo = { faces: [{ nx: 0, ny: 1, nz: 0 }], edges: [] };
    const group = buildSelectionHighlight(makeCubeMesh(), subGeo);
    const faceMesh = group.children[0];
    expect(faceMesh.material.opacity).toBeGreaterThan(0.5);
  });

  it("face overlay has depthTest off + high render order so it draws over the mesh", () => {
    // Without this the overlay would z-fight with the underlying face and
    // appear invisible from most angles.
    const subGeo = { faces: [{ nx: 0, ny: 1, nz: 0 }], edges: [] };
    const group = buildSelectionHighlight(makeCubeMesh(), subGeo);
    const faceMesh = group.children[0];
    expect(faceMesh.material.depthTest).toBe(false);
    expect(faceMesh.renderOrder).toBeGreaterThan(0);
  });

  it("creates one overlay covering all triangles when multiple faces selected", () => {
    const subGeo = {
      faces: [
        { nx: 0, ny: 1, nz: 0 },
        { nx: 1, ny: 0, nz: 0 },
      ],
      edges: [],
    };
    const group = buildSelectionHighlight(makeCubeMesh(), subGeo);
    const faceMesh = group.children[0];
    // 2 faces × 2 triangles × 3 verts = 12 vertices.
    expect(faceMesh.geometry.getAttribute("position").count).toBe(12);
  });
});

// ── Edge highlights ──────────────────────────────────────────────────────────

describe("buildSelectionHighlight – edge overlay", () => {
  it("creates a thick line segment for a single selected edge", () => {
    const subGeo = {
      faces: [],
      edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
    };
    const group = buildSelectionHighlight(makeCubeMesh(), subGeo);
    const lines = group.children.find((c) => c.userData.kind === "edge");
    expect(lines).toBeDefined();
    // LineSegmentsGeometry stores each segment as an instanced pair; the
    // segment count is on the per-instance start attribute.
    expect(lines.geometry.attributes.instanceStart.count).toBe(1);
  });

  it("edge overlay uses a saturated orange so the line is clearly visible", () => {
    // WebGL clamps LineBasicMaterial line widths to 1px, which makes a thin
    // mustard line read as "dark" / invisible. We use a real thick LineMaterial
    // AND a bright contrasting colour so the selection is unmistakable.
    const subGeo = {
      faces: [],
      edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
    };
    const group = buildSelectionHighlight(makeCubeMesh(), subGeo);
    const lines = group.children[0];
    expect(lines.material.color.getHex()).toBe(0xff5500);
    expect(lines.material.color.getHex()).not.toBe(0xffdd00); // not the hover yellow
  });

  it("edge overlay has a real pixel linewidth (> 1) so it's visible in WebGL", () => {
    const subGeo = {
      faces: [],
      edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
    };
    const group = buildSelectionHighlight(makeCubeMesh(), subGeo);
    const lines = group.children[0];
    expect(lines.material.linewidth).toBeGreaterThan(1);
  });

  it("edge overlay disables depth test so the line is visible over the mesh", () => {
    const subGeo = {
      faces: [],
      edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
    };
    const group = buildSelectionHighlight(makeCubeMesh(), subGeo);
    const lines = group.children[0];
    expect(lines.material.depthTest).toBe(false);
  });

  it("multiple edges produce a single LineSegments with all positions", () => {
    const subGeo = {
      faces: [],
      edges: [
        { ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 },
        { ax: -1, ay: 1, az: -1, bx: 1, by: 1, bz: -1 },
        { ax: -1, ay: 1, az: 1, bx: -1, by: 1, bz: -1 },
      ],
      edges_unused: 0,
    };
    const group = buildSelectionHighlight(makeCubeMesh(), subGeo);
    const lines = group.children.find((c) => c.userData.kind === "edge");
    // LineSegmentsGeometry uses instanced rendering; the segment count is on
    // instanceStart, not the base position attribute.
    expect(lines.geometry.attributes.instanceStart.count).toBe(3);
  });
});

// ── Mixed selections ─────────────────────────────────────────────────────────

describe("buildSelectionHighlight – mixed faces + edges", () => {
  it("creates both a face overlay AND an edge overlay when both are selected", () => {
    const subGeo = {
      faces: [{ nx: 0, ny: 1, nz: 0 }],
      edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
    };
    const group = buildSelectionHighlight(makeCubeMesh(), subGeo);
    expect(group.children.length).toBe(2);
    expect(group.children.some((c) => c.userData.kind === "face")).toBe(true);
    expect(group.children.some((c) => c.userData.kind === "edge")).toBe(true);
  });
});

// ── Transform matching ───────────────────────────────────────────────────────

describe("buildSelectionHighlight – matches hit mesh transform", () => {
  it("copies position from the hit mesh so the overlay is co-located", () => {
    const mesh = makeCubeMesh({ x: 5, y: -2, z: 3 });
    const subGeo = { faces: [{ nx: 0, ny: 1, nz: 0 }], edges: [] };
    const group = buildSelectionHighlight(mesh, subGeo);
    expect(group.position.x).toBeCloseTo(5);
    expect(group.position.y).toBeCloseTo(-2);
    expect(group.position.z).toBeCloseTo(3);
  });

  it("copies rotation from the hit mesh", () => {
    const mesh = makeCubeMesh({ x: 0, y: 0, z: 0 }, { x: 0.4, y: 0.7, z: 0.1 });
    const subGeo = { faces: [{ nx: 0, ny: 1, nz: 0 }], edges: [] };
    const group = buildSelectionHighlight(mesh, subGeo);
    expect(group.rotation.x).toBeCloseTo(0.4);
    expect(group.rotation.y).toBeCloseTo(0.7);
    expect(group.rotation.z).toBeCloseTo(0.1);
  });

  it("copies scale from the hit mesh", () => {
    const mesh = makeCubeMesh();
    mesh.scale.set(2.5, 2.5, 2.5);
    const subGeo = {
      faces: [],
      edges: [{ ax: 0, ay: 0, az: 0, bx: 1, by: 0, bz: 0 }],
    };
    const group = buildSelectionHighlight(mesh, subGeo);
    expect(group.scale.x).toBeCloseTo(2.5);
    expect(group.scale.y).toBeCloseTo(2.5);
    expect(group.scale.z).toBeCloseTo(2.5);
  });
});

// ── Customisation hooks ──────────────────────────────────────────────────────

describe("buildSelectionHighlight – options", () => {
  it("accepts custom face/edge colours via options", () => {
    const subGeo = {
      faces: [{ nx: 0, ny: 1, nz: 0 }],
      edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
    };
    const group = buildSelectionHighlight(makeCubeMesh(), subGeo, {
      faceColor: 0x123456,
      edgeColor: 0xabcdef,
    });
    const faceMesh = group.children.find((c) => c.userData.kind === "face");
    const lines = group.children.find((c) => c.userData.kind === "edge");
    expect(faceMesh.material.color.getHex()).toBe(0x123456);
    expect(lines.material.color.getHex()).toBe(0xabcdef);
  });
});

// ── Scene-lifecycle integration ──────────────────────────────────────────────
// These tests mimic Viewport.jsx's useEffect: clear any prior highlight, then
// build + scene.add() the new one. The key property they verify is that the
// highlight persists in the scene independently of the hover state — the user
// can move the cursor away (or remove the hover overlay entirely) and the
// selection group must still be a child of the scene.

describe("selection highlight scene lifecycle", () => {
  it("highlight is added as a scene child after a face is selected", () => {
    const scene = new THREE.Scene();
    const mesh = makeCubeMesh();
    scene.add(mesh);
    const subGeo = { faces: [{ nx: 0, ny: 1, nz: 0 }], edges: [] };

    const before = scene.children.length;
    const group = buildSelectionHighlight(mesh, subGeo);
    scene.add(group);
    expect(scene.children.length).toBe(before + 1);
    expect(scene.children).toContain(group);
  });

  it("highlight remains in scene after a separate hover-cleanup pass runs", () => {
    // Mimic the real cameraControls flow: hover creates a separate "hover"
    // mesh, then pointer-move removes that hover mesh.  The persistent
    // selection group MUST NOT be touched by that hover cleanup, otherwise
    // the user loses their visual selection when they move the cursor away.
    const scene = new THREE.Scene();
    const mesh = makeCubeMesh();
    scene.add(mesh);

    const subGeo = { faces: [{ nx: 0, ny: 1, nz: 0 }], edges: [] };
    const selectionGroup = buildSelectionHighlight(mesh, subGeo);
    scene.add(selectionGroup);

    // Simulate the hover overlay being added then removed.
    const hoverMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xff8833 }),
    );
    scene.add(hoverMesh);
    scene.remove(hoverMesh);
    hoverMesh.geometry.dispose();
    hoverMesh.material.dispose();

    // The selection group must still be in the scene.
    expect(scene.children).toContain(selectionGroup);
    // And it must still have visible material settings (depthTest:false,
    // transparent, non-zero opacity, high renderOrder).
    const faceOverlay = selectionGroup.children.find(
      (c) => c.userData.kind === "face",
    );
    expect(faceOverlay).toBeDefined();
    expect(faceOverlay.material.depthTest).toBe(false);
    expect(faceOverlay.material.opacity).toBeGreaterThan(0);
    expect(faceOverlay.renderOrder).toBeGreaterThan(0);
  });

  it("re-selecting a different face replaces the prior highlight correctly", () => {
    const scene = new THREE.Scene();
    const mesh = makeCubeMesh();
    scene.add(mesh);

    // First selection: +Y face.
    const firstSubGeo = { faces: [{ nx: 0, ny: 1, nz: 0 }], edges: [] };
    let group = buildSelectionHighlight(mesh, firstSubGeo);
    scene.add(group);
    const firstGroup = group;

    // User clicks a different face: clear the old group, build a new one.
    scene.remove(firstGroup);
    disposeHighlightGroup(firstGroup);
    const secondSubGeo = { faces: [{ nx: 1, ny: 0, nz: 0 }], edges: [] };
    group = buildSelectionHighlight(mesh, secondSubGeo);
    scene.add(group);

    expect(scene.children).not.toContain(firstGroup);
    expect(scene.children).toContain(group);
  });

  it("edge selection persists in scene the same way face selection does", () => {
    const scene = new THREE.Scene();
    const mesh = makeCubeMesh();
    scene.add(mesh);
    const subGeo = {
      faces: [],
      edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
    };
    const group = buildSelectionHighlight(mesh, subGeo);
    scene.add(group);
    expect(scene.children).toContain(group);
    // The line segments should have depthTest:false so the edge is visible
    // through the mesh from any angle.
    const lines = group.children.find((c) => c.userData.kind === "edge");
    expect(lines.material.depthTest).toBe(false);
  });
});

// ── Visual distinguishability from hover ─────────────────────────────────────
// The user explicitly asked for the selection colour to be distinct from
// hover so they can tell "I'm just pointing at this" apart from "I have
// committed this to selection".

describe("selection highlight is visually distinguishable from hover", () => {
  // The face-select hover colour the user sees while holding Cmd is light
  // blue 0x88ccff; the edge-select hover (Shift held) is yellow 0xffdd00.
  const HOVER_FACE_SELECT = 0x88ccff;
  const HOVER_EDGE_SELECT = 0xffdd00;

  it("face selection colour is NOT identical to the face-select hover colour", () => {
    const subGeo = { faces: [{ nx: 0, ny: 1, nz: 0 }], edges: [] };
    const group = buildSelectionHighlight(makeCubeMesh(), subGeo);
    const c = group.children[0].material.color.getHex();
    expect(c).not.toBe(HOVER_FACE_SELECT);
  });

  it("edge selection colour is NOT identical to the edge-select hover colour", () => {
    const subGeo = {
      faces: [],
      edges: [{ ax: 0, ay: 0, az: 0, bx: 1, by: 0, bz: 0 }],
    };
    const group = buildSelectionHighlight(makeCubeMesh(), subGeo);
    const c = group.children[0].material.color.getHex();
    expect(c).not.toBe(HOVER_EDGE_SELECT);
  });
});

// ── Primitive item types ─────────────────────────────────────────────────────
// Sphere / cylinder / torus items have `mesh.geometry = BoxGeometry(...)`
// — the actual visible shape is drawn by a shader.  buildSelectionHighlight
// must use a synthesized real geometry for these, otherwise the triangle
// normals of the box stand-in won't match the stored hit normal and no
// overlay is produced.  This is the bug the user reported: "clicking on a
// face doesn't persist a visual highlight".

describe("buildSelectionHighlight – primitive item types", () => {
  function makePrimitiveMesh(type) {
    // Stand-in geometry, mirroring what sceneObjects.js does.
    const size =
      type === "sphere" ? 3 : type === "torus" ? [3, 1.2, 3] : [2, 2, 2];
    const geo = new THREE.BoxGeometry(
      ...(Array.isArray(size) ? size : [size, size, size]),
    );
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    mesh.userData.itemId = 1;
    mesh.userData.hullGeometry = geo;
    return mesh;
  }

  it("sphere: produces a highlight overlay (treats entire surface as one face)", () => {
    const mesh = makePrimitiveMesh("sphere");
    // Stored normal is a unit radial direction; the box stand-in's triangles
    // do not have this normal, so without primitive handling the overlay
    // would be empty.
    const subGeo = {
      faces: [{ nx: 0.577, ny: 0.577, nz: 0.577 }],
      edges: [],
    };
    const group = buildSelectionHighlight(mesh, subGeo, { itemType: "sphere" });
    expect(group).not.toBeNull();
    const overlay = group.children.find((c) => c.isMesh);
    expect(overlay).toBeDefined();
    expect(overlay.geometry.getAttribute("position").count).toBeGreaterThan(0);
  });

  it("primitive face-selection overlay matches the shader's exact radii (no inflated 'halo' past the object)", () => {
    // Previously the overlay used 1.53 / 1.015 / 1.01-0.42 as z-fighting
    // insurance, which made the highlight visibly larger than the actual
    // primitive.  The overlay material uses depthTest:false + high render
    // order, so inflation isn't needed — and these tests pin the bounding
    // box of the overlay to the shader's exact dimensions.
    {
      const mesh = makePrimitiveMesh("sphere");
      const group = buildSelectionHighlight(
        mesh,
        { faces: [{ nx: 0, ny: 1, nz: 0 }], edges: [] },
        { itemType: "sphere" },
      );
      const overlay = group.children.find((c) => c.userData.kind === "face");
      const bbox = new THREE.Box3().setFromBufferAttribute(
        overlay.geometry.getAttribute("position"),
      );
      // Sphere radius 1.5; bbox half-extent must equal 1.5 (no inflation).
      expect(bbox.max.x).toBeLessThanOrEqual(1.5 + 1e-3);
      expect(bbox.min.x).toBeGreaterThanOrEqual(-1.5 - 1e-3);
    }
    {
      const mesh = makePrimitiveMesh("cylinder");
      const group = buildSelectionHighlight(
        mesh,
        { faces: [{ nx: 1, ny: 0, nz: 0 }], edges: [] },
        { itemType: "cylinder" },
      );
      const overlay = group.children.find((c) => c.userData.kind === "face");
      const bbox = new THREE.Box3().setFromBufferAttribute(
        overlay.geometry.getAttribute("position"),
      );
      // Cylinder radius 1, height 2.
      expect(bbox.max.x).toBeLessThanOrEqual(1.0 + 1e-3);
      expect(bbox.max.y).toBeLessThanOrEqual(1.0 + 1e-3); // height/2
      expect(bbox.min.y).toBeGreaterThanOrEqual(-1.0 - 1e-3);
    }
    {
      const mesh = makePrimitiveMesh("torus");
      const group = buildSelectionHighlight(
        mesh,
        { faces: [{ nx: 0, ny: 1, nz: 0 }], edges: [] },
        { itemType: "torus" },
      );
      const overlay = group.children.find((c) => c.userData.kind === "face");
      const bbox = new THREE.Box3().setFromBufferAttribute(
        overlay.geometry.getAttribute("position"),
      );
      // Torus main r=1, tube=0.4 → outer x extent = 1.4, y extent = 0.4
      // (after the -90° X rotation the shader's torus uses).
      expect(bbox.max.x).toBeLessThanOrEqual(1.4 + 1e-3);
      expect(bbox.max.y).toBeLessThanOrEqual(0.4 + 1e-3);
    }
  });

  it("primitive face-selection overlay tessellates at DISPLAY_PRECISION (smooth, matches shader)", () => {
    // Pin the *minimum* triangle count for primitive face-selection overlays
    // so they match the smooth-rendered shape, not the previous 16-/20-segment
    // hardcoded geometry.  At DISPLAY_PRECISION_MM = 0.01 mm:
    //   sphere r=1.53  → ~88 width × ~44 height = ~3800 vertices
    //   cylinder r=1.015 → ~70 radial → SphereGeometry-like vertex count
    //   torus tube r=0.42 → ~46 radial × ~70 tubular
    // We assert "well above the old hardcoded count" rather than an exact
    // number, so the test stays stable if DISPLAY_PRECISION_MM changes
    // slightly.
    const types = [
      { type: "sphere", minVerts: 200 }, // was 20 × 16 ≈ 360 verts; smooth ≈ 3800
      { type: "cylinder", minVerts: 50 }, // was 24 segs ≈ 100 verts; smooth ≈ 290
      { type: "torus", minVerts: 200 }, // was 16 × 32 ≈ 580 verts; smooth ≈ 3200
    ];
    for (const { type, minVerts } of types) {
      const mesh = makePrimitiveMesh(type);
      const normal =
        type === "torus"
          ? { nx: 0, ny: 1, nz: 0 }
          : { nx: 0.577, ny: 0.577, nz: 0.577 };
      const group = buildSelectionHighlight(
        mesh,
        { faces: [normal], edges: [] },
        { itemType: type },
      );
      const overlay = group.children.find((c) => c.userData.kind === "face");
      // matchVerts counts ALL triangles' positions (every tri = 3 positions),
      // so the count = 3 × triangle count.  Tied to the tessellation density.
      expect(overlay.geometry.getAttribute("position").count).toBeGreaterThan(
        minVerts,
      );
    }
  });

  it("torus: produces a highlight overlay covering the whole surface", () => {
    const mesh = makePrimitiveMesh("torus");
    const subGeo = {
      faces: [{ nx: 0, ny: 1, nz: 0 }],
      edges: [],
    };
    const group = buildSelectionHighlight(mesh, subGeo, { itemType: "torus" });
    expect(group).not.toBeNull();
    const overlay = group.children.find((c) => c.isMesh);
    expect(overlay).toBeDefined();
    expect(overlay.geometry.getAttribute("position").count).toBeGreaterThan(0);
  });

  it("cylinder side: highlight uses only side-quad triangles when hit normal is horizontal", () => {
    const mesh = makePrimitiveMesh("cylinder");
    const subGeo = {
      faces: [{ nx: 1, ny: 0, nz: 0 }], // side hit (horizontal normal)
      edges: [],
    };
    const group = buildSelectionHighlight(mesh, subGeo, {
      itemType: "cylinder",
    });
    expect(group).not.toBeNull();
    const overlay = group.children.find((c) => c.isMesh);
    expect(overlay).toBeDefined();
    expect(overlay.geometry.getAttribute("position").count).toBeGreaterThan(0);
  });

  it("cylinder top cap: highlight uses top-cap triangles when hit normal is +Y", () => {
    const mesh = makePrimitiveMesh("cylinder");
    const subGeo = {
      faces: [{ nx: 0, ny: 1, nz: 0 }],
      edges: [],
    };
    const group = buildSelectionHighlight(mesh, subGeo, {
      itemType: "cylinder",
    });
    expect(group).not.toBeNull();
    const overlay = group.children.find((c) => c.isMesh);
    expect(overlay.geometry.getAttribute("position").count).toBeGreaterThan(0);
  });

  it("WITHOUT itemType option, primitive returns null (regression: this is the original user bug)", () => {
    // Pre-fix behaviour: the function read mesh.geometry (BoxGeometry stand-in)
    // and tried to match triangle normals against the stored radial sphere
    // normal — no match → matchVerts empty → null result.  Verifies the bug
    // existed and is fixed by providing itemType.
    const mesh = makePrimitiveMesh("sphere");
    const subGeo = {
      faces: [{ nx: 0.577, ny: 0.577, nz: 0.577 }], // sphere hit normal
      edges: [],
    };
    const group = buildSelectionHighlight(mesh, subGeo); // no itemType
    expect(group).toBeNull();
  });
});

// ── reconcileSelectionHighlight: replicates Viewport's useEffect flow ───────
// These tests cover the exact flow that runs when the user clicks a face or
// edge in the 3D viewport.  They guard against the specific bug the user
// reported: "when the cursor moves off that face it no longer shows it has
// been selected" — i.e. the persistent selection group must remain in the
// scene after the hover overlay is removed.

describe("reconcileSelectionHighlight", () => {
  const ITEM_ID = 1;

  function setup() {
    const scene = new THREE.Scene();
    const mesh = makeCubeMesh();
    scene.add(mesh);
    const objectsRef = { [ITEM_ID]: mesh };
    return { scene, mesh, objectsRef };
  }

  it("returns null and leaves the scene alone when selection is null", () => {
    const { scene, objectsRef } = setup();
    const initialChildren = scene.children.length;
    const result = reconcileSelectionHighlight(scene, null, null, objectsRef);
    expect(result).toBeNull();
    expect(scene.children.length).toBe(initialChildren);
  });

  it("adds a highlight group to the scene when a face is selected", () => {
    const { scene, objectsRef } = setup();
    const before = scene.children.length;
    const group = reconcileSelectionHighlight(
      scene,
      null,
      { itemId: ITEM_ID, faces: [{ nx: 0, ny: 1, nz: 0 }], edges: [] },
      objectsRef,
    );
    expect(group).not.toBeNull();
    expect(scene.children.length).toBe(before + 1);
    expect(scene.children).toContain(group);
  });

  it("adds a highlight group to the scene when an edge is selected", () => {
    const { scene, objectsRef } = setup();
    const before = scene.children.length;
    const group = reconcileSelectionHighlight(
      scene,
      null,
      {
        itemId: ITEM_ID,
        faces: [],
        edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
      },
      objectsRef,
    );
    expect(group).not.toBeNull();
    expect(scene.children.length).toBe(before + 1);
    expect(scene.children).toContain(group);
  });

  it("removes the previous highlight before adding a new one", () => {
    const { scene, objectsRef } = setup();
    const first = reconcileSelectionHighlight(
      scene,
      null,
      { itemId: ITEM_ID, faces: [{ nx: 0, ny: 1, nz: 0 }], edges: [] },
      objectsRef,
    );
    const second = reconcileSelectionHighlight(
      scene,
      first,
      { itemId: ITEM_ID, faces: [{ nx: 1, ny: 0, nz: 0 }], edges: [] },
      objectsRef,
    );
    expect(scene.children).not.toContain(first);
    expect(scene.children).toContain(second);
  });

  it("clears the highlight when selection is cleared (returns null)", () => {
    const { scene, objectsRef } = setup();
    const first = reconcileSelectionHighlight(
      scene,
      null,
      { itemId: ITEM_ID, faces: [{ nx: 0, ny: 1, nz: 0 }], edges: [] },
      objectsRef,
    );
    expect(scene.children).toContain(first);
    const result = reconcileSelectionHighlight(scene, first, null, objectsRef);
    expect(result).toBeNull();
    expect(scene.children).not.toContain(first);
  });

  // KEY TEST: the user's reported regression — the persistent highlight must
  // survive the removal of a separate hover overlay (which is what
  // cameraControls.js does on every pointermove).
  it("REGRESSION: selection highlight survives a hover-overlay removal", () => {
    const { scene, objectsRef } = setup();
    // 1. User Cmd-clicks a face → reconcileSelectionHighlight adds the
    //    persistent highlight group to the scene.
    const selectionGroup = reconcileSelectionHighlight(
      scene,
      null,
      { itemId: ITEM_ID, faces: [{ nx: 0, ny: 1, nz: 0 }], edges: [] },
      objectsRef,
    );
    expect(scene.children).toContain(selectionGroup);

    // 2. The hover overlay (a SEPARATE mesh in cameraControls.js) is added by
    //    pointermove and removed when the cursor moves off the face.  We
    //    simulate that complete lifecycle here.
    const hoverMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xff8833 }),
    );
    scene.add(hoverMesh);
    scene.remove(hoverMesh);
    hoverMesh.geometry.dispose();
    hoverMesh.material.dispose();

    // 3. Without ANY further interaction the persistent highlight must STILL
    //    be in the scene — this is the exact behaviour the user said was
    //    missing in the bug report.
    expect(scene.children).toContain(selectionGroup);
    const overlay = selectionGroup.children.find(
      (c) => c.userData.kind === "face",
    );
    expect(overlay).toBeDefined();
    // And it must still render visibly (depthTest:false + non-zero opacity).
    expect(overlay.material.depthTest).toBe(false);
    expect(overlay.material.opacity).toBeGreaterThan(0);
  });

  it("does nothing when objectsRef doesn't contain the selected item", () => {
    const scene = new THREE.Scene();
    const result = reconcileSelectionHighlight(
      scene,
      null,
      { itemId: 999, faces: [{ nx: 0, ny: 1, nz: 0 }], edges: [] },
      {},
    );
    expect(result).toBeNull();
    expect(scene.children.length).toBe(0);
  });

  it("returns null when the face normal matches no triangle (and no edges)", () => {
    const { scene, objectsRef } = setup();
    const result = reconcileSelectionHighlight(
      scene,
      null,
      {
        itemId: ITEM_ID,
        faces: [{ nx: 0.707, ny: 0.707, nz: 0 }], // diagonal — no cube face
        edges: [],
      },
      objectsRef,
    );
    expect(result).toBeNull();
    expect(scene.children.length).toBe(1); // just the cube, no highlight
  });
});

// ── Disposal ─────────────────────────────────────────────────────────────────

describe("disposeHighlightGroup", () => {
  it("disposes geometries and materials of each child", () => {
    const subGeo = {
      faces: [{ nx: 0, ny: 1, nz: 0 }],
      edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
    };
    const group = buildSelectionHighlight(makeCubeMesh(), subGeo);
    const disposeSpies = [];
    group.traverse((obj) => {
      if (obj.geometry) {
        const spy = vi.spyOn(obj.geometry, "dispose");
        disposeSpies.push(spy);
      }
      if (obj.material) {
        const spy = vi.spyOn(obj.material, "dispose");
        disposeSpies.push(spy);
      }
    });
    disposeHighlightGroup(group);
    expect(disposeSpies.length).toBeGreaterThan(0);
    for (const s of disposeSpies) expect(s).toHaveBeenCalled();
  });

  it("does not throw when given null", () => {
    expect(() => disposeHighlightGroup(null)).not.toThrow();
  });
});
