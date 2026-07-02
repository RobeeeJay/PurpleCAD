// Face / edge / point hover-highlight overlays drawn on top of the
// 3D meshes when the cursor passes over a selectable sub-geometry.
// applyXxxHighlight builds a fresh THREE object, records what was
// hit in `pendingXxxSelection` (consumed by onMouseUp to commit the
// click to the store), and stashes the object on the matching ref so
// the cleanup pass disposes it.

import * as THREE from "three";
import { useStore } from "../../store";
import { fullCircleSegments, DISPLAY_PRECISION_MM } from "../sceneObjects.js";
import { activePrecision } from "../resolution.js";
import { computeSegmentChain } from "../segmentChain.js";
import { CHAMFER_EDGE_HOVER, CHAMFER_PREVIEW_COLOR } from "../theme.js";

export function createHighlightHelpers({
  scene,
  faceHighlightRef,
  edgeHighlightRef,
  pointHighlightRef,
  itemsRef,
}) {
  // Persistent data from the most-recent hover highlight, used to commit
  // face/edge selection to the store when the user clicks.
  let pendingFaceSelection = null; // { itemId, nx, ny, nz }
  let pendingEdgeSelection = null; // { itemId, ax, ay, az, bx, by, bz }

  const clearHL = (ref) => {
    if (ref.current) {
      scene.remove(ref.current);
      ref.current.geometry.dispose();
      ref.current.material.dispose();
      ref.current = null;
    }
  };

  const clearFaceHighlight = () => {
    clearHL(faceHighlightRef);
    pendingFaceSelection = null;
  };
  const clearEdgeHighlight = () => {
    clearHL(edgeHighlightRef);
    pendingEdgeSelection = null;
  };
  const clearPointHighlight = () => clearHL(pointHighlightRef);

  const primitiveGeoForHighlight = (type) => {
    // Hover & selection highlights are DISPLAY overlays on the smooth
    // shader render — they must visually match the shader, not the
    // (potentially coarse) CSG/bevel resolution.  Always tessellate at
    // DISPLAY_PRECISION_MM, or finer if the user has print mode enabled.
    // Radii MUST exactly match the shader's primitive dimensions (sphere
    // r=1.5, cylinder r=1 h=2, torus r=1 tube=0.4); the previous tiny
    // inflation (1.53, 1.015, 1.01/0.42) was a z-fighting workaround for
    // depth-tested materials, but the highlight material uses
    // depthTest:false + high renderOrder, so an inflated overlay just
    // visibly extends past the actual primitive.
    const printPrecisionMm = activePrecision();
    const displayPrecision =
      printPrecisionMm != null
        ? Math.min(printPrecisionMm, DISPLAY_PRECISION_MM)
        : DISPLAY_PRECISION_MM;
    if (type === "sphere") {
      const w = fullCircleSegments(1.5, displayPrecision, 32);
      const h = Math.max(8, Math.round(w / 2));
      return new THREE.SphereGeometry(1.5, w, h);
    }
    if (type === "cylinder") {
      const s = fullCircleSegments(1, displayPrecision, 32);
      return new THREE.CylinderGeometry(1, 1, 2, s);
    }
    if (type === "torus") {
      // THREE.TorusGeometry ring is in XY plane; our torus shader ring is in
      // XZ plane.  Rotate -90° around X to align.
      const tubular = fullCircleSegments(1.0, displayPrecision, 32);
      const radial = fullCircleSegments(0.4, displayPrecision, 16);
      const geo = new THREE.TorusGeometry(1.0, 0.4, radial, tubular);
      geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      return geo;
    }
    return null;
  };

  const applyFaceHighlight = (hit, color) => {
    const hitMesh = hit.object;
    const hitNormal = hit.face.normal;
    const itemData = itemsRef.current.find(
      (i) => i.id === hitMesh.userData.itemId,
    );
    const primitiveType = ["sphere", "cylinder", "torus", "cone"].includes(
      itemData?.type,
    )
      ? itemData.type
      : null;

    const workGeo = primitiveType
      ? primitiveGeoForHighlight(primitiveType)
      : hitMesh.geometry;
    const posAttr = workGeo.getAttribute("position");
    const indexAttr = workGeo.index;
    const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
    const vA = new THREE.Vector3(),
      vB = new THREE.Vector3(),
      vC = new THREE.Vector3();
    const triNormal = new THREE.Vector3();
    const matchVerts = [];

    // For primitives, convert world-space hit normal to local space for region matching
    let localNormal = hitNormal;
    if (primitiveType) {
      const invMatrix = new THREE.Matrix4().copy(hitMesh.matrixWorld).invert();
      localNormal = hitNormal.clone().transformDirection(invMatrix).normalize();
    }
    // Sample point on the highlighted face, in mesh-local — used to
    // disambiguate coplanar disconnected faces in the OCC chamfer step
    // (two faces can share a normal but be distinct).  Some callers
    // (unit tests) build a synthetic hit without a `point` field; fall
    // back to the origin and let the BFS branch overwrite with the
    // centroid of the connected face.
    let centroidSample;
    if (hit.point) {
      const localHit = hitMesh.worldToLocal(hit.point.clone());
      centroidSample = { x: localHit.x, y: localHit.y, z: localHit.z };
    } else {
      centroidSample = { x: 0, y: 0, z: 0 };
    }

    // Helper to read triangle i's three vertex indices.
    const triIdx = (i) =>
      indexAttr
        ? [
            indexAttr.getX(i * 3),
            indexAttr.getX(i * 3 + 1),
            indexAttr.getX(i * 3 + 2),
          ]
        : [i * 3, i * 3 + 1, i * 3 + 2];

    if (primitiveType === "cylinder") {
      for (let i = 0; i < triCount; i++) {
        const [a, b, c] = triIdx(i);
        vA.set(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a));
        vB.set(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b));
        vC.set(posAttr.getX(c), posAttr.getY(c), posAttr.getZ(c));
        triNormal
          .crossVectors(
            new THREE.Vector3().subVectors(vB, vA),
            new THREE.Vector3().subVectors(vC, vA),
          )
          .normalize();
        // Separate top cap / bottom cap / side by local normal Y component.
        const topHit = localNormal.y > 0.9,
          botHit = localNormal.y < -0.9;
        const isTop = triNormal.y > 0.9,
          isBot = triNormal.y < -0.9,
          isSide = Math.abs(triNormal.y) < 0.1;
        if (
          (topHit && isTop) ||
          (botHit && isBot) ||
          (!topHit && !botHit && isSide)
        )
          matchVerts.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);
      }
    } else if (primitiveType) {
      // Sphere / torus: entire surface is one face region.
      for (let i = 0; i < triCount; i++) {
        const [a, b, c] = triIdx(i);
        vA.set(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a));
        vB.set(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b));
        vC.set(posAttr.getX(c), posAttr.getY(c), posAttr.getZ(c));
        matchVerts.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);
      }
    } else {
      // BFS from the hit triangle along shared edges to find every
      // connected triangle with the same normal.  Plain normal-equality
      // would light up *every* coplanar triangle (e.g. all parts of a
      // stepped CSG result that point the same way, or a holed extrude's
      // outer + hole tops) even when they're physically disconnected
      // faces.  Connectivity restricts the highlight to the actual face
      // the cursor is on.
      // Precompute per-triangle normals.
      const triNormals = new Array(triCount);
      for (let i = 0; i < triCount; i++) {
        const [a, b, c] = triIdx(i);
        vA.set(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a));
        vB.set(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b));
        vC.set(posAttr.getX(c), posAttr.getY(c), posAttr.getZ(c));
        const n = new THREE.Vector3()
          .crossVectors(
            new THREE.Vector3().subVectors(vB, vA),
            new THREE.Vector3().subVectors(vC, vA),
          )
          .normalize();
        triNormals[i] = n;
      }

      // Seed the BFS from the raycast's reported triangle when it
      // matches the hit normal.  Otherwise (synthetic test hits with no
      // faceIndex, or a triangle on a flipped winding) find any
      // triangle whose normal matches hitNormal and use that.
      let seedTri = -1;
      if (
        typeof hit.faceIndex === "number" &&
        triNormals[hit.faceIndex] &&
        triNormals[hit.faceIndex].dot(hitNormal) > 0.999
      ) {
        seedTri = hit.faceIndex;
      } else {
        for (let i = 0; i < triCount; i++) {
          if (triNormals[i].dot(hitNormal) > 0.999) {
            seedTri = i;
            break;
          }
        }
      }
      if (seedTri < 0) {
        clearFaceHighlight();
        return;
      }

      // Build edge → adjacent-triangle map.  Vertex-pair key uses the
      // POSITION (rounded), not the index, so coplanar triangles that
      // share an edge via duplicated/welded verts still connect — e.g.
      // ExtrudeGeometry sometimes splits seam vertices across faces.
      const round = (v) => Math.round(v * 1000) / 1000;
      const vertKey = (idx) =>
        `${round(posAttr.getX(idx))},${round(posAttr.getY(idx))},${round(posAttr.getZ(idx))}`;
      const edgeKey = (i1, i2) => {
        const k1 = vertKey(i1),
          k2 = vertKey(i2);
        return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      };
      const edgeToTris = new Map();
      const triEdges = new Array(triCount);
      for (let i = 0; i < triCount; i++) {
        const [a, b, c] = triIdx(i);
        const e1 = edgeKey(a, b),
          e2 = edgeKey(b, c),
          e3 = edgeKey(c, a);
        triEdges[i] = [e1, e2, e3];
        for (const k of [e1, e2, e3]) {
          let list = edgeToTris.get(k);
          if (!list) {
            list = [];
            edgeToTris.set(k, list);
          }
          list.push(i);
        }
      }

      // BFS from seed across shared edges.  Curve detection applies to faces
      // just like edges: follow a neighbour when the LOCAL dihedral (this
      // triangle vs the neighbour) is within the curve-detection angle, so a
      // tessellated cylinder / fillet / wave selects as one face while a sharp
      // edge (a larger bend than the setting) stops it.
      const seedN = triNormals[seedTri];
      const maxAngle = useStore.getState().curveDetectionAngleDeg ?? 5;
      const cosThr = Math.cos((Math.max(0, maxAngle) * Math.PI) / 180);
      const visited = new Set([seedTri]);
      const queue = [seedTri];
      while (queue.length > 0) {
        const t = queue.shift();
        const [a, b, c] = triIdx(t);
        vA.set(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a));
        vB.set(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b));
        vC.set(posAttr.getX(c), posAttr.getY(c), posAttr.getZ(c));
        matchVerts.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);
        for (const ek of triEdges[t]) {
          const adj = edgeToTris.get(ek);
          if (!adj) continue;
          for (const nt of adj) {
            if (visited.has(nt)) continue;
            if (triNormals[nt].dot(triNormals[t]) > cosThr) {
              visited.add(nt);
              queue.push(nt);
            }
          }
        }
      }
      // `centroidSample` stays as the hit point in mesh-local (set
      // above from hit.point).  We deliberately do NOT use the BFS
      // average of visited vertices: for non-convex faces (L-shapes
      // and CSG step regions) that average can land in the concave
      // part OUTSIDE the actual face, and the click-commit highlight
      // / OCC chamfer matcher would then pick the wrong coplanar
      // face.  hit.point is guaranteed to lie on the face the user
      // clicked.
      // Use seedN as the canonical normal so anti-parallel-vs-parallel
      // ambiguity (the cross-product can flip sign on degenerate
      // triangles) is consistent.
      localNormal = seedN;
    }
    if (primitiveType) workGeo.dispose();

    clearFaceHighlight();
    if (matchVerts.length > 0) {
      const hlGeo = new THREE.BufferGeometry();
      hlGeo.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(matchVerts), 3),
      );
      const hlMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        depthTest: primitiveType ? false : true,
        side: THREE.DoubleSide,
        polygonOffset: !primitiveType,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const hlMesh = new THREE.Mesh(hlGeo, hlMat);
      hlMesh.position.copy(hitMesh.position);
      hlMesh.rotation.copy(hitMesh.rotation);
      hlMesh.scale.copy(hitMesh.scale);
      hlMesh.renderOrder = 996;
      scene.add(hlMesh);
      faceHighlightRef.current = hlMesh;
      // Record for click-to-select.  cx/cy/cz is a point on the
      // highlighted face (centroid of the connected region, or the
      // raw hit point for primitives) — chamferShapeBy uses it to
      // pick the correct face when multiple share the same normal.
      pendingFaceSelection = {
        itemId: hitMesh.userData.itemId,
        nx: localNormal.x,
        ny: localNormal.y,
        nz: localNormal.z,
        cx: centroidSample.x,
        cy: centroidSample.y,
        cz: centroidSample.z,
      };
    }
  };

  const distToSeg = (p, a, b) => {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ap = new THREE.Vector3().subVectors(p, a);
    const t = Math.max(
      0,
      Math.min(1, ap.dot(ab) / Math.max(ab.lengthSq(), 1e-10)),
    );
    return p.distanceTo(
      new THREE.Vector3().addVectors(a, ab.multiplyScalar(t)),
    );
  };

  const applyEdgeHighlight = (hit) => {
    clearEdgeHighlight();
    const hitMesh = hit.object;
    const localHit = hitMesh.worldToLocal(hit.point.clone());
    const itemData = itemsRef.current.find(
      (i) => i.id === hitMesh.userData.itemId,
    );
    const primitiveType = ["sphere", "cylinder", "torus", "cone"].includes(
      itemData?.type,
    )
      ? itemData.type
      : null;
    const srcGeo = primitiveType
      ? primitiveGeoForHighlight(primitiveType)
      : hitMesh.geometry;
    const edgesGeo = new THREE.EdgesGeometry(srcGeo);
    if (primitiveType) srcGeo.dispose();
    const posAttr = edgesGeo.getAttribute("position");
    const segs = [];
    for (let i = 0; i < posAttr.count; i += 2) {
      segs.push({
        ax: posAttr.getX(i),
        ay: posAttr.getY(i),
        az: posAttr.getZ(i),
        bx: posAttr.getX(i + 1),
        by: posAttr.getY(i + 1),
        bz: posAttr.getZ(i + 1),
      });
    }
    edgesGeo.dispose();

    // Nearest feature-edge segment to the cursor.
    let minDist = Infinity;
    let bestIdx = -1;
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      va.set(s.ax, s.ay, s.az);
      vb.set(s.bx, s.by, s.bz);
      const d = distToSeg(localHit, va, vb);
      if (d < minDist) {
        minDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) return null;

    // Curve detection: highlight (and select) the whole smooth chain of
    // connected edges, so a tessellated curve reads/selects as one edge.
    const maxAngle = useStore.getState().curveDetectionAngleDeg ?? 5;
    const chainIdx = computeSegmentChain(segs, bestIdx, maxAngle);
    const positions = [];
    chainIdx.forEach((i) => {
      const s = segs[i];
      positions.push(s.ax, s.ay, s.az, s.bx, s.by, s.bz);
    });

    const hlGeo = new THREE.BufferGeometry();
    hlGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(positions), 3),
    );
    const hlLine = new THREE.LineSegments(
      hlGeo,
      new THREE.LineBasicMaterial({
        color: CHAMFER_EDGE_HOVER,
        depthTest: false,
      }),
    );
    hlLine.position.copy(hitMesh.position);
    hlLine.rotation.copy(hitMesh.rotation);
    hlLine.scale.copy(hitMesh.scale);
    hlLine.renderOrder = 998;
    scene.add(hlLine);
    edgeHighlightRef.current = hlLine;

    // Record for click-to-select.  Keep the nearest segment as the primary
    // (ax..bz, for any single-edge consumer) and carry the full chain in
    // `edges` so committing the selection chamfers/fillets the whole curve.
    const best = segs[bestIdx];
    pendingEdgeSelection = {
      itemId: hitMesh.userData.itemId,
      ax: best.ax,
      ay: best.ay,
      az: best.az,
      bx: best.bx,
      by: best.by,
      bz: best.bz,
      edges: chainIdx.map((i) => {
        const s = segs[i];
        return {
          ax: s.ax,
          ay: s.ay,
          az: s.az,
          bx: s.bx,
          by: s.by,
          bz: s.bz,
        };
      }),
    };
    // World-space distance from the cursor's hit point to the nearest edge —
    // used by the selection-widget priority (point > edge > face).
    va.set(best.ax, best.ay, best.az).applyMatrix4(hitMesh.matrixWorld);
    vb.set(best.bx, best.by, best.bz).applyMatrix4(hitMesh.matrixWorld);
    const ab = vb.clone().sub(va);
    const t = Math.max(
      0,
      Math.min(1, hit.point.clone().sub(va).dot(ab) / (ab.lengthSq() || 1)),
    );
    return hit.point.distanceTo(va.add(ab.multiplyScalar(t)));
  };

  const applyPointHighlight = (hit) => {
    clearPointHighlight();
    const hitMesh = hit.object;
    const localHit = hitMesh.worldToLocal(hit.point.clone());
    const itemData = itemsRef.current.find(
      (i) => i.id === hitMesh.userData.itemId,
    );
    const primitiveType = ["sphere", "cylinder", "torus", "cone"].includes(
      itemData?.type,
    )
      ? itemData.type
      : null;
    const srcGeo = primitiveType
      ? primitiveGeoForHighlight(primitiveType)
      : hitMesh.geometry;
    const posAttr = srcGeo.getAttribute("position");
    let minDist = Infinity,
      bestV = null;
    const seen = new Set();
    for (let i = 0; i < posAttr.count; i++) {
      const v = new THREE.Vector3(
        posAttr.getX(i),
        posAttr.getY(i),
        posAttr.getZ(i),
      );
      const key = `${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = v.distanceTo(localHit);
      if (d < minDist) {
        minDist = d;
        bestV = v.clone();
      }
    }
    if (primitiveType) srcGeo.dispose();
    if (!bestV) return null;
    const worldV = bestV.clone().applyMatrix4(hitMesh.matrixWorld);
    const hlMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 10, 8),
      new THREE.MeshBasicMaterial({
        color: CHAMFER_PREVIEW_COLOR,
        depthTest: false,
      }),
    );
    hlMesh.position.copy(worldV);
    hlMesh.renderOrder = 999;
    scene.add(hlMesh);
    pointHighlightRef.current = hlMesh;
    // World-space distance from the cursor's hit point to the chosen vertex —
    // the selection-widget priority uses it to gate point vs edge vs face.
    return hit.point.distanceTo(worldV);
  };

  // Show the point-highlight marker at an arbitrary world position (eg a sketch
  // point the hole tool snaps to, which isn't a mesh vertex).
  const highlightWorldPoint = (world) => {
    clearPointHighlight();
    const hlMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 10, 8),
      new THREE.MeshBasicMaterial({
        color: CHAMFER_PREVIEW_COLOR,
        depthTest: false,
      }),
    );
    hlMesh.position.copy(world);
    hlMesh.renderOrder = 999;
    scene.add(hlMesh);
    pointHighlightRef.current = hlMesh;
  };

  // Highlight an arbitrary connected face set (the emboss tool grows it across
  // a curved surface) from its triangle positions in the mesh's local frame.
  // A PERSISTENT highlight of the accumulated emboss multi-face selection (the
  // hover highlight on faceHighlightRef is transient and cleared every move; this
  // one stays until the selection changes or the tool ends).
  let selectedFacesMesh = null;
  const clearSelectedFaces = () => {
    if (selectedFacesMesh) {
      scene.remove(selectedFacesMesh);
      selectedFacesMesh.geometry.dispose();
      selectedFacesMesh.material.dispose();
      selectedFacesMesh = null;
    }
  };
  const highlightSelectedFaces = (mesh, positionsLocal, color) => {
    clearSelectedFaces();
    if (!mesh || !positionsLocal || positionsLocal.length < 9) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(positionsLocal), 3),
    );
    const m = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    m.position.copy(mesh.position);
    m.rotation.copy(mesh.rotation);
    m.scale.copy(mesh.scale);
    m.renderOrder = 995;
    scene.add(m);
    selectedFacesMesh = m;
  };

  const highlightFaceSet = (mesh, positionsLocal, color) => {
    clearFaceHighlight();
    if (!positionsLocal || positionsLocal.length < 9) return;
    const hlGeo = new THREE.BufferGeometry();
    hlGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(positionsLocal), 3),
    );
    const hlMesh = new THREE.Mesh(
      hlGeo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    hlMesh.position.copy(mesh.position);
    hlMesh.rotation.copy(mesh.rotation);
    hlMesh.scale.copy(mesh.scale);
    hlMesh.renderOrder = 996;
    scene.add(hlMesh);
    faceHighlightRef.current = hlMesh;
  };

  return {
    clearFaceHighlight,
    clearEdgeHighlight,
    clearPointHighlight,
    highlightWorldPoint,
    highlightFaceSet,
    highlightSelectedFaces,
    clearSelectedFaces,
    // Visual-only clearer (does NOT reset pendingFaceSelection /
    // pendingEdgeSelection).  Used by the modifier-keyup handler in
    // cameraControls.js so a stray keyup between hover and click doesn't
    // wipe the pending selection.
    clearHL,
    applyFaceHighlight,
    applyEdgeHighlight,
    applyPointHighlight,
    get pendingFaceSelection() {
      return pendingFaceSelection;
    },
    get pendingEdgeSelection() {
      return pendingEdgeSelection;
    },
  };
}
