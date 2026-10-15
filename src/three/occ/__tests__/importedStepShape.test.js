// A STEP file carries exact surfaces, and an import used to throw them away:
// importStep tessellated the shape and released it, so the body was a mesh and
// every op afterwards sewed it back into thousands of flat faces.  The import
// now keeps the shape, in the body's own frame, as its recipe.
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "module";
import { ensureOcc } from "../init.js";
import { ops } from "../../occOps.js";
import { finalizeImportedMesh } from "../../importGeometry.js";
import { regionsWithShapes } from "../../sceneObjects/closedLoops.js";
import { regenerateItemsForResolution } from "../../regenerateItems.js";

const bridge = createRequire(import.meta.url)(
  "../../../../electron/occ-bridge.cjs",
);

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const O = { x: 0, y: 0, z: 0 };
const S = { x: 1, y: 1, z: 1 };
const faceCounts = (step) => ({
  faces: (step.match(/ADVANCED_FACE\(/g) || []).length,
  cylinders: (step.match(/CYLINDRICAL_SURFACE\(/g) || []).length,
});
const bbox = (P) => {
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], P[i + k]);
      hi[k] = Math.max(hi[k], P[i + k]);
    }
  return [...lo, ...hi];
};

// A 40 x 40 x 10 mm plate with a 10 mm-radius bore, off-centre so a frame
// error can't hide behind symmetry, built exact and written as STEP.
async function plateStep() {
  const shapes = [
    { type: "rect", x1: -2, y1: -2, x2: 2, y2: 2 },
    { type: "circle", cx: 0.6, cy: -0.4, r: 1 },
  ];
  const [g] = regionsWithShapes(shapes, 32, 0.05).filter((r) => r.holes.length);
  const sketch = { id: 1, type: "sketch", shapes, position: O, rotation: O };
  const plate = {
    id: 2,
    type: "extrude",
    position: { x: 3, y: 0.5, z: -1 },
    rotation: { x: -Math.PI / 2, y: 0, z: 0 },
    scale: S,
    depth: 1,
    profile: {
      sketchId: 1,
      polygon2D: g.polygon,
      holes: g.holes,
      loopShapes: g.loopShapes,
      curves2D: g.curves,
    },
  };
  return ops.exportSTEP({
    items: [plate],
    allItems: [sketch, plate],
    precision: 0.05,
  });
}

// The body the toolbar's import makes from a STEP file (DocumentSection.jsx).
async function importAsToolbarDoes(impl, stepText, printPrecision = 0.05) {
  const res = await impl.importStep({ stepText, printPrecision });
  const { geometryData } = finalizeImportedMesh(res.positions, res.indices);
  return {
    id: 7,
    type: "csg",
    position: O,
    rotation: O,
    scale: S,
    geometryData: { ...geometryData, edges: res.edges },
    regenerator: {
      kind: "importedShape",
      brep: res.brep,
      regeneratedAt: printPrecision,
    },
  };
}

describe("an imported STEP body", () => {
  it("keeps its exact surfaces as its recipe, in both OCC implementations", async () => {
    const step = await plateStep();
    for (const impl of [ops, bridge]) {
      const body = await importAsToolbarDoes(impl, step);
      expect(typeof body.regenerator.brep).toBe("string");
      // Rebuilt from the recipe (no mesh to export), it is the exact plate:
      // four sides, top, bottom and one cylindrical bore.
      const { geometryData, ...recipe } = body;
      const rebuilt = faceCounts(
        await impl.exportSTEP({
          items: [recipe],
          allItems: [recipe],
          precision: 0.05,
        }),
      );
      expect(rebuilt).toEqual({ faces: 7, cylinders: 1 });
    }
  }, 60000);

  it("is rebuilt exactly where its mesh is drawn, in both OCC implementations", async () => {
    // The parity invariant: the OCC rebuild's bounding box is the mesh's.
    const step = await plateStep();
    for (const impl of [ops, bridge]) {
      const body = await importAsToolbarDoes(impl, step);
      const rebuilt = await impl.tessellateItem({
        source: body,
        allItems: [],
        printPrecision: 0.05,
      });
      const a = bbox(body.geometryData.positions);
      const b = bbox(rebuilt.geometryData.positions);
      for (let k = 0; k < 6; k++)
        expect(
          b[k],
          `bbox component ${k}: mesh ${a[k]}, rebuild ${b[k]}`,
        ).toBeCloseTo(a[k], 5);
    }
  }, 60000);

  it("takes a chamfer round its bore's rim as one circular edge", async () => {
    const body = await importAsToolbarDoes(ops, await plateStep());
    // The bore's rim on the top face, picked as one segment of the drawn mesh:
    // two mesh vertices on the rim circle at the top.
    const P = body.geometryData.positions;
    const yTop = bbox(P)[4];
    const rim = [];
    for (let i = 0; i < P.length; i += 3) {
      if (Math.abs(P[i + 1] - yTop) > 1e-5) continue;
      rim.push([P[i], P[i + 1], P[i + 2]]);
    }
    // The bore's rim points are the ones nearest the bore axis.
    const cx = rim.reduce((s, p) => s + p[0], 0) / rim.length;
    const cz = rim.reduce((s, p) => s + p[2], 0) / rim.length;
    const near = rim
      .map((p) => ({ p, d: Math.hypot(p[0] - cx, p[2] - cz) }))
      .sort((u, v) => u.d - v.d);
    const [a, b] = [near[0].p, near[1].p];
    const res = await ops.chamferOrFilletItem({
      source: body,
      subGeo: {
        edges: [{ ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2] }],
        faces: [],
      },
      amount: 0.05,
      segments: 1,
      allItems: [body],
      printPrecision: 0.05,
    });
    expect(res.resolvedSubGeo.edges.length).toBe(1);
  }, 60000);

  it("draws finer at a finer Resolution", async () => {
    const body = await importAsToolbarDoes(ops, await plateStep(), 0.05);
    const tris = async (precision) => {
      const [out] = await regenerateItemsForResolution(
        [
          {
            ...body,
            regenerator: { ...body.regenerator, regeneratedAt: null },
          },
        ],
        precision,
      );
      return out.geometryData.indices.length / 3;
    };
    const coarse = await tris(0.05);
    const fine = await tris(0.01);
    expect(
      fine,
      `${coarse} triangles at 0.05 mm, ${fine} at 0.01 mm`,
    ).toBeGreaterThan(coarse);
  }, 60000);
});
