import * as THREE from "three";

// ── Topology helpers ──────────────────────────────────────────────────────────

// Convert a non-indexed geometry to an indexed one by merging vertices that
// share the same position within `eps`.  Returns the same object unchanged if
// it is already indexed.
export function mergeVertices(geometry, eps = 1e-4) {
  if (geometry.index) return geometry;
  const posAttr = geometry.getAttribute("position");
  const uniquePos = [];   // flat [x,y,z, ...]
  const newIndices = [];

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
    let found = -1;
    for (let j = 0; j < uniquePos.length / 3; j++) {
      if (Math.abs(uniquePos[j*3]   - x) < eps &&
          Math.abs(uniquePos[j*3+1] - y) < eps &&
          Math.abs(uniquePos[j*3+2] - z) < eps) { found = j; break; }
    }
    if (found === -1) { found = uniquePos.length / 3; uniquePos.push(x, y, z); }
    newIndices.push(found);
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.BufferAttribute(new Float32Array(uniquePos), 3));
  result.setIndex(new THREE.BufferAttribute(new Uint32Array(newIndices), 1));
  return result;
}

// Find all vertex indices in `posArr` (flat [x,y,z,...]) whose position is
// within `eps` of `pos`.
function findVerticesAtPos(posArr, pos, eps = 1e-4) {
  const out = [];
  for (let i = 0; i < posArr.length / 3; i++) {
    if (Math.abs(posArr[i*3]   - pos.x) < eps &&
        Math.abs(posArr[i*3+1] - pos.y) < eps &&
        Math.abs(posArr[i*3+2] - pos.z) < eps) out.push(i);
  }
  return out;
}

// Find all triangles (each as {ia, ib, ic, triBase}) that contain at least one
// vertex from `setA` AND at least one from `setB`.
function findEdgeTriangles(idxArr, setA, setB) {
  const setAS = new Set(setA), setBs = new Set(setB);
  const tris = [];
  for (let t = 0; t < idxArr.length; t += 3) {
    const v0 = idxArr[t], v1 = idxArr[t+1], v2 = idxArr[t+2];
    const hasA = setAS.has(v0) || setAS.has(v1) || setAS.has(v2);
    const hasB = setBs.has(v0) || setBs.has(v1) || setBs.has(v2);
    if (hasA && hasB) tris.push({ triBase: t, v0, v1, v2 });
  }
  return tris;
}

// Get the vertex from {v0,v1,v2} that is NOT in setA and NOT in setB.
function thirdVertex(tri, setA, setB) {
  for (const v of [tri.v0, tri.v1, tri.v2]) {
    if (!setA.has(v) && !setB.has(v)) return v;
  }
  return -1;
}

// Spherical linear interpolation between two unit vectors.
function slerp(a, b, t) {
  const dot = Math.max(-1, Math.min(1, a.dot(b)));
  const angle = Math.acos(dot);
  if (Math.abs(angle) < 1e-6) return a.clone().lerp(b, t).normalize();
  const sinA = Math.sin(angle);
  return a.clone().multiplyScalar(Math.sin((1 - t) * angle) / sinA)
         .addScaledVector(b, Math.sin(t * angle) / sinA);
}

// ── Coplanar face detection ───────────────────────────────────────────────────

// Returns all triangle indices (as {ia, ib, ic}) whose normal is within `eps`
// of `normal` (unit vector).  Used to collect the full planar face region.
export function findCoplanarFaces(geometry, normal, eps = 0.01) {
  const indexed = mergeVertices(geometry);
  const posAttr = indexed.getAttribute("position");
  const idxArr  = indexed.index.array;
  const N = normal instanceof THREE.Vector3 ? normal : new THREE.Vector3(normal.nx, normal.ny, normal.nz);
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  const triNorm = new THREE.Vector3();
  const result = [];
  for (let t = 0; t < idxArr.length; t += 3) {
    const ia = idxArr[t], ib = idxArr[t+1], ic = idxArr[t+2];
    vA.set(posAttr.getX(ia), posAttr.getY(ia), posAttr.getZ(ia));
    vB.set(posAttr.getX(ib), posAttr.getY(ib), posAttr.getZ(ib));
    vC.set(posAttr.getX(ic), posAttr.getY(ic), posAttr.getZ(ic));
    triNorm.crossVectors(new THREE.Vector3().subVectors(vB, vA), new THREE.Vector3().subVectors(vC, vA)).normalize();
    if (triNorm.dot(N) > 1 - eps) result.push({ ia, ib, ic });
  }
  return result;
}

// Returns the boundary edges of the given triangle set (edges that appear in
// exactly one of the triangles — these are the perimeter edges of the face).
export function getBoundaryEdges(triList) {
  const edgeCount = new Map();
  const edgeVerts = new Map();
  for (const { ia, ib, ic } of triList) {
    for (const [a, b] of [[ia,ib],[ib,ic],[ic,ia]]) {
      const k = Math.min(a,b) + "," + Math.max(a,b);
      edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
      if (!edgeVerts.has(k)) edgeVerts.set(k, {a, b});
    }
  }
  const boundary = [];
  edgeCount.forEach((cnt, k) => { if (cnt === 1) boundary.push(edgeVerts.get(k)); });
  return boundary;
}

// ── Core bevel algorithm ──────────────────────────────────────────────────────

// Applies a flat chamfer (single new face per edge) or multi-segment bevel
// to the given indexed geometry.
//
// edgePairs: [{ax,ay,az, bx,by,bz}, ...] — endpoint positions in local space.
// amount:    how far to move vertices inward per face (half the chamfer width).
// segments:  1 = flat chamfer; >1 = rounded bevel with arc interpolation.
//
// Returns a new indexed THREE.BufferGeometry with the bevel applied.
function applyBevel(geometry, edgePairs, amount, segments) {
  const indexed = mergeVertices(geometry);
  const posArr = Array.from(indexed.getAttribute("position").array);
  const idxArr = Array.from(indexed.index.array);

  for (const ep of edgePairs) {
    const posA = new THREE.Vector3(ep.ax, ep.ay, ep.az);
    const posB = new THREE.Vector3(ep.bx, ep.by, ep.bz);
    const idxA = findVerticesAtPos(posArr, posA);
    const idxB = findVerticesAtPos(posArr, posB);
    if (idxA.length === 0 || idxB.length === 0) continue;

    const adjTris = findEdgeTriangles(idxArr, idxA, idxB);
    if (adjTris.length !== 2) continue; // skip boundary or non-manifold

    const setA = new Set(idxA), setB = new Set(idxB);
    const [T1, T2] = adjTris;
    const ic1 = thirdVertex(T1, setA, setB);
    const ic2 = thirdVertex(T2, setA, setB);
    if (ic1 < 0 || ic2 < 0) continue;

    const PA = posA.clone();
    const PB = posB.clone();
    const PC1 = new THREE.Vector3(posArr[ic1*3], posArr[ic1*3+1], posArr[ic1*3+2]);
    const PC2 = new THREE.Vector3(posArr[ic2*3], posArr[ic2*3+1], posArr[ic2*3+2]);
    const M = PA.clone().add(PB).multiplyScalar(0.5);

    // Compute face normals
    const N1 = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(PB, PA),
      new THREE.Vector3().subVectors(PC1, PA)
    ).normalize();
    const N2 = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(PB, PA),
      new THREE.Vector3().subVectors(PC2, PA)
    ).normalize();

    // Inward bevel direction for each face: from edge midpoint toward the
    // third vertex, projected onto the face plane and perpendicular to the edge.
    const E = new THREE.Vector3().subVectors(PB, PA).normalize();
    const makeDir = (PC, N) => {
      const raw = new THREE.Vector3().subVectors(PC, M);
      // Remove normal component (project onto face plane)
      raw.addScaledVector(N, -raw.dot(N));
      // Remove edge component
      raw.addScaledVector(E, -raw.dot(E));
      return raw.normalize();
    };
    const D1 = makeDir(PC1, N1);
    const D2 = makeDir(PC2, N2);

    // Build per-face vertex strips (segments+1 positions at A and B ends).
    // Strip[0] = face1 side, Strip[segments] = face2 side.
    const stripA = [], stripB = [];
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const dir = segments === 1 ? (t === 0 ? D1 : D2) : slerp(D1, D2, t);
      const nIdxA = posArr.length / 3;
      posArr.push(PA.x + dir.x*amount, PA.y + dir.y*amount, PA.z + dir.z*amount);
      const nIdxB = posArr.length / 3;
      posArr.push(PB.x + dir.x*amount, PB.y + dir.y*amount, PB.z + dir.z*amount);
      stripA.push(nIdxA);
      stripB.push(nIdxB);
    }

    // Determine winding order for bevel strip faces by checking alignment
    // with the expected outward normal (N1+N2 bisector).
    const expected = new THREE.Vector3().addVectors(N1, N2).normalize();
    const sA0 = new THREE.Vector3(posArr[stripA[0]*3], posArr[stripA[0]*3+1], posArr[stripA[0]*3+2]);
    const sB0 = new THREE.Vector3(posArr[stripB[0]*3], posArr[stripB[0]*3+1], posArr[stripB[0]*3+2]);
    const sA1 = new THREE.Vector3(posArr[stripA[1]*3], posArr[stripA[1]*3+1], posArr[stripA[1]*3+2]);
    const testNorm = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(sB0, sA0),
      new THREE.Vector3().subVectors(sA1, sA0)
    );
    const flip = testNorm.dot(expected) < 0;

    // Add bevel strip quads
    for (let s = 0; s < segments; s++) {
      const nA0 = stripA[s], nB0 = stripB[s], nA1 = stripA[s+1], nB1 = stripB[s+1];
      if (!flip) {
        idxArr.push(nA0, nB0, nB1);
        idxArr.push(nA0, nB1, nA1);
      } else {
        idxArr.push(nA0, nB1, nB0);
        idxArr.push(nA0, nA1, nB1);
      }
    }

    // Update T1: replace its A and B vertices with strip[0]
    const iA1 = [T1.v0, T1.v1, T1.v2].find(v => setA.has(v));
    const iB1 = [T1.v0, T1.v1, T1.v2].find(v => setB.has(v));
    for (let j = 0; j < 3; j++) {
      if (idxArr[T1.triBase + j] === iA1) idxArr[T1.triBase + j] = stripA[0];
      else if (idxArr[T1.triBase + j] === iB1) idxArr[T1.triBase + j] = stripB[0];
    }

    // Update T2: replace its A and B vertices with strip[segments]
    const iA2 = [T2.v0, T2.v1, T2.v2].find(v => setA.has(v));
    const iB2 = [T2.v0, T2.v1, T2.v2].find(v => setB.has(v));
    for (let j = 0; j < 3; j++) {
      if (idxArr[T2.triBase + j] === iA2) idxArr[T2.triBase + j] = stripA[segments];
      else if (idxArr[T2.triBase + j] === iB2) idxArr[T2.triBase + j] = stripB[segments];
    }
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.BufferAttribute(new Float32Array(posArr), 3));
  result.setIndex(new THREE.BufferAttribute(new Uint32Array(idxArr), 1));
  result.computeVertexNormals();
  return result;
}

// Public API ──────────────────────────────────────────────────────────────────

// Chamfer: replace each selected edge with a single flat face.
export function chamferEdges(geometry, edgePairs, amount = 0.05) {
  return applyBevel(geometry, edgePairs, amount, 1);
}

// Bevel: replace each selected edge with `segments` faces along an arc.
export function bevelEdges(geometry, edgePairs, amount = 0.05, segments = 3) {
  return applyBevel(geometry, edgePairs, amount, Math.max(2, segments));
}

// Convert the selectedSubGeometry faces to edge pairs (boundary of each
// coplanar region) and edges to edge pairs (direct), then run the bevel.
export function applyBevelToSubGeometry(geometry, subGeo, amount, segments) {
  const allEdges = [...(subGeo.edges || [])];

  // Expand each face selection into its boundary edge pairs
  const indexed = mergeVertices(geometry);
  for (const face of (subGeo.faces || [])) {
    const tris = findCoplanarFaces(indexed, { nx: face.nx, ny: face.ny, nz: face.nz });
    const boundary = getBoundaryEdges(tris);
    const posAttr = indexed.getAttribute("position");
    for (const { a, b } of boundary) {
      allEdges.push({
        ax: posAttr.getX(a), ay: posAttr.getY(a), az: posAttr.getZ(a),
        bx: posAttr.getX(b), by: posAttr.getY(b), bz: posAttr.getZ(b),
      });
    }
  }

  if (allEdges.length === 0) return null;
  return segments === 1
    ? chamferEdges(indexed, allEdges, amount)
    : bevelEdges(indexed, allEdges, amount, segments);
}
