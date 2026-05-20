// Tessellation: convert a TopoDS_Shape into a THREE.BufferGeometry.
//
// Uses BRepMesh_IncrementalMesh with a linear deflection (chord-deviation
// tolerance) that maps from the app's `printPrecision` setting.  After
// meshing, walk every face of the shape, pull its Poly_Triangulation, and
// accumulate vertices + indices.  Vertex normals are computed from the
// face surface normal (per-face hard edges, matching the chamfer/bevel
// hard-edge appearance the app already uses).

import * as THREE from "three";
import { getOcc } from "./init.js";

// Map the app's precision setting (millimetres, or null for preview) to
// OCC's linear deflection.  Preview = 0.5 (coarse, ~32-segment circle on
// a unit radius); print = the user-set precision.
function deflectionFor(printPrecision) {
  if (printPrecision === null || printPrecision === undefined) return 0.5;
  // App's precision is in "millimetres" (with MM_PER_UNIT = 10 implicit
  // in the rest of the codebase, this is the precision per scene unit).
  return Math.max(0.001, printPrecision / 10);
}

export function tessellate(shape, printPrecision = null) {
  if (!shape) return null;
  const oc = getOcc();
  const linearDeflection = deflectionFor(printPrecision);
  const angularDeflection = 0.3; // radians; ~17° max angle per facet
  // The 3rd arg (isRelative) = false → linearDeflection is absolute.
  // The 5th arg (isInParallel) = false → single-threaded; works in
  // single-threaded WASM builds.
  new oc.BRepMesh_IncrementalMesh_2(
    shape,
    linearDeflection,
    false,
    angularDeflection,
    false,
  );

  const positions = [];
  const normals = [];
  const indices = [];

  const explorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );

  while (explorer.More()) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    const locationHandle = new oc.TopLoc_Location_1();
    const triangulationHandle = oc.BRep_Tool.Triangulation(
      face,
      locationHandle,
    );
    if (!triangulationHandle.IsNull()) {
      const triangulation = triangulationHandle.get();
      const trsf = locationHandle.Transformation();

      // Build local face-normal direction.  Forward-orientation faces
      // emit their natural normal; REVERSED faces flip it.
      const reversed =
        face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;

      const baseVert = positions.length / 3;
      const nbNodes = triangulation.NbNodes();
      for (let i = 1; i <= nbNodes; i++) {
        const node = triangulation.Node(i);
        const pnt = node.Transformed(trsf);
        positions.push(pnt.X(), pnt.Y(), pnt.Z());
        // Normal placeholder — overwritten below per-triangle.
        normals.push(0, 0, 0);
      }

      const nbTris = triangulation.NbTriangles();
      for (let i = 1; i <= nbTris; i++) {
        const tri = triangulation.Triangle(i);
        // OCC indices are 1-based; subtract 1 for 0-based.
        let n1 = tri.Value(1) - 1;
        let n2 = tri.Value(2) - 1;
        let n3 = tri.Value(3) - 1;
        if (reversed) {
          const t = n2;
          n2 = n3;
          n3 = t;
        }
        indices.push(baseVert + n1, baseVert + n2, baseVert + n3);
      }
    }
    explorer.Next();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geometry.computeVertexNormals();
  return geometry;
}

// Convenience for callers that store flat arrays (matching the existing
// `geometryData` shape in the store).
export function tessellateToData(shape, printPrecision = null) {
  const geo = tessellate(shape, printPrecision);
  if (!geo) return null;
  const pos = geo.getAttribute("position").array;
  const nrm = geo.getAttribute("normal")?.array || null;
  const idx = geo.index ? geo.index.array : null;
  return {
    positions: Array.from(pos),
    normals: nrm ? Array.from(nrm) : null,
    indices: idx ? Array.from(idx) : null,
  };
}
