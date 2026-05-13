import * as THREE from "three";

// ── Topology helpers ──────────────────────────────────────────────────────────

// Convert any input geometry to an indexed geometry whose vertex positions
// are deduplicated within `eps`.  Critically this must work for ALREADY
// indexed geometries too (e.g. CylinderGeometry's cap, where the center
// vertex is duplicated across all cap triangles): without position
// deduplication, the boundary-edge walk would treat every "spoke" from the
// cap center as a boundary edge, exploding into ~3x as many "edges" to bevel.
export function mergeVertices(geometry, eps = 1e-4) {
  const posAttr = geometry.getAttribute("position");
  const oldIndex = geometry.index ? geometry.index.array : null;
  const uniquePos = []; // flat [x,y,z, ...]
  const oldToNew = new Map(); // old vertex index → canonical index
  const keyFor = (x, y, z) => {
    const q = 1 / eps;
    return (
      Math.round(x * q) +
      "," +
      Math.round(y * q) +
      "," +
      Math.round(z * q)
    );
  };
  const keyToIdx = new Map();

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i),
      y = posAttr.getY(i),
      z = posAttr.getZ(i);
    const k = keyFor(x, y, z);
    let canonical = keyToIdx.get(k);
    if (canonical === undefined) {
      canonical = uniquePos.length / 3;
      uniquePos.push(x, y, z);
      keyToIdx.set(k, canonical);
    }
    oldToNew.set(i, canonical);
  }

  const newIndices = oldIndex
    ? Array.from(oldIndex, (i) => oldToNew.get(i))
    : Array.from(oldToNew.values());

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

    // Compute face normals using each triangle's OWN vertex winding order
    // (rather than a fixed PA→PB→PC order) so the resulting normal is the
    // actual outward face normal, not flipped to inward depending on which
    // endpoint of the edge happened to be PA vs PB.  This matters for:
    //   (1) the bevel strip's outward-direction check (wrong flip otherwise),
    //   (2) Phase 3's shared-face detection between paired edges.
    const computeTriNormal = (tri) => {
      const p0 = new THREE.Vector3(
        posArr[tri.v0 * 3],
        posArr[tri.v0 * 3 + 1],
        posArr[tri.v0 * 3 + 2],
      );
      const p1 = new THREE.Vector3(
        posArr[tri.v1 * 3],
        posArr[tri.v1 * 3 + 1],
        posArr[tri.v1 * 3 + 2],
      );
      const p2 = new THREE.Vector3(
        posArr[tri.v2 * 3],
        posArr[tri.v2 * 3 + 1],
        posArr[tri.v2 * 3 + 2],
      );
      return new THREE.Vector3()
        .crossVectors(
          new THREE.Vector3().subVectors(p1, p0),
          new THREE.Vector3().subVectors(p2, p0),
        )
        .normalize();
    };
    const N1 = computeTriNormal(T1);
    const N2 = computeTriNormal(T2);

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

    // (Perpendicular-face re-triangulation is deferred to Phase 4 below so
    // that its `idxArr.splice` operations don't shift other plans' captured
    // `T1.triBase`/`T2.triBase` indices mid-iteration.)
    const retriangulateCorner = (cornerPos, stripFirst, stripLast, N1, N2) => {
      const stripFirstPos = new THREE.Vector3(
        posArr[stripFirst * 3],
        posArr[stripFirst * 3 + 1],
        posArr[stripFirst * 3 + 2],
      );
      const stripLastPos = new THREE.Vector3(
        posArr[stripLast * 3],
        posArr[stripLast * 3 + 1],
        posArr[stripLast * 3 + 2],
      );

      const eps = 1e-4;
      const matchesCorner = (vi) =>
        Math.abs(posArr[vi * 3] - cornerPos.x) < eps &&
        Math.abs(posArr[vi * 3 + 1] - cornerPos.y) < eps &&
        Math.abs(posArr[vi * 3 + 2] - cornerPos.z) < eps;

      // Is `stripPos` on the segment from cornerPos to vertex at index `vi`?
      const stripOnEdge = (stripPos, vi) => {
        const px = posArr[vi * 3],
          py = posArr[vi * 3 + 1],
          pz = posArr[vi * 3 + 2];
        const ex = px - cornerPos.x,
          ey = py - cornerPos.y,
          ez = pz - cornerPos.z;
        const sx = stripPos.x - cornerPos.x,
          sy = stripPos.y - cornerPos.y,
          sz = stripPos.z - cornerPos.z;
        const eLen2 = ex * ex + ey * ey + ez * ez;
        if (eLen2 < 1e-12) return false;
        const t = (sx * ex + sy * ey + sz * ez) / eLen2;
        if (t < 1e-4 || t > 1 - 1e-4) return false;
        const projX = cornerPos.x + t * ex,
          projY = cornerPos.y + t * ey,
          projZ = cornerPos.z + t * ez;
        const dx = stripPos.x - projX,
          dy = stripPos.y - projY,
          dz = stripPos.z - projZ;
        return dx * dx + dy * dy + dz * dz < eps * eps;
      };

      // Find all perpendicular-face triangles that contain a vertex at
      // cornerPos.
      const perpTris = [];
      for (let t = 0; t < idxArr.length; t += 3) {
        const verts = [idxArr[t], idxArr[t + 1], idxArr[t + 2]];
        let cornerSlot = -1;
        for (let k = 0; k < 3; k++) {
          if (matchesCorner(verts[k])) {
            cornerSlot = k;
            break;
          }
        }
        if (cornerSlot === -1) continue;
        // Skip bevel-coplanar triangles (already handled by Phase 2).
        const pts = verts.map(
          (vi) =>
            new THREE.Vector3(
              posArr[vi * 3],
              posArr[vi * 3 + 1],
              posArr[vi * 3 + 2],
            ),
        );
        const triN = new THREE.Vector3()
          .crossVectors(
            new THREE.Vector3().subVectors(pts[1], pts[0]),
            new THREE.Vector3().subVectors(pts[2], pts[0]),
          )
          .normalize();
        if (
          Math.abs(triN.dot(N1)) > 0.999 ||
          Math.abs(triN.dot(N2)) > 0.999
        )
          continue;
        perpTris.push({ triBase: t, verts, cornerSlot, triN });
      }
      if (perpTris.length === 0) return;

      const toRemove = [];
      const toAdd = [];
      // Each pending Case-C entry: a triangle that retained v_corner in one
      // of its sub-triangles after a single-strip subdivision.  We expect
      // these to come in pairs sharing the "otherVert" (the diagonal vertex
      // of the original face quad).  We close the gap between paired Case-C
      // entries with one merger triangle (stripA, otherVert, stripB).
      const pending = []; // { strip, otherVert, triN }

      const emitWith = (v0, v1, v2, triN) => {
        const p0 = new THREE.Vector3(
          posArr[v0 * 3],
          posArr[v0 * 3 + 1],
          posArr[v0 * 3 + 2],
        );
        const p1 = new THREE.Vector3(
          posArr[v1 * 3],
          posArr[v1 * 3 + 1],
          posArr[v1 * 3 + 2],
        );
        const p2 = new THREE.Vector3(
          posArr[v2 * 3],
          posArr[v2 * 3 + 1],
          posArr[v2 * 3 + 2],
        );
        const n = new THREE.Vector3().crossVectors(
          new THREE.Vector3().subVectors(p1, p0),
          new THREE.Vector3().subVectors(p2, p0),
        );
        if (n.dot(triN) >= 0) toAdd.push(v0, v1, v2);
        else toAdd.push(v0, v2, v1);
      };

      for (const tri of perpTris) {
        const cs = tri.cornerSlot;
        const p1 = tri.verts[(cs + 1) % 3]; // next CCW
        const p2 = tri.verts[(cs + 2) % 3]; // prev CCW (or "next next")
        const firstOnP1 = stripOnEdge(stripFirstPos, p1);
        const firstOnP2 = stripOnEdge(stripFirstPos, p2);
        const lastOnP1 = stripOnEdge(stripLastPos, p1);
        const lastOnP2 = stripOnEdge(stripLastPos, p2);

        if ((firstOnP1 && lastOnP2) || (firstOnP2 && lastOnP1)) {
          // Case B: both strips on this triangle's two corner-incident edges.
          // The corner region (v_corner, stripFirst, stripLast) is the bevel
          // notch — discard.  Remaining region is a quad split into 2 tris.
          toRemove.push(tri.triBase);
          if (firstOnP1 && lastOnP2) {
            emitWith(stripFirst, p1, p2, tri.triN);
            emitWith(stripFirst, p2, stripLast, tri.triN);
          } else {
            emitWith(stripLast, p1, p2, tri.triN);
            emitWith(stripLast, p2, stripFirst, tri.triN);
          }
        } else if (firstOnP1 || firstOnP2 || lastOnP1 || lastOnP2) {
          // Case C: exactly one strip lies on one of the triangle's
          // corner-incident edges.  Subdivide: keep the non-corner sub-tri,
          // queue the corner sub-tri for pairwise merger.
          toRemove.push(tri.triBase);
          let strip, near, far;
          if (firstOnP1) {
            strip = stripFirst;
            near = p1;
            far = p2;
          } else if (firstOnP2) {
            strip = stripFirst;
            near = p2;
            far = p1;
          } else if (lastOnP1) {
            strip = stripLast;
            near = p1;
            far = p2;
          } else {
            strip = stripLast;
            near = p2;
            far = p1;
          }
          // Non-corner sub: (strip, near, far).
          emitWith(strip, near, far, tri.triN);
          // The corner sub (v_corner, strip, far) is replaced by a merger
          // with the paired Case-C triangle.
          pending.push({ strip, otherVert: far, triN: tri.triN });
        }
        // Case D (no strip on any corner-incident edge): triangle isn't
        // adjacent to the chamfer — leave it alone (no entry in toRemove).
        // This is rare for cube/CSG meshes; if it occurs the perpendicular
        // face will still contain v_corner, which is acceptable visually
        // (the chamfer just shows a tiny coplanar spike).
      }

      // Pair Case-C entries by their "otherVert" (the shared diagonal of
      // the perpendicular face quad).  Each matched pair gets one merger
      // triangle that joins the two strip endpoints across the diagonal.
      const usedPending = new Array(pending.length).fill(false);
      for (let i = 0; i < pending.length; i++) {
        if (usedPending[i]) continue;
        for (let j = i + 1; j < pending.length; j++) {
          if (usedPending[j]) continue;
          if (pending[i].otherVert !== pending[j].otherVert) continue;
          if (pending[i].strip === pending[j].strip) continue;
          emitWith(
            pending[i].strip,
            pending[i].otherVert,
            pending[j].strip,
            pending[i].triN,
          );
          usedPending[i] = true;
          usedPending[j] = true;
          break;
        }
      }

      // Remove old triangles from highest index down so earlier removals
      // don't shift later ones.
      toRemove.sort((a, b) => b - a);
      for (const t of toRemove) idxArr.splice(t, 3);
      idxArr.push(...toAdd);
    };

    // Stash the strip vertex indices on the plan so Phase 3 + Phase 4 can use them.
    plan.stripA = stripA;
    plan.stripB = stripB;
    plan.iA1 = iA1;
    plan.iB1 = iB1;
    plan.iA2 = iA2;
    plan.iB2 = iB2;
    // Also remember the perpendicular-face re-triangulator so Phase 4 can run
    // it AFTER all per-plan modifications are complete (otherwise its
    // idxArr.splice operations would shift other plans' captured triBases).
    plan.retriangulateCorner = retriangulateCorner;
  }

  // ── Phase 3: corner-blend triangles at shared corners ───────────────────
  // When two beveled edges share a corner, each modifies its own T1/T2 but
  // the shared face is left with an unfilled quad between the two strip
  // endpoints, the original corner vertex, and the face's diagonal-opposite
  // vertex (the "third vertex" of T1).  Walk every pair of plans sharing a
  // corner+face and emit the two triangles needed to close that quad.
  const stripEndpointFor = (plan, isPosA, isFace1) => {
    if (isFace1) return isPosA ? plan.stripA[0] : plan.stripB[0];
    return isPosA ? plan.stripA[segments] : plan.stripB[segments];
  };
  const cornerIdxFor = (plan, isPosA, isFace1) => {
    if (isFace1) return isPosA ? plan.iA1 : plan.iB1;
    return isPosA ? plan.iA2 : plan.iB2;
  };
  const thirdVertFor = (plan, isFace1) =>
    isFace1 ? plan.ic1 : plan.ic2;
  const normalFor = (plan, isFace1) => (isFace1 ? plan.N1 : plan.N2);

  for (let i = 0; i < plans.length; i++) {
    for (let j = i + 1; j < plans.length; j++) {
      const A = plans[i],
        B = plans[j];
      // Iterate each corner of A vs each corner of B looking for shared
      // positions.
      for (const aIsPosA of [true, false]) {
        for (const bIsPosA of [true, false]) {
          const aPos = aIsPosA ? A.posA : A.posB;
          const bPos = bIsPosA ? B.posA : B.posB;
          if (aPos.distanceTo(bPos) > 1e-4) continue;
          // Found a shared corner. Find shared bevel face(s) — both A and B
          // must touch the same face plane at this corner.
          for (const aIsFace1 of [true, false]) {
            for (const bIsFace1 of [true, false]) {
              const nA = normalFor(A, aIsFace1);
              const nB = normalFor(B, bIsFace1);
              if (nA.dot(nB) < 0.999) continue;
              // Strip vertices of A and B on this shared face at this corner.
              const sA = stripEndpointFor(A, aIsPosA, aIsFace1);
              const sB = stripEndpointFor(B, bIsPosA, bIsFace1);
              // Original corner vertex index (as used in A's T1/T2) and the
              // face's third vertex (the diagonal-opposite corner of the
              // shared face's triangulation).
              const cornerIdx = cornerIdxFor(A, aIsPosA, aIsFace1);
              const thirdA = thirdVertFor(A, aIsFace1);
              const thirdB = thirdVertFor(B, bIsFace1);
              // We only emit the diagonal-bridge triangle when both A and B
              // share the same third vertex (true for BoxGeometry's 2-tri
              // face triangulation).  The corner-fill triangle is always safe.
              const emitWith = (v0, v1, v2) => {
                // Choose winding so the triangle's normal aligns with nA
                // (the outward face normal).
                const p0 = new THREE.Vector3(
                  posArr[v0 * 3],
                  posArr[v0 * 3 + 1],
                  posArr[v0 * 3 + 2],
                );
                const p1 = new THREE.Vector3(
                  posArr[v1 * 3],
                  posArr[v1 * 3 + 1],
                  posArr[v1 * 3 + 2],
                );
                const p2 = new THREE.Vector3(
                  posArr[v2 * 3],
                  posArr[v2 * 3 + 1],
                  posArr[v2 * 3 + 2],
                );
                const n = new THREE.Vector3().crossVectors(
                  new THREE.Vector3().subVectors(p1, p0),
                  new THREE.Vector3().subVectors(p2, p0),
                );
                if (n.dot(nA) >= 0) idxArr.push(v0, v1, v2);
                else idxArr.push(v0, v2, v1);
              };
              // Corner-fill: small triangle at the original corner.
              emitWith(sA, cornerIdx, sB);
              // Diagonal bridge: only if both T1s share a third vertex.
              if (thirdA === thirdB) emitWith(sA, thirdA, sB);
            }
          }
        }
      }
    }
  }

  // ── Phase 4: perpendicular-face re-triangulation ────────────────────────
  // Run AFTER Phase 2 + Phase 3 are complete so that the idxArr.splice calls
  // inside retriangulateCorner don't invalidate Phase 2's captured triBase
  // indices (which they would do if invoked mid-iteration).
  //
  // The re-triangulator operates on the CURRENT state of idxArr and matches
  // perpendicular-face triangles by VERTEX POSITION (matchesCorner), so it
  // remains correct after each prior splice + push within Phase 4.
  for (const plan of plans) {
    plan.retriangulateCorner(
      plan.PA,
      plan.stripA[0],
      plan.stripA[segments],
      plan.N1,
      plan.N2,
    );
    plan.retriangulateCorner(
      plan.PB,
      plan.stripB[0],
      plan.stripB[segments],
      plan.N1,
      plan.N2,
    );
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
