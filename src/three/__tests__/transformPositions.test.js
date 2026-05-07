import { describe, it, expect, vi } from "vitest";
import {
  findClosedLoops,
  polyCentroid,
  buildSceneObjects,
} from "../sceneObjects.js";

// ── THREE.js mock ─────────────────────────────────────────────────────────────
// Vector3 includes a real applyEuler (XYZ intrinsic order) so that the extrude
// centroid offset is correctly rotated in the position tests.
vi.mock("three", () => {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    set(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
    copy(v) {
      this.x = v.x;
      this.y = v.y;
      this.z = v.z;
      return this;
    }
    clone() {
      return new Vector3(this.x, this.y, this.z);
    }
    applyEuler(e) {
      // Intrinsic XYZ Euler: apply Rx, then Ry, then Rz
      const { x, y, z } = this;
      const cx = Math.cos(e.x || 0),
        sx = Math.sin(e.x || 0);
      const cy = Math.cos(e.y || 0),
        sy = Math.sin(e.y || 0);
      const cz = Math.cos(e.z || 0),
        sz = Math.sin(e.z || 0);
      const y1 = y * cx - z * sx,
        z1 = y * sx + z * cx; // after Rx
      const x2 = x * cy + z1 * sy,
        z2 = -x * sy + z1 * cy; // after Ry
      this.x = x2 * cz - y1 * sz;
      this.y = x2 * sz + y1 * cz;
      this.z = z2; // after Rz
      return this;
    }
    applyQuaternion() {
      return this;
    }
    normalize() {
      return this;
    }
    sub(v) {
      this.x -= v.x;
      this.y -= v.y;
      this.z -= v.z;
      return this;
    }
    add(v) {
      this.x += v.x;
      this.y += v.y;
      this.z += v.z;
      return this;
    }
    addScaledVector(v, s) {
      this.x += v.x * s;
      this.y += v.y * s;
      this.z += v.z * s;
      return this;
    }
    subVectors(a, b) {
      this.x = a.x - b.x;
      this.y = a.y - b.y;
      this.z = a.z - b.z;
      return this;
    }
    multiplyScalar(s) {
      this.x *= s;
      this.y *= s;
      this.z *= s;
      return this;
    }
    distanceTo(v) {
      return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z);
    }
    lengthSq() {
      return this.x * this.x + this.y * this.y + this.z * this.z;
    }
    dot(v) {
      return this.x * v.x + this.y * v.y + this.z * v.z;
    }
  }

  const makeRotation = () => {
    const r = { x: 0, y: 0, z: 0, order: "XYZ" };
    r.set = (x, y, z) => {
      r.x = x;
      r.y = y;
      r.z = z;
    };
    r.setFromQuaternion = () => r;
    return r;
  };

  const makeScale = () => {
    const s = { x: 1, y: 1, z: 1 };
    s.setScalar = (v) => {
      s.x = v;
      s.y = v;
      s.z = v;
    };
    return s;
  };

  class Mesh {
    constructor(geo, mat) {
      this.geometry = geo || new Geo();
      this.material = mat || { dispose() {} };
      this.position = new Vector3();
      this.rotation = makeRotation();
      this.scale = makeScale();
      this.quaternion = {
        x: 0,
        y: 0,
        z: 0,
        w: 1,
        copy() {},
        clone() {
          return { x: 0, y: 0, z: 0, w: 1 };
        },
      };
      this.userData = {};
      this.children = [];
      this.visible = true;
      this.castShadow = false;
      this.receiveShadow = false;
      this.renderOrder = 0;
    }
    add(c) {
      this.children.push(c);
    }
    getWorldPosition(v) {
      v.copy(this.position);
      return v;
    }
    getWorldScale(v) {
      v.x = this.scale.x;
      v.y = this.scale.y;
      v.z = this.scale.z;
      return v;
    }
    raycast() {}
  }

  class Geo {
    constructor() {
      this.userData = {};
    }
    computeVertexNormals() {}
    translate() {}
    dispose() {}
    setAttribute() {}
    setIndex() {}
    setFromPoints() {
      return this;
    }
  }

  class Scene {
    constructor() {
      this.children = [];
      this.environment = null;
      this.background = null;
    }
    add(o) {
      this.children.push(o);
    }
    remove(o) {
      this.children = this.children.filter((c) => c !== o);
    }
  }

  const noDispose = () => ({ dispose() {} });

  return {
    Scene,
    Mesh,
    Vector3,
    Vector2: class {
      constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
      }
      set(x, y) {
        this.x = x;
        this.y = y;
        return this;
      }
    },
    Euler: class {
      constructor(x = 0, y = 0, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
      }
      setFromQuaternion() {
        return this;
      }
    },
    Color: class {
      clone() {
        return this;
      }
    },
    BoxGeometry: Geo,
    SphereGeometry: Geo,
    CylinderGeometry: Geo,
    TorusGeometry: Geo,
    PlaneGeometry: Geo,
    ShapeGeometry: Geo,
    EdgesGeometry: Geo,
    BufferGeometry: Geo,
    ExtrudeGeometry: class extends Geo {
      constructor(s, o) {
        super();
        this.shape = s;
        this.opts = o;
      }
    },
    LineSegments: class {
      constructor(g, m) {
        this.geometry = g || new Geo();
        this.material = m || noDispose();
        this.userData = {};
        this.children = [];
        this.visible = true;
      }
      add() {}
    },
    Line: class {
      constructor(g, m) {
        this.geometry = g || new Geo();
        this.material = m || noDispose();
        this.userData = {};
        this.children = [];
        this.renderOrder = 0;
      }
      add() {}
    },
    Points: class extends Mesh {},
    Sprite: class extends Mesh {},
    Group: class {
      constructor() {
        this.children = [];
        this.userData = {};
        this.visible = true;
      }
      add(c) {
        this.children.push(c);
      }
      remove(o) {
        this.children = this.children.filter((c) => c !== o);
      }
      traverse(fn) {
        fn(this);
        this.children.forEach((c) => (c.traverse ? c.traverse(fn) : fn(c)));
      }
    },
    Shape: class {
      constructor(pts) {
        this.holes = [];
        this.points = pts || [];
      }
    },
    Path: class {
      constructor(pts) {
        this.points = pts || [];
      }
    },
    BufferAttribute: class {
      constructor(arr, s) {
        this.array = arr;
        this.itemSize = s;
      }
    },
    Float32BufferAttribute: class {},
    MeshBasicMaterial: class {
      constructor() {
        this.dispose = () => {};
      }
    },
    MeshStandardMaterial: class {
      constructor() {
        this.dispose = () => {};
      }
    },
    MeshPhysicalMaterial: class {
      constructor() {
        this.dispose = () => {};
      }
    },
    LineBasicMaterial: class {
      constructor() {
        this.dispose = () => {};
      }
    },
    SpriteMaterial: class {
      constructor() {
        this.dispose = () => {};
        this.map = null;
      }
    },
    PointsMaterial: class {
      constructor() {
        this.dispose = () => {};
      }
    },
    CanvasTexture: class {
      constructor() {
        this.needsUpdate = false;
      }
    },
    Sphere: class {
      constructor(c, r) {
        this.center = c;
        this.radius = r;
      }
    },
    Ray: class {
      intersectSphere() {
        return null;
      }
    },
    DoubleSide: 2,
    NoToneMapping: 0,
    ACESFilmicToneMapping: 4,
    Float32Array,
  };
});

vi.mock("three/addons/lines/Line2.js", () => ({
  Line2: class {
    computeLineDistances() {}
  },
}));
vi.mock("three/addons/lines/LineMaterial.js", () => ({
  LineMaterial: class {},
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
vi.mock("../../store", () => ({ useStore: () => null }));

// ── Helpers ───────────────────────────────────────────────────────────────────

const pos = (x, y, z) => ({ x, y, z });
const rot = (x, y, z) => ({ x, y, z });
const scl = (s) => ({ x: s, y: s, z: s });

// Builds a minimal store-like scene scaffold for buildSceneObjects.
function makeScene() {
  const scene = {
    children: [],
    add(o) {
      this.children.push(o);
    },
    remove(o) {
      this.children = this.children.filter((c) => c !== o);
    },
  };
  const objectsRef = { current: {} };
  const materialsRef = { current: {} };
  return { scene, objectsRef, materialsRef };
}

// Calls buildSceneObjects and returns the THREE.Mesh placed for `itemId`.
function buildAndGetMesh(items, itemId, curveSegments = 32) {
  const { scene, objectsRef, materialsRef } = makeScene();
  buildSceneObjects(items, scene, objectsRef, materialsRef, curveSegments);
  return objectsRef.current[itemId];
}

// A rectangle profile polygon (4 corners, CCW). centroid = ((x1+x2)/2, (y1+y2)/2).
const rectPoly = (x1, y1, x2, y2) => [
  { x: x1, y: y1 },
  { x: x2, y: y1 },
  { x: x2, y: y2 },
  { x: x1, y: y2 },
];

// Extrude item with a pre-computed polygon2D so no sketch re-matching is needed
// (sketchId left undefined keeps the profile.polygon2D path in buildSceneObjects).
const mkExtrude = (
  id,
  polygon2D,
  depth,
  itemPos,
  itemRot = { x: 0, y: 0, z: 0 },
) => ({
  id,
  type: "extrude",
  depth,
  position: itemPos,
  rotation: itemRot,
  scale: { x: 1, y: 1, z: 1 },
  profile: { polygon2D, holes: [] }, // sketchId intentionally absent → uses polygon2D directly
});

// ── 1. Transform store logic ──────────────────────────────────────────────────
// The store's setItemTransform and setItemsTransform operations are thin wrappers
// around the same merge logic used by applyInstruction.  We test the invariant
// they all share rather than importing Zustand directly.

describe("item transform logic", () => {
  // Mirrors applyInstruction({ type:"transform" }) and setItemsTransform.
  function applyTransforms(items, updates) {
    return items.map((item) => {
      const u = updates.find((u) => u.id === item.id);
      if (!u) return item;
      return Object.assign({}, item, {
        position: u.position !== undefined ? u.position : item.position,
        scale: u.scale !== undefined ? u.scale : item.scale,
        rotation: u.rotation !== undefined ? u.rotation : item.rotation,
      });
    });
  }

  const base = [
    { id: 1, position: pos(0, 0, 0), scale: scl(1), rotation: rot(0, 0, 0) },
    { id: 2, position: pos(5, 5, 5), scale: scl(2), rotation: rot(0, 0, 1) },
  ];

  it("updates the target item position", () => {
    const result = applyTransforms(base, [{ id: 1, position: pos(3, 4, 5) }]);
    expect(result[0].position).toEqual(pos(3, 4, 5));
  });

  it("leaves untargeted items unchanged", () => {
    const result = applyTransforms(base, [{ id: 1, position: pos(3, 4, 5) }]);
    expect(result[1].position).toEqual(pos(5, 5, 5));
    expect(result[1].scale).toEqual(scl(2));
    expect(result[1].rotation).toEqual(rot(0, 0, 1));
  });

  it("position-only update leaves rotation and scale unchanged", () => {
    const result = applyTransforms(base, [{ id: 2, position: pos(1, 2, 3) }]);
    expect(result[1].scale).toEqual(scl(2));
    expect(result[1].rotation).toEqual(rot(0, 0, 1));
  });

  it("rotation-only update leaves position and scale unchanged", () => {
    const result = applyTransforms(base, [
      { id: 1, rotation: rot(0, 0, Math.PI / 2) },
    ]);
    expect(result[0].position).toEqual(pos(0, 0, 0));
    expect(result[0].scale).toEqual(scl(1));
    expect(result[0].rotation.z).toBeCloseTo(Math.PI / 2);
  });

  it("scale-only update leaves position and rotation unchanged", () => {
    const result = applyTransforms(base, [{ id: 1, scale: scl(3) }]);
    expect(result[0].position).toEqual(pos(0, 0, 0));
    expect(result[0].rotation).toEqual(rot(0, 0, 0));
    expect(result[0].scale).toEqual(scl(3));
  });

  it("batch update applies each item independently", () => {
    const result = applyTransforms(base, [
      { id: 1, position: pos(10, 0, 0) },
      { id: 2, position: pos(0, 20, 0) },
    ]);
    expect(result[0].position).toEqual(pos(10, 0, 0));
    expect(result[1].position).toEqual(pos(0, 20, 0));
  });

  it("updating one item twice keeps only the last applied transform", () => {
    const a = applyTransforms(base, [{ id: 1, position: pos(1, 0, 0) }]);
    const b = applyTransforms(a, [{ id: 1, position: pos(9, 9, 9) }]);
    expect(b[0].position).toEqual(pos(9, 9, 9));
  });
});

// ── 2. Extrude world-position formula ─────────────────────────────────────────
// buildSceneObjects computes:
//   extrudeLocalOffset = (polyCentroid(poly).x, polyCentroid(poly).y, depth/2)
//   extrudeLocalOffset.applyEuler(mesh.rotation)
//   mesh.position = item.position + extrudeLocalOffset
//
// For zero rotation the offset is just (cx,cy,depth/2) — these tests verify
// that formula using only the pure polyCentroid helper.

describe("extrude world-position formula (no rotation)", () => {
  it("centroid of an axis-aligned rectangle is its geometric centre", () => {
    const poly = rectPoly(0, 0, 4, 4);
    const c = polyCentroid(poly);
    expect(c.x).toBeCloseTo(2);
    expect(c.y).toBeCloseTo(2);
  });

  it("centroid of an off-origin rectangle is correct", () => {
    const poly = rectPoly(2, 3, 6, 7);
    const c = polyCentroid(poly);
    expect(c.x).toBeCloseTo(4);
    expect(c.y).toBeCloseTo(5);
  });

  it("item.position (0,0,0): mesh sits at (centroid.x, centroid.y, depth/2)", () => {
    const poly = rectPoly(0, 0, 4, 4); // centroid (2,2)
    const depth = 2;
    const itemPos = pos(0, 0, 0);
    const c = polyCentroid(poly);
    expect(c.x + itemPos.x).toBeCloseTo(2);
    expect(c.y + itemPos.y).toBeCloseTo(2);
    expect(depth / 2 + itemPos.z).toBeCloseTo(1);
  });

  it("translating item.position shifts the mesh by the same amount", () => {
    const poly = rectPoly(0, 0, 4, 4); // centroid (2,2)
    const depth = 2;
    const c = polyCentroid(poly);
    const p1 = pos(0, 0, 0);
    const p2 = pos(5, 3, 1);
    const dx = p2.x - p1.x,
      dy = p2.y - p1.y,
      dz = p2.z - p1.z;
    // mesh positions
    const mx1 = p1.x + c.x,
      my1 = p1.y + c.y,
      mz1 = p1.z + depth / 2;
    const mx2 = p2.x + c.x,
      my2 = p2.y + c.y,
      mz2 = p2.z + depth / 2;
    expect(mx2 - mx1).toBeCloseTo(dx);
    expect(my2 - my1).toBeCloseTo(dy);
    expect(mz2 - mz1).toBeCloseTo(dz);
  });

  it("depth/2 offset is proportional to depth", () => {
    const poly = rectPoly(0, 0, 2, 2);
    for (const depth of [0.5, 1, 2, 5, 10]) {
      const c = polyCentroid(poly);
      const meshZ = 0 + depth / 2; // item.position.z = 0
      expect(meshZ).toBeCloseTo(depth / 2);
    }
  });

  it("circle extrude: centroid equals the circle centre", () => {
    const loops = findClosedLoops([{ type: "circle", cx: 3, cy: 5, r: 1.5 }]);
    expect(loops.length).toBe(1);
    const c = polyCentroid(loops[0]);
    expect(c.x).toBeCloseTo(3, 1);
    expect(c.y).toBeCloseTo(5, 1);
  });

  it("moving item.position does not change the solid size, only its world location", () => {
    const poly = rectPoly(0, 0, 4, 4);
    const depth = 2;
    const c = polyCentroid(poly);
    // The solid always spans depth in Z regardless of item.position.z
    // Solid Z range: [mesh.z - depth/2, mesh.z + depth/2]
    //             = [item.z + depth/2 - depth/2, item.z + depth/2 + depth/2]
    //             = [item.z, item.z + depth]
    for (const pz of [0, 3, -2]) {
      const meshZ = pz + depth / 2;
      const solidBottom = meshZ - depth / 2;
      const solidTop = meshZ + depth / 2;
      expect(solidBottom).toBeCloseTo(pz);
      expect(solidTop).toBeCloseTo(pz + depth);
    }
  });
});

// ── 3. buildSceneObjects mesh positioning ─────────────────────────────────────

describe("buildSceneObjects: regular item positioning", () => {
  it("cube placed at item.position exactly", () => {
    const mesh = buildAndGetMesh(
      [
        {
          id: 1,
          type: "cube",
          position: pos(3, 4, 5),
          scale: scl(1),
          rotation: rot(0, 0, 0),
        },
      ],
      1,
    );
    expect(mesh.position.x).toBeCloseTo(3);
    expect(mesh.position.y).toBeCloseTo(4);
    expect(mesh.position.z).toBeCloseTo(5);
  });

  it("cube at origin stays at origin", () => {
    const mesh = buildAndGetMesh(
      [
        {
          id: 1,
          type: "cube",
          position: pos(0, 0, 0),
          scale: scl(1),
          rotation: rot(0, 0, 0),
        },
      ],
      1,
    );
    expect(mesh.position.x).toBeCloseTo(0);
    expect(mesh.position.y).toBeCloseTo(0);
    expect(mesh.position.z).toBeCloseTo(0);
  });

  it("moving a cube changes mesh.position by the same delta", () => {
    const build = (p) =>
      buildAndGetMesh(
        [
          {
            id: 1,
            type: "cube",
            position: p,
            scale: scl(1),
            rotation: rot(0, 0, 0),
          },
        ],
        1,
      );
    const m1 = build(pos(0, 0, 0));
    const m2 = build(pos(3, 2, 1));
    expect(m2.position.x - m1.position.x).toBeCloseTo(3);
    expect(m2.position.y - m1.position.y).toBeCloseTo(2);
    expect(m2.position.z - m1.position.z).toBeCloseTo(1);
  });

  it("scale is applied to the mesh", () => {
    const mesh = buildAndGetMesh(
      [
        {
          id: 1,
          type: "cube",
          position: pos(0, 2, 0),
          scale: scl(2),
          rotation: rot(0, 0, 0),
        },
      ],
      1,
    );
    expect(mesh.scale.x).toBeCloseTo(2);
  });

  it("multiple items each get their own mesh at the correct position", () => {
    const items = [
      {
        id: 1,
        type: "cube",
        position: pos(1, 0, 0),
        scale: scl(1),
        rotation: rot(0, 0, 0),
      },
      {
        id: 2,
        type: "cube",
        position: pos(0, 5, 0),
        scale: scl(1),
        rotation: rot(0, 0, 0),
      },
    ];
    const { scene, objectsRef, materialsRef } = makeScene();
    buildSceneObjects(items, scene, objectsRef, materialsRef);
    expect(objectsRef.current[1].position.x).toBeCloseTo(1);
    expect(objectsRef.current[2].position.y).toBeCloseTo(5);
  });
});

describe("buildSceneObjects: extrude positioning (no rotation)", () => {
  it("extrude at (0,0,0): mesh.position = (centroid.x, centroid.y, depth/2)", () => {
    const poly = rectPoly(0, 0, 4, 4); // centroid (2,2)
    const depth = 2;
    const mesh = buildAndGetMesh([mkExtrude(1, poly, depth, pos(0, 0, 0))], 1);
    expect(mesh.position.x).toBeCloseTo(2);
    expect(mesh.position.y).toBeCloseTo(2);
    expect(mesh.position.z).toBeCloseTo(1); // depth/2 = 1
  });

  it("extrude at item.position (P): mesh.position = (P.x+cx, P.y+cy, P.z+d/2)", () => {
    const poly = rectPoly(0, 0, 4, 4); // centroid (2,2)
    const depth = 2;
    const p = pos(5, 3, 1);
    const mesh = buildAndGetMesh([mkExtrude(1, poly, depth, p)], 1);
    expect(mesh.position.x).toBeCloseTo(5 + 2);
    expect(mesh.position.y).toBeCloseTo(3 + 2);
    expect(mesh.position.z).toBeCloseTo(1 + 1);
  });

  it("moving item.position shifts mesh.position by exactly the same delta", () => {
    const poly = rectPoly(0, 0, 4, 4);
    const depth = 2;
    const m1 = buildAndGetMesh([mkExtrude(1, poly, depth, pos(0, 0, 0))], 1);
    const m2 = buildAndGetMesh([mkExtrude(1, poly, depth, pos(3, 2, 1))], 1);
    expect(m2.position.x - m1.position.x).toBeCloseTo(3);
    expect(m2.position.y - m1.position.y).toBeCloseTo(2);
    expect(m2.position.z - m1.position.z).toBeCloseTo(1);
  });

  it("off-centre polygon: centroid offset correctly shifts world position", () => {
    const poly = rectPoly(2, 3, 6, 7); // centroid (4,5)
    const depth = 4;
    const mesh = buildAndGetMesh([mkExtrude(1, poly, depth, pos(0, 0, 0))], 1);
    expect(mesh.position.x).toBeCloseTo(4);
    expect(mesh.position.y).toBeCloseTo(5);
    expect(mesh.position.z).toBeCloseTo(2); // depth/2 = 2
  });

  it("depth change only affects the Z component of mesh.position", () => {
    const poly = rectPoly(0, 0, 4, 4); // centroid (2,2)
    const m1 = buildAndGetMesh([mkExtrude(1, poly, 2, pos(0, 0, 0))], 1);
    const m2 = buildAndGetMesh([mkExtrude(1, poly, 6, pos(0, 0, 0))], 1);
    expect(m1.position.x).toBeCloseTo(m2.position.x);
    expect(m1.position.y).toBeCloseTo(m2.position.y);
    expect(m2.position.z).toBeCloseTo(3); // depth/2 = 3
  });

  it("solid base face is at item.position.z, top face is at item.position.z + depth", () => {
    const poly = rectPoly(0, 0, 4, 4);
    const depth = 3;
    const pz = 2;
    const mesh = buildAndGetMesh([mkExtrude(1, poly, depth, pos(0, 0, pz))], 1);
    // Geometry is translated -depth/2 so local Z ∈ [-1.5, 1.5].
    // mesh.position.z = pz + depth/2 = 3.5
    // World Z of bottom face = 3.5 - 1.5 = 2 = pz  ✓
    // World Z of top face    = 3.5 + 1.5 = 5 = pz+depth ✓
    expect(mesh.position.z - depth / 2).toBeCloseTo(pz);
    expect(mesh.position.z + depth / 2).toBeCloseTo(pz + depth);
  });

  it("circle extrude: mesh.position.xy ≈ circle centre", () => {
    const loops = findClosedLoops([{ type: "circle", cx: 3, cy: 5, r: 1.5 }]);
    const poly = loops[0];
    const depth = 1;
    const mesh = buildAndGetMesh([mkExtrude(1, poly, depth, pos(0, 0, 0))], 1);
    expect(mesh.position.x).toBeCloseTo(3, 1);
    expect(mesh.position.y).toBeCloseTo(5, 1);
    expect(mesh.position.z).toBeCloseTo(0.5);
  });
});

describe("buildSceneObjects: extrude positioning with rotation", () => {
  // When an extrude item has a non-zero rotation the local-space centroid offset
  // is rotated into world space before being added to item.position.  These tests
  // verify that the rotation is applied correctly.

  it("90° Z rotation: XY offset rotates (cx,cy) → (-cy, cx)", () => {
    const poly = rectPoly(0, 0, 4, 4); // centroid (2,2)
    const depth = 2;
    const mesh = buildAndGetMesh(
      [mkExtrude(1, poly, depth, pos(0, 0, 0), rot(0, 0, Math.PI / 2))],
      1,
    );
    // Raw offset = (2,2,1). After Rz(90°): x'=-y=-2, y'=x=2, z'=z=1
    expect(mesh.position.x).toBeCloseTo(-2);
    expect(mesh.position.y).toBeCloseTo(2);
    expect(mesh.position.z).toBeCloseTo(1);
  });

  it("90° Z rotation with non-zero item.position: result = rotatedOffset + item.position", () => {
    const poly = rectPoly(0, 0, 4, 4); // centroid (2,2)
    const depth = 2;
    const p = pos(10, 5, 0);
    const mesh = buildAndGetMesh(
      [mkExtrude(1, poly, depth, p, rot(0, 0, Math.PI / 2))],
      1,
    );
    // Rotated offset: (-2, 2, 1)
    expect(mesh.position.x).toBeCloseTo(10 + -2);
    expect(mesh.position.y).toBeCloseTo(5 + 2);
    expect(mesh.position.z).toBeCloseTo(0 + 1);
  });

  it("180° Z rotation: offset (cx,cy) → (-cx,-cy)", () => {
    const poly = rectPoly(0, 0, 4, 4); // centroid (2,2)
    const depth = 2;
    const mesh = buildAndGetMesh(
      [mkExtrude(1, poly, depth, pos(0, 0, 0), rot(0, 0, Math.PI))],
      1,
    );
    expect(mesh.position.x).toBeCloseTo(-2, 5);
    expect(mesh.position.y).toBeCloseTo(-2, 5);
    expect(mesh.position.z).toBeCloseTo(1);
  });

  it("zero rotation is identical to no-rotation baseline", () => {
    const poly = rectPoly(0, 0, 4, 4);
    const depth = 2;
    const mBase = buildAndGetMesh([mkExtrude(1, poly, depth, pos(3, 4, 0))], 1);
    const mZero = buildAndGetMesh(
      [mkExtrude(1, poly, depth, pos(3, 4, 0), rot(0, 0, 0))],
      1,
    );
    expect(mBase.position.x).toBeCloseTo(mZero.position.x);
    expect(mBase.position.y).toBeCloseTo(mZero.position.y);
    expect(mBase.position.z).toBeCloseTo(mZero.position.z);
  });
});

// ── 4. Drag computation math ───────────────────────────────────────────────────
// The drag handlers in cameraControls.js apply these pure formulae to update
// mesh state before committing to the store.  We test the math in isolation.

describe("drag computation math", () => {
  // Axis drag: newPos = startPos + dir * projected * worldPerNDC
  function axisDrag(startPos, dir, projected, worldPerNDC) {
    return {
      x: startPos.x + dir.x * projected * worldPerNDC,
      y: startPos.y + dir.y * projected * worldPerNDC,
      z: startPos.z + dir.z * projected * worldPerNDC,
    };
  }

  it("X-axis drag: only X changes", () => {
    const p = axisDrag(pos(0, 0, 0), { x: 1, y: 0, z: 0 }, 0.5, 10);
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(0);
  });

  it("Y-axis drag: only Y changes", () => {
    const p = axisDrag(pos(1, 2, 3), { x: 0, y: 1, z: 0 }, 0.3, 8);
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(2 + 0.3 * 8);
    expect(p.z).toBeCloseTo(3);
  });

  it("Z-axis drag: only Z changes", () => {
    const p = axisDrag(pos(5, 5, 5), { x: 0, y: 0, z: 1 }, -0.2, 5);
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(5);
    expect(p.z).toBeCloseTo(5 - 1);
  });

  it("dragging back to startPos gives the original position", () => {
    const start = pos(3, 4, 5);
    const p = axisDrag(start, { x: 1, y: 0, z: 0 }, 0, 10);
    expect(p.x).toBeCloseTo(start.x);
    expect(p.y).toBeCloseTo(start.y);
    expect(p.z).toBeCloseTo(start.z);
  });

  it("scale drag: newScale = startScale * 2^(-dyPx / 200)", () => {
    const scaleDrag = (startScale, dyPx) =>
      startScale * Math.pow(2, -dyPx / 200);
    expect(scaleDrag(1, 0)).toBeCloseTo(1);
    expect(scaleDrag(1, 200)).toBeCloseTo(0.5); // drag down 200px → half scale
    expect(scaleDrag(1, -200)).toBeCloseTo(2); // drag up 200px → double scale
    expect(scaleDrag(2, 200)).toBeCloseTo(1); // from 2 → 1
  });

  it("rotation drag: delta = -dxPx * 0.01", () => {
    const rotDrag = (startAngle, dxPx) => startAngle + -dxPx * 0.01;
    expect(rotDrag(0, 100)).toBeCloseTo(-1);
    expect(rotDrag(0, -100)).toBeCloseTo(1);
    expect(rotDrag(Math.PI, 0)).toBeCloseTo(Math.PI);
  });

  it("position committed to store equals final mesh position after axis drag", () => {
    // Simulate: startPos=(1,2,3), drag X by 50px at worldPerNDC=0.04, ndcWidth=2
    const startPos = pos(1, 2, 3);
    const dxPx = 50;
    const ndcWidth = 2;
    const rectWidth = 800;
    const worldPerNDC = 4; // 4 world-units per NDC unit (hypothetical)
    const axisDirX = { x: 1, y: 0, z: 0 }; // axisDirScreen projected onto X
    const dxNDC = (dxPx / rectWidth) * ndcWidth;
    const projected = dxNDC * axisDirX.x; // projection onto screen-space axis
    const finalPos = axisDrag(
      startPos,
      { x: 1, y: 0, z: 0 },
      projected,
      worldPerNDC,
    );
    // The value stored to the store is what the mesh reports after the drag.
    expect(finalPos.x).toBeCloseTo(1 + (50 / 800) * 2 * worldPerNDC);
    expect(finalPos.y).toBeCloseTo(2);
    expect(finalPos.z).toBeCloseTo(3);
  });
});

// ── 5. Drag-commit round-trip for extrude objects ─────────────────────────────
// When a drag ends, cameraControls stores mesh.position as item.position.
// For extrudes, mesh.position = item.position + rotated_centroid_offset, so
// the raw mesh.position must NOT be stored — the offset must be subtracted first.
// Otherwise every drag bakes the offset into item.position, and the next
// buildSceneObjects call adds it again, making the object drift.
//
// These tests simulate the full round-trip:
//   buildSceneObjects → capture mesh.position → simulate drag commit →
//   rebuild with new item.position → verify mesh lands at expected world position.

describe("extrude drag-commit round-trip (no offset drift)", () => {
  // Mirrors the fixed cameraControls commit logic: subtracts the rotated offset
  // from mesh.position before storing as item.position.
  function commitExtrudePosition(mesh) {
    const elo = mesh.userData.extrudeLocalOffset;
    if (!elo)
      return { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };
    // Rotate the local offset by the current mesh rotation (matches production code).
    const r = mesh.rotation;
    const cx = Math.cos(r.x || 0),
      sx = Math.sin(r.x || 0);
    const cy = Math.cos(r.y || 0),
      sy = Math.sin(r.y || 0);
    const cz = Math.cos(r.z || 0),
      sz = Math.sin(r.z || 0);
    let { x, y, z } = elo;
    const y1 = y * cx - z * sx,
      z1 = y * sx + z * cx;
    const x2 = x * cy + z1 * sy,
      z2 = -x * sy + z1 * cy;
    const wx = x2 * cz - y1 * sz,
      wy = x2 * sz + y1 * cz,
      wz = z2;
    return {
      x: mesh.position.x - wx,
      y: mesh.position.y - wy,
      z: mesh.position.z - wz,
    };
  }

  it("userData.extrudeLocalOffset is set on the mesh by buildSceneObjects", () => {
    const poly = rectPoly(0, 0, 4, 4);
    const mesh = buildAndGetMesh([mkExtrude(1, poly, 2, pos(0, 0, 0))], 1);
    expect(mesh.userData.extrudeLocalOffset).toBeDefined();
    expect(mesh.userData.extrudeLocalOffset.x).toBeCloseTo(2); // centroid.x
    expect(mesh.userData.extrudeLocalOffset.y).toBeCloseTo(2); // centroid.y
    expect(mesh.userData.extrudeLocalOffset.z).toBeCloseTo(1); // depth/2
  });

  it("committing raw mesh.position as item.position would double the offset (regression)", () => {
    // This test documents the old bug: storing mesh.position directly causes drift.
    const poly = rectPoly(0, 0, 4, 4); // centroid (2,2), depth=2, offset=(2,2,1)
    const depth = 2;
    const mesh = buildAndGetMesh([mkExtrude(1, poly, depth, pos(0, 0, 0))], 1);
    // mesh.position = (2,2,1).  If we naively store this as item.position, next
    // rebuild gives mesh.position = (2+2, 2+2, 1+1) = (4,4,2) — wrong.
    const badItemPos = {
      x: mesh.position.x,
      y: mesh.position.y,
      z: mesh.position.z,
    };
    const meshAfterRebuild = buildAndGetMesh(
      [mkExtrude(1, poly, depth, badItemPos)],
      1,
    );
    expect(meshAfterRebuild.position.x).not.toBeCloseTo(2, 0); // drifted from original (2)
  });

  it("subtracting the offset before commit avoids drift on rebuild (the fix)", () => {
    const poly = rectPoly(0, 0, 4, 4);
    const depth = 2;
    const mesh = buildAndGetMesh([mkExtrude(1, poly, depth, pos(0, 0, 0))], 1);
    const originalMeshPos = {
      x: mesh.position.x,
      y: mesh.position.y,
      z: mesh.position.z,
    };
    // Simulate drag: mesh moved by delta (3,1,0)
    mesh.position.x += 3;
    mesh.position.y += 1;
    // Commit using the fixed logic (subtract offset)
    const newItemPos = commitExtrudePosition(mesh);
    // Rebuild with the committed item.position
    const meshAfter = buildAndGetMesh(
      [mkExtrude(1, poly, depth, newItemPos)],
      1,
    );
    expect(meshAfter.position.x).toBeCloseTo(originalMeshPos.x + 3);
    expect(meshAfter.position.y).toBeCloseTo(originalMeshPos.y + 1);
    expect(meshAfter.position.z).toBeCloseTo(originalMeshPos.z);
  });

  it("repeated drags do not accumulate drift", () => {
    const poly = rectPoly(0, 0, 4, 4);
    const depth = 2;
    let itemPos = pos(0, 0, 0);
    let mesh = buildAndGetMesh([mkExtrude(1, poly, depth, itemPos)], 1);
    const startMeshPos = {
      x: mesh.position.x,
      y: mesh.position.y,
      z: mesh.position.z,
    };
    // Simulate 5 successive drags of +1 in X each
    for (let i = 0; i < 5; i++) {
      mesh.position.x += 1;
      itemPos = commitExtrudePosition(mesh);
      mesh = buildAndGetMesh([mkExtrude(1, poly, depth, itemPos)], 1);
    }
    expect(mesh.position.x).toBeCloseTo(startMeshPos.x + 5);
    expect(mesh.position.y).toBeCloseTo(startMeshPos.y);
    expect(mesh.position.z).toBeCloseTo(startMeshPos.z);
  });

  it("drag along X only changes the X component of mesh.position after rebuild", () => {
    const poly = rectPoly(0, 0, 4, 4);
    const depth = 2;
    const mesh = buildAndGetMesh([mkExtrude(1, poly, depth, pos(0, 0, 0))], 1);
    const startY = mesh.position.y,
      startZ = mesh.position.z;
    mesh.position.x += 7;
    const newItemPos = commitExtrudePosition(mesh);
    const meshAfter = buildAndGetMesh(
      [mkExtrude(1, poly, depth, newItemPos)],
      1,
    );
    expect(meshAfter.position.y).toBeCloseTo(startY);
    expect(meshAfter.position.z).toBeCloseTo(startZ);
  });

  it("drag with 90° Z rotation: XY offset is rotated but commit-then-rebuild is stable", () => {
    const poly = rectPoly(0, 0, 4, 4); // centroid (2,2), offset=(2,2,1)
    const depth = 2;
    const r = rot(0, 0, Math.PI / 2);
    const mesh = buildAndGetMesh(
      [mkExtrude(1, poly, depth, pos(0, 0, 0), r)],
      1,
    );
    const startMeshPos = {
      x: mesh.position.x,
      y: mesh.position.y,
      z: mesh.position.z,
    };
    // Drag along world X
    mesh.position.x += 5;
    const newItemPos = commitExtrudePosition(mesh);
    const meshAfter = buildAndGetMesh(
      [mkExtrude(1, poly, depth, newItemPos, r)],
      1,
    );
    expect(meshAfter.position.x).toBeCloseTo(startMeshPos.x + 5);
    expect(meshAfter.position.y).toBeCloseTo(startMeshPos.y);
    expect(meshAfter.position.z).toBeCloseTo(startMeshPos.z);
  });
});
