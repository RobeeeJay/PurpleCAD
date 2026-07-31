// Sketch reference underlay: a raster image (PNG/JPEG) laid ON the sketch
// plane, beneath the sketch geometry, at a user-set opacity — a tracing guide.
// It is NOT geometry: it never appears in `shapes`, so region detection,
// extrude profiles, constraints and export can't see it.
//
// Sizing follows the Texture tool's convention: `widthMm` is the image's WIDTH
// in mm and the height comes from the source aspect ratio, so a picture of a
// part traced at its real width is correctly scaled everywhere.

import * as THREE from "three";
import { MM_PER_UNIT } from "./dimensions.js";

// Just under the sketch lines (0.003) and point dots (0.004) so the guide
// always reads BEHIND the geometry being traced over it, but still clear of
// the sketch plane mesh itself at local z = 0.
const UNDERLAY_Z = 0.001;

export const DEFAULT_UNDERLAY = {
  widthMm: 100,
  offsetX: 0,
  offsetY: 0,
  rotationDeg: 0,
  opacity: 0.5,
};

// Plane size in SCENE units for an underlay of `widthMm` showing an image of
// `imageAspect` (= naturalHeight / naturalWidth).  Height follows the aspect so
// the picture is never distorted.
export function underlayPlaneSize(widthMm, imageAspect) {
  const w = Math.max(Number(widthMm) || 0, 1e-6) / MM_PER_UNIT;
  const a = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 1;
  return { width: w, height: w * a };
}

// World transform for the underlay plane: the sketch's own frame, shifted by
// the in-plane offset and spun by the in-plane rotation.
export function applyUnderlayTransform(mesh, underlay, sketchMesh) {
  const offX = Number(underlay.offsetX) || 0;
  const offY = Number(underlay.offsetY) || 0;
  const local = new THREE.Vector3(offX, offY, UNDERLAY_Z).applyQuaternion(
    sketchMesh.quaternion,
  );
  mesh.position.copy(sketchMesh.position).add(local);
  // Start from the sketch plane's orientation, then roll about its own normal.
  mesh.quaternion.copy(sketchMesh.quaternion);
  mesh.rotateZ(((Number(underlay.rotationDeg) || 0) * Math.PI) / 180);
}

// Build the underlay plane for a sketch item, or null when it has no image.
// The texture decodes asynchronously; `onReady` fires once it has (the caller
// uses it to request a frame, since rendering is on-demand).
export function buildSketchUnderlayGroup(selItem, sketchMesh, onReady) {
  const underlay = selItem?.underlay;
  if (!underlay?.dataUrl || !sketchMesh) return null;

  const group = new THREE.Group();
  group.userData.isSketchUnderlay = true;
  // Never pickable — it's a backdrop, not geometry.  The raycaster skips a
  // whole subtree whose root has layers disabled for the default channel.
  group.raycast = () => {};

  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: Math.min(Math.max(Number(underlay.opacity) ?? 0.5, 0), 1),
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.raycast = () => {};
  // Behind the sketch lines/dots (995+) but in front of the ground grid.
  mesh.renderOrder = 990;
  mesh.frustumCulled = false;
  group.add(mesh);

  const applySize = (aspect) => {
    const { width, height } = underlayPlaneSize(underlay.widthMm, aspect);
    mesh.geometry.dispose();
    mesh.geometry = new THREE.PlaneGeometry(width, height);
    applyUnderlayTransform(mesh, underlay, sketchMesh);
  };
  // Size from the stored aspect immediately so a reload paints at the right
  // size on the first frame, then correct it once the real image is decoded.
  applySize(underlay.imageAspect);

  new THREE.TextureLoader().load(underlay.dataUrl, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    material.map = tex;
    material.needsUpdate = true;
    const img = tex.image;
    if (img?.width > 0 && img?.height > 0) applySize(img.height / img.width);
    if (onReady) onReady();
  });

  return group;
}
