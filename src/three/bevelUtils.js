import * as THREE from "three";

// ── Topology helpers ──────────────────────────────────────────────────────────

// Convert a non-indexed geometry to an indexed one by merging vertices that
// share the same position within `eps`.  Returns the same object unchanged if
// it is already indexed.
export function mergeVertices(geometry, eps = 1e-4) {
  if (geometry.index) return geometry;
  const posAttr = geometry.getAttribute("position");
  const uniquePos = []; // flat [x,y,z, ...]
  const newIndices = [];

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i),
      y = posAttr.getY(i),
      z = posAttr.getZ(i);
    let found = -1;
    for (let j = 0; j < uniquePos.length / 3; j++) {
      if (
        Math.abs(uniquePos[j * 3] - x) < eps &&
        Math.abs(uniquePos[j * 3 + 1] - y) < eps &&
        Math.abs(uniquePos[j * 3 + 2] - z) < eps
      ) {
        found = j;
        break;
      }
    }
    if (found === -1) {
      found = uniquePos.length / 3;
      uniquePos.push(x, y, z);
    }
    newIndices.push(found);
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(uniquePos), 3),
  );
  result.setIndex(new THREE.BufferAttribute(new Uint32Array(newIndices), 1));
  return result;
}

// Find all vertex indices in `posArr` (flat [x,y,z,...]) whose position is
// within `eps` of `pos`.
function findVerticesAtPos(posArr, pos, eps = 1e-4) {
  const out = [];
  for (let i = 0; i < posArr.length / 3; i++) {
    if (
      Math.abs(posArr[i * 3] - pos.x) < eps &&
      Math.abs(posArr[i * 3 + 1] - pos.y) < eps &&
      Math.abs(posArr[i * 3 + 2] - pos.z) < eps
    )
      out.push(i);
  }
  return out;
}

// Find all triangles (each as {ia, ib, ic, triBase}) that contain at least one
// vertex from `setA` AND at least one from `setB`.
function findEdgeTriangles(idxArr, setA, setB) {
  const setAS = new Set(setA),
    setBs = new Set(setB);
  const tris = [];
  for (let t = 0; t < idxArr.length; t += 3) {
    const v0 = idxArr[t],
      v1 = idxArr[t + 1],
      v2 = idxArr[t + 2];
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
  return a
    .clone()
    .multiplyScalar(Math.sin((1 - t) * angle) / sinA)
    .addScaledVector(b, Math.sin(t * angle) / sinA);
}

// ── Coplanar face detection ───────────────────────────────────────────────────

// Returns all triangle indices (as {ia, ib, ic}) whose normal is within `eps`
// of `normal` (unit vector).  Used to collect the full planar face region.
export function findCoplanarFaces(geometry, normal, eps = 0.01) {
  const indexed = mergeVertices(geometry);
  const posAttr = indexed.getAttribute("position");
  const idxArr = indexed.index.array;
  const N =
    normal instanceof THREE.Vector3
      ? normal
      : new THREE.Vector3(normal.nx, normal.ny, normal.nz);
  const vA = new THREE.Vector3(),
    vB = new THREE.Vector3(),
    vC = new THREE.Vector3();
  const triNorm = new THREE.Vector3();
  const result = [];
  for (let t = 0; t < idxArr.length; t += 3) {
    const ia = idxArr[t],
      ib = idxArr[t + 1],
      ic = idxArr[t + 2];
    vA.set(posAttr.getX(ia), posAttr.getY(ia), posAttr.getZ(ia));
    vB.set(posAttr.getX(ib), posAttr.getY(ib), posAttr.getZ(ib));
    vC.set(posAttr.getX(ic), posAttr.getY(ic), posAttr.getZ(ic));
    triNorm
      .crossVectors(
        new THREE.Vector3().subVectors(vB, vA),
        new THREE.Vector3().subVectors(vC, vA),
      )
      .normalize();
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
    for (const [a, b] of [
      [ia, ib],
      [ib, ic],
      [ic, ia],
    ]) {
      const k = Math.min(a, b) + "," + Math.max(a, b);
      edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
      if (!edgeVerts.has(k)) edgeVerts.set(k, { a, b });
    }
  }
  const boundary = [];
  edgeCount.forEach((cnt, k) => {
    if (cnt === 1) boundary.push(edgeVerts.get(k));
  });
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

  // ── Phase 1: discover adjacency for every edge BEFORE any modifications ──
  // When multiple bevelled edges share a corner, the second edge's expected
  // adjacent triangles would otherwise be destroyed by the first edge's
  // coplanar replacement.  Snapshot the original adjacency up front so each
  // edge is processed against the unmodified geometry.
  const plans = [];
  const posKey = (p) =>
    `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)},${Math.round(p.z * 1e4)}`;

  for (const ep of edgePairs) {
    const posA = new THREE.Vector3(ep.ax, ep.ay, ep.az);
    const posB = new THREE.Vector3(ep.bx, ep.by, ep.bz);
    const idxA = findVerticesAtPos(posArr, posA);
    const idxB = findVerticesAtPos(posArr, posB);
    if (idxA.length === 0 || idxB.length === 0) continue;
    const adjTris = findEdgeTriangles(idxArr, idxA, idxB);
    if (adjTris.length !== 2) continue;
    const setA = new Set(idxA),
      setB = new Set(idxB);
    const [T1, T2] = adjTris;
    const ic1 = thirdVertex(T1, setA, setB);
    const ic2 = thirdVertex(T2, setA, setB);
    if (ic1 < 0 || ic2 < 0) continue;

    const PA = posA.clone();
    const PB = posB.clone();
    const PC1 = new THREE.Vector3(
      posArr[ic1 * 3],
      posArr[ic1 * 3 + 1],
      posArr[ic1 * 3 + 2],
    );
    const PC2 = new THREE.Vector3(
      posArr[ic2 * 3],
      posArr[ic2 * 3 + 1],
      posArr[ic2 * 3 + 2],
    );
    const M = PA.clone().add(PB).multiplyScalar(0.5);

    const N1 = new THREE.Vector3()
      .crossVectors(
        new THREE.Vector3().subVectors(PB, PA),
        new THREE.Vector3().subVectors(PC1, PA),
      )
      .normalize();
    const N2 = new THREE.Vector3()
      .crossVectors(
        new THREE.Vector3().subVectors(PB, PA),
        new THREE.Vector3().subVectors(PC2, PA),
      )
      .normalize();

    const E = new THREE.Vector3().subVectors(PB, PA).normalize();
    const makeDir = (PC, N) => {
      const raw = new THREE.Vector3().subVectors(PC, M);
      raw.addScaledVector(N, -raw.dot(N));
      raw.addScaledVector(E, -raw.dot(E));
      return raw.normalize();
    };
    const D1 = makeDir(PC1, N1);
    const D2 = makeDir(PC2, N2);

    plans.push({
      posA, posB, idxA, idxB, setA, setB,
      T1, T2, ic1, ic2,
      PA, PB, M, N1, N2, D1, D2, E,
    });
  }

  // Identify corner positions touched by 2+ edges — for these we must skip
  // coplanar replacement (otherwise the second edge can't find its corner).
  const cornerHits = new Map();
  for (const p of plans) {
    for (const pos of [p.posA, p.posB]) {
      const k = posKey(pos);
      cornerHits.set(k, (cornerHits.get(k) || 0) + 1);
    }
  }
  const isSharedCorner = (pos) => (cornerHits.get(posKey(pos)) || 0) > 1;

  // ── Phase 2: apply each plan ─────────────────────────────────────────────
  for (const plan of plans) {
    const {
      posA, idxA, idxB, setA, setB,
      T1, T2, PA, PB, N1, N2, D1, D2, E,
    } = plan;

    // Build per-face vertex strips (segments+1 positions at A and B ends).
    // Strip[0] = face1 side, Strip[segments] = face2 side.
    const stripA = [],
      stripB = [];
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const dir = segments === 1 ? (t === 0 ? D1 : D2) : slerp(D1, D2, t);
      const nIdxA = posArr.length / 3;
      posArr.push(
        PA.x + dir.x * amount,
        PA.y + dir.y * amount,
        PA.z + dir.z * amount,
      );
      const nIdxB = posArr.length / 3;
      posArr.push(
        PB.x + dir.x * amount,
        PB.y + dir.y * amount,
        PB.z + dir.z * amount,
      );
      stripA.push(nIdxA);
      stripB.push(nIdxB);
    }

    // Determine winding order for bevel strip faces by checking alignment
    // with the expected outward normal (N1+N2 bisector).
    const expected = new THREE.Vector3().addVectors(N1, N2).normalize();
    const sA0 = new THREE.Vector3(
      posArr[stripA[0] * 3],
      posArr[stripA[0] * 3 + 1],
      posArr[stripA[0] * 3 + 2],
    );
    const sB0 = new THREE.Vector3(
      posArr[stripB[0] * 3],
      posArr[stripB[0] * 3 + 1],
      posArr[stripB[0] * 3 + 2],
    );
    const sA1 = new THREE.Vector3(
      posArr[stripA[1] * 3],
      posArr[stripA[1] * 3 + 1],
      posArr[stripA[1] * 3 + 2],
    );
    const testNorm = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(sB0, sA0),
      new THREE.Vector3().subVectors(sA1, sA0),
    );
    const flip = testNorm.dot(expected) < 0;

    // Add bevel strip quads
    for (let s = 0; s < segments; s++) {
      const nA0 = stripA[s],
        nB0 = stripB[s],
        nA1 = stripA[s + 1],
        nB1 = stripB[s + 1];
      if (!flip) {
        idxArr.push(nA0, nB0, nB1);
        idxArr.push(nA0, nB1, nA1);
      } else {
        idxArr.push(nA0, nB1, nB0);
        idxArr.push(nA0, nA1, nB1);
      }
    }

    // Identify the per-face corner vertex indices in T1 and T2.
    const iA1 = [T1.v0, T1.v1, T1.v2].find((v) => setA.has(v));
    const iB1 = [T1.v0, T1.v1, T1.v2].find((v) => setB.has(v));
    const iA2 = [T2.v0, T2.v1, T2.v2].find((v) => setA.has(v));
    const iB2 = [T2.v0, T2.v1, T2.v2].find((v) => setB.has(v));

    // Replace corner indices in T1/T2 AND in any coplanar sibling triangles
    // (BoxGeometry has 2 triangles per face — both must move together so the
    // face's internal diagonal stays joined).
    const isCoplanarWith = (triBase, refNorm) => {
      const a = idxArr[triBase],
        b = idxArr[triBase + 1],
        c = idxArr[triBase + 2];
      const pa = new THREE.Vector3(posArr[a*3], posArr[a*3+1], posArr[a*3+2]);
      const pb = new THREE.Vector3(posArr[b*3], posArr[b*3+1], posArr[b*3+2]);
      const pc = new THREE.Vector3(posArr[c*3], posArr[c*3+1], posArr[c*3+2]);
      const n = new THREE.Vector3()
        .crossVectors(
          new THREE.Vector3().subVectors(pb, pa),
          new THREE.Vector3().subVectors(pc, pa),
        )
        .normalize();
      return n.dot(refNorm) > 0.999;
    };

    // Skip coplanar replacement for corner positions shared with another
    // bevel edge — that corner must still be findable for the other edge.
    // T1 and T2 themselves are always modified (direct replacement).
    const skipA = isSharedCorner(plan.posA);
    const skipB = isSharedCorner(plan.posB);
    for (let t = 0; t < idxArr.length; t += 3) {
      const isT1 = t === T1.triBase;
      const isT2 = t === T2.triBase;
      const coplN1 = isT1 || isCoplanarWith(t, N1);
      const coplN2 = isT2 || isCoplanarWith(t, N2);
      for (let j = 0; j < 3; j++) {
        const v = idxArr[t + j];
        if (coplN1) {
          if (v === iA1 && (isT1 || !skipA)) idxArr[t + j] = stripA[0];
          else if (v === iB1 && (isT1 || !skipB)) idxArr[t + j] = stripB[0];
        }
        if (coplN2) {
          if (v === iA2 && (isT2 || !skipA)) idxArr[t + j] = stripA[segments];
          else if (v === iB2 && (isT2 || !skipB)) idxArr[t + j] = stripB[segments];
        }
      }
    }

    // ── End-cap fans on perpendicular faces ────────────────────────────────
    // At each edge endpoint, find a vertex still at the corner position that
    // belongs to a perpendicular face (one not coplanar with N1 or N2), and
    // add a fan from that corner to the strip vertices.  This closes the
    // visible triangular notch where the bevel strip terminates against the
    // perpendicular face.  (The fan is coplanar with the perpendicular face,
    // so overlap with the existing corner triangle is not visible.)
    const findPerpCornerVert = (cornerPos) => {
      for (let t = 0; t < idxArr.length; t += 3) {
        const verts = [idxArr[t], idxArr[t + 1], idxArr[t + 2]];
        const pts = verts.map(
          (vi) =>
            new THREE.Vector3(
              posArr[vi * 3],
              posArr[vi * 3 + 1],
              posArr[vi * 3 + 2],
            ),
        );
        // Compute triangle normal; skip bevel-coplanar triangles.
        const triN = new THREE.Vector3()
          .crossVectors(
            new THREE.Vector3().subVectors(pts[1], pts[0]),
            new THREE.Vector3().subVectors(pts[2], pts[0]),
          )
          .normalize();
        if (Math.abs(triN.dot(N1)) > 0.999 || Math.abs(triN.dot(N2)) > 0.999)
          continue;
        for (let k = 0; k < 3; k++) {
          if (
            Math.abs(pts[k].x - cornerPos.x) < 1e-4 &&
            Math.abs(pts[k].y - cornerPos.y) < 1e-4 &&
            Math.abs(pts[k].z - cornerPos.z) < 1e-4
          )
            return { vertIdx: verts[k], norm: triN };
        }
      }
      return null;
    };

    const addEndCap = (cornerPos, strip, capDir) => {
      const found = findPerpCornerVert(cornerPos);
      if (!found) return;
      const cornerIdx = found.vertIdx;
      const corner = new THREE.Vector3(
        posArr[cornerIdx * 3],
        posArr[cornerIdx * 3 + 1],
        posArr[cornerIdx * 3 + 2],
      );
      for (let s = 0; s < segments; s++) {
        const i1 = strip[s];
        const i2 = strip[s + 1];
        const p1 = new THREE.Vector3(posArr[i1*3], posArr[i1*3+1], posArr[i1*3+2]);
        const p2 = new THREE.Vector3(posArr[i2*3], posArr[i2*3+1], posArr[i2*3+2]);
        const triNorm = new THREE.Vector3().crossVectors(
          new THREE.Vector3().subVectors(p1, corner),
          new THREE.Vector3().subVectors(p2, corner),
        );
        if (triNorm.dot(capDir) >= 0) idxArr.push(cornerIdx, i1, i2);
        else idxArr.push(cornerIdx, i2, i1);
      }
    };

    addEndCap(PA, stripA, E.clone().negate());
    addEndCap(PB, stripB, E);
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(posArr), 3),
  );
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
  for (const face of subGeo.faces || []) {
    const tris = findCoplanarFaces(indexed, {
      nx: face.nx,
      ny: face.ny,
      nz: face.nz,
    });
    const boundary = getBoundaryEdges(tris);
    const posAttr = indexed.getAttribute("position");
    for (const { a, b } of boundary) {
      allEdges.push({
        ax: posAttr.getX(a),
        ay: posAttr.getY(a),
        az: posAttr.getZ(a),
        bx: posAttr.getX(b),
        by: posAttr.getY(b),
        bz: posAttr.getZ(b),
      });
    }
  }

  if (allEdges.length === 0) return null;
  return segments === 1
    ? chamferEdges(indexed, allEdges, amount)
    : bevelEdges(indexed, allEdges, amount, segments);
}
