// OpenCascade.js primitive factories.
//
// Each returns a TopoDS_Shape positioned to match the original three.js
// primitive sizes/orientations:
//   cube     : 2x2x2 box centred at origin
//   sphere   : radius 1.5 at origin
//   cylinder : radius 1, height 2, axis = Y, centred at origin (Y-up like
//              three.js CylinderGeometry, not OCC's default Z-up)
//   torus    : major radius 1.0, minor radius 0.4, axis = Y, centred at
//              origin (matches three.js TorusGeometry which has its hole
//              facing +Z — we apply the same orientation here)

import { getOcc } from "./init.js";
import { polyCentroid } from "../sceneObjects.js";
import { resolveItemDepth } from "../geometryParams.js";

// Shoelace signed area: positive when the polygon is wound CCW (when
// viewed from +Z), negative when CW.  sceneObjects.polyArea returns the
// absolute value, which is no use for picking a winding direction here.
function signedPolyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

// Build a gp_Ax2 (right-handed orthonormal frame) at a given origin and
// "up" direction.  OCC primitives default to Z-up; we want Y-up.
function ax2YUp(origin = { x: 0, y: 0, z: 0 }) {
  const oc = getOcc();
  const o = new oc.gp_Pnt_3(origin.x, origin.y, origin.z);
  const up = new oc.gp_Dir_4(0, 1, 0); // +Y as the cylinder/torus axis
  const ax = new oc.gp_Ax2_3(o, up);
  return ax;
}

export function makeCube() {
  const oc = getOcc();
  // BRepPrimAPI_MakeBox_3(P1, P2) — corner-to-corner constructor builds
  // a box spanning the two points.  (-1,-1,-1) to (1,1,1) = 2x2x2
  // centred at origin, matching THREE.BoxGeometry(2, 2, 2).
  const p1 = new oc.gp_Pnt_3(-1, -1, -1);
  const p2 = new oc.gp_Pnt_3(1, 1, 1);
  const mk = new oc.BRepPrimAPI_MakeBox_3(p1, p2);
  return mk.Shape();
}

export function makeSphere() {
  const oc = getOcc();
  // BRepPrimAPI_MakeSphere(radius) — origin at (0,0,0) by default.
  const mk = new oc.BRepPrimAPI_MakeSphere_1(1.5);
  return mk.Shape();
}

export function makeCylinder() {
  const oc = getOcc();
  // Axis along +Y to match three.js CylinderGeometry.  OCC's
  // MakeCylinder(ax2, radius, height) builds from ax2.origin along
  // ax2.direction with given height; we want it centred, so shift the
  // origin down by half-height.
  const origin = new oc.gp_Pnt_3(0, -1, 0);
  const up = new oc.gp_Dir_4(0, 1, 0);
  const ax = new oc.gp_Ax2_3(origin, up);
  const mk = new oc.BRepPrimAPI_MakeCylinder_3(ax, 1, 2);
  return mk.Shape();
}

export function makeTorus() {
  const oc = getOcc();
  // Axis along +Y to match the rendered torus.  The visible torus shader
  // (objectMaterials.js) uses the mesh's local +Y as the torus normal,
  // and the highlight/wireframe overlays rotate the raw THREE.TorusGeometry
  // by R_x(-π/2) to align with that.  Building the OCC torus with the
  // default Z-axis means booleans involving a torus operate on a shape
  // that's rotated 90° from where the user sees it — the cut comes out
  // visibly wrong.  Y-axis here keeps OCC and the shader in sync.
  const ax = ax2YUp({ x: 0, y: 0, z: 0 });
  const mk = new oc.BRepPrimAPI_MakeTorus_5(ax, 1.0, 0.4);
  return mk.Shape();
}

// Build a closed wire from a 2D polygon (z=0 plane) with a SPECIFIC
// signed-area sign: pass `wantCcw=true` for outer boundaries (positive
// signed area), `wantCcw=false` for holes (negative signed area, i.e.
// clockwise when viewed from +Z).
//
// OCC's MakeFace reads the wire's edges (not just the orientation flag)
// to decide whether an inner wire bounds a hole or extends the outer
// region.  The hole inner-walls' face normals come out wrong if the wire
// is the SAME winding as the outer wire — making BRepFilletAPI bevel the
// inner edges in the wrong direction (appearing to fill the hole).  We
// can't trust the input polygon's winding to be consistent (loops traced
// from sketches can come in either orientation), so we normalize here
// by reversing the point order when the signed area doesn't match.
function makeWireFromPolygon(points, centroid, wantCcw = true) {
  const oc = getOcc();
  if (!points || points.length < 3) return null;
  const isCcw = signedPolyArea(points) > 0;
  const ordered = isCcw === wantCcw ? points : [...points].reverse();
  const wireMk = new oc.BRepBuilderAPI_MakeWire_1();
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i];
    const b = ordered[(i + 1) % ordered.length];
    const p1 = new oc.gp_Pnt_3(a.x - centroid.x, a.y - centroid.y, 0);
    const p2 = new oc.gp_Pnt_3(b.x - centroid.x, b.y - centroid.y, 0);
    const edgeMk = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
    wireMk.Add_1(edgeMk.Edge());
  }
  return wireMk.Wire();
}

// Build an extrude shape from an item with { profile: { polygon2D, holes,
// ... }, depth }.  The polygon's centroid becomes the origin (matching the
// THREE.ExtrudeGeometry path in buildItemGeometry).  Result is a prism
// along +Z, centred along its extrusion axis.
export function makeExtrude(item) {
  const oc = getOcc();
  const poly = item.profile?.polygon2D;
  if (!poly || poly.length < 3) return null;
  const holes = item.profile?.holes || [];
  const depth = resolveItemDepth(item);
  const c = polyCentroid(poly);

  // Outer boundary must be CCW (positive signed area); inner holes must
  // be CW (negative).  makeWireFromPolygon normalizes each polygon's
  // point order to match.
  const outerWire = makeWireFromPolygon(poly, c, /* wantCcw */ true);
  if (!outerWire) return null;
  const faceMk = new oc.BRepBuilderAPI_MakeFace_15(outerWire, true);
  let face = faceMk.Face();
  for (const h of holes) {
    if (!h || h.length < 3) continue;
    const holeWire = makeWireFromPolygon(h, c, /* wantCcw */ false);
    if (!holeWire) continue;
    // MakeFace_22(face, wire) adds an inner wire (hole) to an existing
    // face.  The wire's orientation determines whether it's an outer
    // boundary or a hole — we built it reversed so it's read as a hole.
    const faceWithHole = new oc.BRepBuilderAPI_MakeFace_22(face, holeWire);
    face = faceWithHole.Face();
  }

  // Prism along +Z by depth, base at z=0.  Matches the render-side path
  // in sceneObjects.js so the bottom face of every extrusion sits on
  // the sketch plane instead of straddling it.
  const dir = new oc.gp_Vec_4(0, 0, depth);
  const prismMk = new oc.BRepPrimAPI_MakePrism_1(face, dir, false, true);
  return prismMk.Shape();
}

// Dispatch by item type.
export function makePrimitiveShape(item) {
  switch (item.type) {
    case "cube":
      return makeCube();
    case "sphere":
      return makeSphere();
    case "cylinder":
      return makeCylinder();
    case "torus":
      return makeTorus();
    case "extrude":
      return makeExtrude(item);
    default:
      return null;
  }
}
