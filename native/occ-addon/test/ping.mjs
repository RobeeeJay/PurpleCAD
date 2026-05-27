import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const addonPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../build/Release/occ_addon.node",
);
const occ = require(addonPath);

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// ── ping ────────────────────────────────────────────────────────────────
assert(occ.ping() === "pong", "ping()");

// ── makeCubeTessellated (phase-0 smoke test) ────────────────────────────
const cube0 = occ.makeCubeTessellated(0.1);
assert(cube0.triangleCount > 0, "makeCubeTessellated triangleCount");
assert(cube0.positions instanceof Float32Array, "positions is Float32Array");
console.log(`makeCubeTessellated: ${cube0.triangleCount} tris`);

// ── primitives ──────────────────────────────────────────────────────────
assert(occ.shapeCount() === 0, "store empty initially");

const boxId = occ.makeBox(-1, -1, -1, 1, 1, 1);
assert(typeof boxId === "number" && boxId > 0, "makeBox returns id");

const sphereId = occ.makeSphere(1.5);
assert(typeof sphereId === "number", "makeSphere returns id");

const cylId = occ.makeCylinder(-1, 1, 2);
assert(typeof cylId === "number", "makeCylinder returns id");

const torusId = occ.makeTorus(1.0, 0.4);
assert(typeof torusId === "number", "makeTorus returns id");

// Simple square extrude (unit square at origin, depth=2)
const pts = new Float64Array([-1,-1, 1,-1, 1,1, -1,1]);
const extId = occ.makeExtrude(pts, [], 0, 0, 2);
assert(typeof extId === "number", "makeExtrude returns id");

assert(occ.shapeCount() === 5, `store has 5 shapes, got ${occ.shapeCount()}`);
console.log(`primitives: box=${boxId} sphere=${sphereId} cyl=${cylId} torus=${torusId} ext=${extId}`);

// ── tessellate ──────────────────────────────────────────────────────────
const boxTess = occ.tessellate(boxId, 0.1);
assert(boxTess.triangleCount === 12, `box has 12 tris, got ${boxTess.triangleCount}`);

const sphereTess = occ.tessellate(sphereId, 0.5);
assert(sphereTess.triangleCount > 0, "sphere tess ok");

const cylTess = occ.tessellate(cylId, 0.5);
assert(cylTess.triangleCount > 0, "cylinder tess ok");

const torusTess = occ.tessellate(torusId, 0.5);
assert(torusTess.triangleCount > 0, "torus tess ok");

const extTess = occ.tessellate(extId, 0.5);
assert(extTess.triangleCount > 0, "extrude tess ok");

console.log(`tessellate: box=${boxTess.triangleCount} sphere=${sphereTess.triangleCount} cyl=${cylTess.triangleCount} torus=${torusTess.triangleCount} ext=${extTess.triangleCount}`);

// ── transform ────────────────────────────────────────────────────────────
const xfId = occ.transformShape(boxId, 5, 0, 0, 0, 0, 0);
assert(typeof xfId === "number" && xfId !== boxId, "transformShape returns new id");
const xfTess = occ.tessellate(xfId, 0.5);
assert(xfTess.triangleCount === 12, "transformed box still 12 tris");
// Verify the box was actually translated (min X should be ~4)
const minX = Math.min(...Array.from(xfTess.positions).filter((_, i) => i % 3 === 0));
assert(minX > 3.9 && minX < 4.1, `translated box minX=${minX} (expected ~4)`);

const scId = occ.scaleShape(boxId, 2);
assert(typeof scId === "number", "scaleShape returns id");
const scTess = occ.tessellate(scId, 0.5);
assert(scTess.triangleCount === 12, "scaled box still 12 tris");
console.log(`transform: xf minX=${minX.toFixed(3)} scale ok`);

// ── boolean ops ─────────────────────────────────────────────────────────
const sphereId2 = occ.makeSphere(1.5);
const unionId = occ.booleanOp([boxId, sphereId2], "union");
assert(typeof unionId === "number", "booleanOp union returns id");
const unionTess = occ.tessellate(unionId, 0.5);
assert(unionTess.triangleCount > 0, "union tess ok");

// Cut a small sphere out of the box
const cutSphere = occ.makeSphere(0.5);
const cutId = occ.booleanOp([boxId, cutSphere], "difference");
assert(typeof cutId === "number", "booleanOp difference returns id");
const cutTess = occ.tessellate(cutId, 0.3);
assert(cutTess.triangleCount > 0, "cut tess ok");
console.log(`booleans: union=${unionTess.triangleCount} cut=${cutTess.triangleCount} tris`);

// ── chamfer ──────────────────────────────────────────────────────────────
// Get an edge from the box tessellation to identify an edge to chamfer.
// Instead, use face selection: the top face has normal (0,1,0).
const chamferId = occ.chamferShape(
  boxId,
  { faces: [{ nx: 0, ny: 1, nz: 0 }] },
  0.1,
  null
);
assert(typeof chamferId === "number", "chamferShape returns id");
const chamferTess = occ.tessellate(chamferId, 0.3);
assert(chamferTess.triangleCount > 12, `chamfered box has more tris than plain (${chamferTess.triangleCount})`);
console.log(`chamfer: ${chamferTess.triangleCount} tris`);

// ── fillet ───────────────────────────────────────────────────────────────
const filletId = occ.filletShape(
  boxId,
  { faces: [{ nx: 0, ny: 1, nz: 0 }] },
  0.1
);
assert(typeof filletId === "number", "filletShape returns id");
const filletTess = occ.tessellate(filletId, 0.3);
assert(filletTess.triangleCount > 12, `filleted box has more tris (${filletTess.triangleCount})`);
console.log(`fillet: ${filletTess.triangleCount} tris`);

// ── releaseShape / shapeCount ─────────────────────────────────────────────
const before = occ.shapeCount();
occ.releaseShape(xfId);
occ.releaseShape(scId);
assert(occ.shapeCount() === before - 2, "releaseShape decrements count");
occ.clearAll();
assert(occ.shapeCount() === 0, "clearAll empties store");
console.log("store management ok");

console.log("\nall assertions passed");
