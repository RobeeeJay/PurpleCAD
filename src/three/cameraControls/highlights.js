// Face / edge / point hover-highlight overlays drawn on top of the
// 3D meshes when the cursor passes over a selectable sub-geometry.
// applyXxxHighlight builds a fresh THREE object, records what was
// hit in `pendingXxxSelection` (consumed by onMouseUp to commit the
// click to the store), and stashes the object on the matching ref so
// the cleanup pass disposes it.

import * as THREE from "three";
import { useStore } from "../../store";
import { fullCircleSegments, DISPLAY_PRECISION_MM } from "../sceneObjects.js";
import { primitiveDimensions } from "../sceneObjects/dimensions.js";
import { activePrecision } from "../resolution.js";
import { computeSegmentChain } from "../segmentChain.js";
import {
  meshTopology,
  growFace,
  featureEdges,
  nearestSegment,
  nearestVertex,
} from "../meshPickCache.js";
import { selectionChainAngle } from "../../store/selectionMode.js";
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

  const primitiveGeoForHighlight = (item) => {
    // Hover & selection highlights are DISPLAY overlays on the smooth shader
    // render — they must visually match the shader, not the (potentially
    // coarse) CSG/bevel resolution.  Always tessellate at DISPLAY_PRECISION_MM,
    // or finer if the Resolution setting is finer.  Dimensions MUST come from
    // the item's actual primitiveDimensions (matching the shaders) — hardcoded
    // defaults leave the highlight the wrong size once the primitive is resized.
    const type = item?.type;
    const d = primitiveDimensions(item);
    const resolutionMm = activePrecision();
    const displayPrecision =
      resolutionMm != null
        ? Math.min(resolutionMm, DISPLAY_PRECISION_MM)
        : DISPLAY_PRECISION_MM;
    if (type === "sphere") {
      const w = fullCircleSegments(d.radius, displayPrecision, 32);
      const h = Math.max(8, Math.round(w / 2));
      return new THREE.SphereGeometry(d.radius, w, h);
    }
    if (type === "cylinder") {
      const s = fullCircleSegments(d.radius, displayPrecision, 32);
      return new THREE.CylinderGeometry(d.radius, d.radius, d.height, s);
    }
    if (type === "cone") {
      const s = fullCircleSegments(
        Math.max(d.radiusBottom, d.radiusTop),
        displayPrecision,
        32,
      );
      return new THREE.CylinderGeometry(
        d.radiusTop,
        d.radiusBottom,
        d.height,
        s,
      );
    }
    if (type === "torus") {
      // THREE.TorusGeometry ring is in XY plane; our torus shader ring is in
      // XZ plane.  Rotate -90° around X to align.
      const tubular = fullCircleSegments(d.major, displayPrecision, 32);
      const radial = fullCircleSegments(d.minor, displayPrecision, 16);
      const geo = new THREE.TorusGeometry(d.major, d.minor, radial, tubular);
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
      ? primitiveGeoForHighlight(itemData)
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
    } else if (primitiveType === "cone") {
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
        // The base cap and (if truncated) the top cap point straight ±Y; the
        // slanted side is everything else.  A cap hit's normal is pure ±Y, so
        // the side normals (which carry both radial + axial components) don't
        // register as a cap.
        const topHit = localNormal.y > 0.9,
          botHit = localNormal.y < -0.9;
        const isTop = triNormal.y > 0.9,
          isBot = triNormal.y < -0.9,
          isSide = !isTop && !isBot;
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
      // Normals and adjacency are cached per geometry (meshPickCache.js): built
      // here on every move they took seconds on a 1M-triangle import.
      const topo = meshTopology(workGeo);
      const n = topo.normals;
      const dotHit = (t) =>
        n[3 * t] * hitNormal.x +
        n[3 * t + 1] * hitNormal.y +
        n[3 * t + 2] * hitNormal.z;

      // Seed the BFS from the raycast's reported triangle when it
      // matches the hit normal.  Otherwise (synthetic test hits with no
      // faceIndex, or a triangle on a flipped winding) find any
      // triangle whose normal matches hitNormal and use that.
      let seedTri = -1;
      if (
        typeof hit.faceIndex === "number" &&
        hit.faceIndex < topo.triCount &&
        dotHit(hit.faceIndex) > 0.999
      ) {
        seedTri = hit.faceIndex;
      } else {
        for (let i = 0; i < topo.triCount; i++) {
          if (dotHit(i) > 0.999) {
            seedTri = i;
            break;
          }
        }
      }
      if (seedTri < 0) {
        clearFaceHighlight();
        return;
      }

      // Grow across shared edges.  Curve detection applies to faces just like
      // edges: follow a neighbour when the LOCAL dihedral (this triangle vs
      // the neighbour) is within the curve-detection angle, so a tessellated
      // cylinder / fillet / wave selects as one face while a sharp edge (a
      // larger bend than the setting) stops it.
      const maxAngle = selectionChainAngle(useStore.getState?.());
      const cosThr = Math.cos((Math.max(0, maxAngle) * Math.PI) / 180);
      for (const t of growFace(topo, seedTri, cosThr)) {
        const [a, b, c] = triIdx(t);
        matchVerts.push(
          posAttr.getX(a),
          posAttr.getY(a),
          posAttr.getZ(a),
          posAttr.getX(b),
          posAttr.getY(b),
          posAttr.getZ(b),
          posAttr.getX(c),
          posAttr.getY(c),
          posAttr.getZ(c),
        );
      }
      const seedN = new THREE.Vector3(
        n[3 * seedTri],
        n[3 * seedTri + 1],
        n[3 * seedTri + 2],
      );
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
        // The angle this highlight grew by: the native face matcher grows the
        // pick by the same rule, so a click on a bore's wall takes the whole
        // wall that lit up, not just the facet under the cursor.
        smoothDeg: selectionChainAngle(useStore.getState?.()),
      };
    }
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
      ? primitiveGeoForHighlight(itemData)
      : hitMesh.geometry;
    // Feature edges and their endpoint lookup are cached per geometry
    // (meshPickCache.js), where this used to rebuild EdgesGeometry -- 2.3 s on
    // a 1M-triangle import -- on every mouse move.
    const { segs, near } = featureEdges(srcGeo);
    if (primitiveType) srcGeo.dispose();
    const seg = (i) => ({
      ax: segs[6 * i],
      ay: segs[6 * i + 1],
      az: segs[6 * i + 2],
      bx: segs[6 * i + 3],
      by: segs[6 * i + 4],
      bz: segs[6 * i + 5],
    });

    // Nearest feature-edge segment to the cursor.
    const bestIdx = nearestSegment(
      segs,
      localHit.x,
      localHit.y,
      localHit.z,
    ).index;
    if (bestIdx < 0) return null;
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();

    // Curve detection: highlight (and select) the whole smooth chain of
    // connected edges, so a tessellated curve reads/selects as one edge.  With
    // the chain toggle off this collapses to just the clicked segment.
    const maxAngle = selectionChainAngle(useStore.getState?.());
    const chainIdx = computeSegmentChain(segs, bestIdx, maxAngle, near);
    const positions = [];
    chainIdx.forEach((i) => {
      for (let k = 0; k < 6; k++) positions.push(segs[6 * i + k]);
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
    const best = seg(bestIdx);
    pendingEdgeSelection = {
      itemId: hitMesh.userData.itemId,
      ax: best.ax,
      ay: best.ay,
      az: best.az,
      bx: best.bx,
      by: best.by,
      bz: best.bz,
      edges: chainIdx.map((i) => {
        const s = seg(i);
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
      ? primitiveGeoForHighlight(itemData)
      : hitMesh.geometry;
    const posAttr = srcGeo.getAttribute("position");
    const vi = nearestVertex(posAttr, localHit.x, localHit.y, localHit.z);
    const bestV =
      vi < 0
        ? null
        : new THREE.Vector3(
            posAttr.getX(vi),
            posAttr.getY(vi),
            posAttr.getZ(vi),
          );
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
