import * as THREE from "three";

// Returns a geometry to source overlay triangles from.  For primitive types
// (sphere/cylinder/torus) the on-mesh geometry is just a BoxGeometry stand-in
// — the actual visible surface is drawn by a shader, so we must synthesize
// the real shape here.  For everything else we use the mesh's own geometry.
function overlayGeometryFor(hitMesh, itemType) {
  if (itemType === "sphere") return new THREE.SphereGeometry(1.53, 20, 16);
  if (itemType === "cylinder")
    return new THREE.CylinderGeometry(1.015, 1.015, 2.03, 24);
  if (itemType === "torus") {
    const g = new THREE.TorusGeometry(1.01, 0.42, 16, 32);
    g.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    return g;
  }
  return hitMesh.geometry;
}

const PRIMITIVE_TYPES = new Set(["sphere", "cylinder", "torus"]);

// Build persistent highlight objects for the user's current sub-geometry
// selection (faces and/or edges). Returns a THREE.Group placed at the same
// world transform as `hitMesh`, with one MeshBasicMaterial face overlay and
// one LineSegments edge overlay (each only added when there's something to
// show). Colours are slightly darker than the hover colours so the user can
// distinguish "hovered" from "selected".
//
// `options.itemType` ("cube"/"sphere"/"cylinder"/"torus"/"csg"/"extrude") lets
// the function pick the right overlay geometry for primitives, which render
// via shaders and don't have iterable triangles on their on-mesh geometry.
//
// Returns null if there is nothing to highlight (no faces matched and no
// edges given). Caller is responsible for disposing geometries/materials
// when the group is removed.
export function buildSelectionHighlight(hitMesh, subGeo, options = {}) {
  if (!hitMesh || !subGeo) return null;
  const faces = subGeo.faces || [];
  const edges = subGeo.edges || [];
  if (!faces.length && !edges.length) return null;

  // Face-select hover uses light blue 0x88ccff; the selected colour is a
  // visibly darker version of the same blue so the user recognises this as
  // "selected" (and not a different selection mode).
  const faceColor = options.faceColor ?? 0x3377cc;
  // Edge-select hover uses bright yellow 0xffdd00; selected is a darker
  // mustard.
  const edgeColor = options.edgeColor ?? 0xaa8800;

  const group = new THREE.Group();

  // ── Face overlay ────────────────────────────────────────────────────────
  if (faces.length) {
    const isPrimitive = PRIMITIVE_TYPES.has(options.itemType);
    const geo = overlayGeometryFor(hitMesh, options.itemType);
    const posAttr = geo.getAttribute("position");
    const indexAttr = geo.index;
    const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    const triNormal = new THREE.Vector3();
    const matchVerts = [];
    // For sphere/torus the whole surface is one "face"; for cylinder split
    // by top-cap / bottom-cap / side using the stored hit-normal's Y.
    const storedN = faces[0];
    for (let i = 0; i < triCount; i++) {
      const a = indexAttr ? indexAttr.getX(i * 3) : i * 3;
      const b = indexAttr ? indexAttr.getX(i * 3 + 1) : i * 3 + 1;
      const c = indexAttr ? indexAttr.getX(i * 3 + 2) : i * 3 + 2;
      vA.set(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a));
      vB.set(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b));
      vC.set(posAttr.getX(c), posAttr.getY(c), posAttr.getZ(c));
      triNormal
        .crossVectors(
          new THREE.Vector3().subVectors(vB, vA),
          new THREE.Vector3().subVectors(vC, vA),
        )
        .normalize();
      let matches;
      if (isPrimitive && options.itemType === "cylinder") {
        const topHit = storedN.ny > 0.9,
          botHit = storedN.ny < -0.9;
        const isTop = triNormal.y > 0.9,
          isBot = triNormal.y < -0.9,
          isSide = Math.abs(triNormal.y) < 0.1;
        matches =
          (topHit && isTop) ||
          (botHit && isBot) ||
          (!topHit && !botHit && isSide);
      } else if (isPrimitive) {
        // Sphere / torus: entire surface is one face region.
        matches = true;
      } else {
        matches = faces.some(
          (f) =>
            Math.abs(triNormal.x - f.nx) < 0.01 &&
            Math.abs(triNormal.y - f.ny) < 0.01 &&
            Math.abs(triNormal.z - f.nz) < 0.01,
        );
      }
      if (matches)
        matchVerts.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);
    }
    if (isPrimitive) geo.dispose();
    if (matchVerts.length > 0) {
      const hlGeo = new THREE.BufferGeometry();
      hlGeo.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(matchVerts), 3),
      );
      const hlMat = new THREE.MeshBasicMaterial({
        color: faceColor,
        transparent: true,
        // Higher opacity than the hover overlay (0.5) so when the hover is
        // cleared on click, the persistent selection is unmistakeably visible
        // — and so on its own (with no hover above it) the user still
        // immediately sees a colored face rather than a faint tint.
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthTest: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const hlMesh = new THREE.Mesh(hlGeo, hlMat);
      hlMesh.renderOrder = 995;
      group.add(hlMesh);
    }
  }

  // ── Edge overlay ────────────────────────────────────────────────────────
  if (edges.length) {
    const positions = [];
    for (const e of edges) {
      positions.push(e.ax, e.ay, e.az, e.bx, e.by, e.bz);
    }
    const hlGeo = new THREE.BufferGeometry();
    hlGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(positions), 3),
    );
    const hlLine = new THREE.LineSegments(
      hlGeo,
      new THREE.LineBasicMaterial({
        color: edgeColor,
        depthTest: false,
        linewidth: 2,
      }),
    );
    hlLine.renderOrder = 997;
    group.add(hlLine);
  }

  if (group.children.length === 0) return null;

  // Match hitMesh's world transform so the highlight lines up with it.
  group.position.copy(hitMesh.position);
  group.rotation.copy(hitMesh.rotation);
  group.scale.copy(hitMesh.scale);

  return group;
}

// Dispose all geometries/materials in a highlight group (for cleanup).
export function disposeHighlightGroup(group) {
  if (!group) return;
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  });
}

// Reconcile the scene's persistent selection-highlight to match the current
// `selectedSubGeometry`.  Removes the previous highlight (if any), builds a
// new one from the matching mesh in `objectsRef`, and adds it to the scene.
//
// Returns the new highlight group (or null when there's nothing to show).
// Callers should remember this so they can pass it back in as `previousGroup`
// on the next call.
//
// This is the exact reconciliation Viewport.jsx runs inside its useEffect —
// extracted so it can be unit-tested in isolation from React.
export function reconcileSelectionHighlight(
  scene,
  previousGroup,
  selectedSubGeometry,
  objectsRef,
  items,
  options,
) {
  if (previousGroup) {
    scene.remove(previousGroup);
    disposeHighlightGroup(previousGroup);
  }
  if (!selectedSubGeometry) return null;
  const itemId = selectedSubGeometry.itemId;
  const hitMesh = objectsRef && objectsRef[itemId];
  if (!hitMesh) return null;
  // Look up the item type so the builder can pick the right overlay geometry
  // for primitives (sphere / cylinder / torus).
  const item = items && items.find((i) => i.id === itemId);
  const merged = { ...(options || {}), itemType: item?.type };
  const group = buildSelectionHighlight(hitMesh, selectedSubGeometry, merged);
  if (!group) return null;
  scene.add(group);
  return group;
}
