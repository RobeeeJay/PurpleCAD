// Face / edge / point hover-highlight overlays drawn on top of the
// 3D meshes when the cursor passes over a selectable sub-geometry.
// applyXxxHighlight builds a fresh THREE object, records what was
// hit in `pendingXxxSelection` (consumed by onMouseUp to commit the
// click to the store), and stashes the object on the matching ref so
// the cleanup pass disposes it.

import * as THREE from "three";
import { useStore } from "../../store";
import { fullCircleSegments, DISPLAY_PRECISION_MM } from "../sceneObjects.js";

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
    const printPrecisionMm =
      useStore.getState().curveResolution === "print" ? 0.01 : null;
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
    const primitiveType = ["sphere", "cylinder", "torus"].includes(
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

    for (let i = 0; i < triCount; i++) {
      let a, b, c;
      if (indexAttr) {
        a = indexAttr.getX(i * 3);
        b = indexAttr.getX(i * 3 + 1);
        c = indexAttr.getX(i * 3 + 2);
      } else {
        a = i * 3;
        b = i * 3 + 1;
        c = i * 3 + 2;
      }
      vA.set(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a));
      vB.set(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b));
      vC.set(posAttr.getX(c), posAttr.getY(c), posAttr.getZ(c));
      triNormal
        .crossVectors(
          new THREE.Vector3().subVectors(vB, vA),
          new THREE.Vector3().subVectors(vC, vA),
        )
        .normalize();
      if (primitiveType === "cylinder") {
        // Separate top cap / bottom cap / side by local normal Y component
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
      } else if (primitiveType) {
        // Sphere / torus: entire surface is one face region
        matchVerts.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);
      } else {
        // Signed dot — anti-parallel triangles belong to the OPPOSITE
        // face (e.g. the cube's back face when the user is hovering the
        // front).  Math.abs here would light both faces simultaneously.
        if (triNormal.dot(localNormal) > 0.999)
          matchVerts.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);
      }
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
      // Record for click-to-select
      pendingFaceSelection = {
        itemId: hitMesh.userData.itemId,
        nx: localNormal.x,
        ny: localNormal.y,
        nz: localNormal.z,
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
    const primitiveType = ["sphere", "cylinder", "torus"].includes(
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
    let minDist = Infinity,
      bestA = null,
      bestB = null;
    for (let i = 0; i < posAttr.count; i += 2) {
      const a = new THREE.Vector3(
        posAttr.getX(i),
        posAttr.getY(i),
        posAttr.getZ(i),
      );
      const b = new THREE.Vector3(
        posAttr.getX(i + 1),
        posAttr.getY(i + 1),
        posAttr.getZ(i + 1),
      );
      const d = distToSeg(localHit, a, b);
      if (d < minDist) {
        minDist = d;
        bestA = a;
        bestB = b;
      }
    }
    edgesGeo.dispose();
    if (bestA) {
      const hlGeo = new THREE.BufferGeometry();
      hlGeo.setAttribute(
        "position",
        new THREE.BufferAttribute(
          new Float32Array([
            bestA.x,
            bestA.y,
            bestA.z,
            bestB.x,
            bestB.y,
            bestB.z,
          ]),
          3,
        ),
      );
      const hlLine = new THREE.LineSegments(
        hlGeo,
        new THREE.LineBasicMaterial({ color: 0xffdd00, depthTest: false }),
      );
      hlLine.position.copy(hitMesh.position);
      hlLine.rotation.copy(hitMesh.rotation);
      hlLine.scale.copy(hitMesh.scale);
      hlLine.renderOrder = 998;
      scene.add(hlLine);
      edgeHighlightRef.current = hlLine;
      // Record for click-to-select
      pendingEdgeSelection = {
        itemId: hitMesh.userData.itemId,
        ax: bestA.x,
        ay: bestA.y,
        az: bestA.z,
        bx: bestB.x,
        by: bestB.y,
        bz: bestB.z,
      };
    }
  };

  const applyPointHighlight = (hit) => {
    clearPointHighlight();
    const hitMesh = hit.object;
    const localHit = hitMesh.worldToLocal(hit.point.clone());
    const itemData = itemsRef.current.find(
      (i) => i.id === hitMesh.userData.itemId,
    );
    const primitiveType = ["sphere", "cylinder", "torus"].includes(
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
    if (bestV) {
      bestV.applyMatrix4(hitMesh.matrixWorld);
      const hlMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xff44aa, depthTest: false }),
      );
      hlMesh.position.copy(bestV);
      hlMesh.renderOrder = 999;
      scene.add(hlMesh);
      pointHighlightRef.current = hlMesh;
    }
  };

  return {
    clearFaceHighlight,
    clearEdgeHighlight,
    clearPointHighlight,
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
