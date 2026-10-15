// Paints a solved stress field onto its body, and takes it off again.
//
// Kept out of the geometry builder: the field is a transient view of a load
// case, not part of the object, so it is applied as a pass over the built
// meshes the way applyRenderMode swaps materials -- and can be removed without
// rebuilding anything.

import * as THREE from "three";

// A body whose mesh has been rebuilt since the solve must not keep wearing the
// old field: the colours would be attached to different vertices.
export const geometrySignature = (positions) =>
  positions
    ? `${positions.length}:${positions[0]}:${positions[positions.length - 1]}`
    : "";

const strip = (mesh) => {
  if (!mesh?.userData?.stressMaterial) return;
  mesh.material = mesh.userData.stressMaterial;
  delete mesh.userData.stressMaterial;
  if (mesh.userData.stressGeometry) {
    mesh.geometry?.dispose();
    mesh.geometry = mesh.userData.stressGeometry;
    delete mesh.userData.stressGeometry;
  }
};

// Returns true when the field was applied, false when it was solved for a mesh
// this body no longer has (the caller drops the stale result).
export function applyStressDisplay(objectsRef, result, items) {
  let applied = false;
  for (const [id, mesh] of Object.entries(objectsRef.current ?? {})) {
    if (!mesh?.isMesh) continue;
    if (!result || Number(id) !== result.itemId) {
      strip(mesh);
      continue;
    }
    // Was this field solved for the mesh the body still has?  The source is
    // the baked mesh when there is one and the drawn surface otherwise (an
    // extrude has no baked mesh), so the signature has to be taken from
    // whichever one it came from.
    const item = items?.find((i) => i.id === result.itemId);
    const live = item?.geometryData?.positions?.length
      ? geometrySignature(item.geometryData.positions)
      : geometrySignature(
          mesh.userData.stressGeometry
            ? mesh.userData.stressGeometry.attributes.position.array
            : mesh.geometry?.attributes?.position?.array,
        );
    if (result.signature && live !== result.signature) {
      strip(mesh);
      continue;
    }
    // The plot is drawn on its OWN geometry -- the body's surface subdivided
    // to the field's resolution -- so the body's original mesh is kept aside
    // and put back when the field comes off.
    if (!mesh.userData.stressGeometry) {
      mesh.userData.stressGeometry = mesh.geometry;
      mesh.userData.stressMaterial = mesh.material;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.BufferAttribute(result.display.positions, 3),
    );
    geom.setAttribute(
      "color",
      new THREE.BufferAttribute(result.display.colors, 3),
    );
    geom.computeVertexNormals();
    if (mesh.geometry !== mesh.userData.stressGeometry) mesh.geometry.dispose();
    mesh.geometry = geom;
    // UNLIT, which for this ramp is the whole point.  Magnitude is encoded in
    // lightness, and under a lit material the shading encodes it too: the
    // first render of a loaded bar had its held end reading BRIGHTER than its
    // free end purely because that face pointed at the light, exactly
    // reversing what the field said.  With a basic material the colour on
    // screen is the value.
    mesh.material = new THREE.MeshBasicMaterial({ vertexColors: true });
    applied = true;
  }
  return applied;
}

// A preview of an optimised shape on the body it came from: the same geometry
// swap, so the original mesh is put back when the preview is dropped.  Shown
// before anything is committed, because applying a generative result you have
// not looked at is how a two-minute run gets thrown away.
export function applyOptimisePreview(objectsRef, preview) {
  let applied = false;
  for (const [id, mesh] of Object.entries(objectsRef.current ?? {})) {
    if (!mesh?.isMesh) continue;
    if (!preview || Number(id) !== preview.itemId) continue;
    if (!mesh.userData.stressGeometry) {
      mesh.userData.stressGeometry = mesh.geometry;
      mesh.userData.stressMaterial = mesh.material;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.BufferAttribute(preview.positions, 3),
    );
    if (preview.indices)
      geom.setIndex(new THREE.BufferAttribute(preview.indices, 1));
    geom.computeVertexNormals();
    if (mesh.geometry !== mesh.userData.stressGeometry) mesh.geometry.dispose();
    mesh.geometry = geom;
    mesh.material = new THREE.MeshStandardMaterial({
      color: 0x6c8fd4,
      roughness: 0.75,
      metalness: 0,
    });
    applied = true;
  }
  return applied;
}
