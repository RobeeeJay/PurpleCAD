// Measure-tool markers and the create-a-primitive ghost preview.  Both build
// throwaway THREE objects and attach their show/clear pair onto the shared
// `controls` handle, which is how the React layer reaches them.

import * as THREE from "three";
import { MM_PER_UNIT } from "../sceneObjects.js";
import { primitiveDimensions } from "../sceneObjects/dimensions.js";
import { createMaterial } from "../objectMaterials.js";
import { DEFAULT_MESH_COLOR } from "../theme.js";
import { anchorOf } from "../measure.js";

export function createMeasureAndPrimitivePreviews({
  controls,
  scene,
  itemsRef,
  objectsRef,
  extrude,
  beginExtrudeStartPick,
  cancelExtrude,
  finalizeExtrude,
  preselectRetargetProfile,
  rebuildPreviews,
}) {
  // Measure tool markers: a coloured sphere at each picked point and a dashed
  // line between two picks, so the user sees what was picked and what's measured.
  let measureGroup = null;
  controls.clearMeasureMarkers = () => {
    if (!measureGroup) return;
    scene.remove(measureGroup);
    measureGroup.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    measureGroup = null;
  };
  controls.updateMeasureMarkers = (picks) => {
    controls.clearMeasureMarkers();
    const list = (picks || []).filter((p) => p && p.at);
    if (list.length === 0) return;
    // Size the markers off the PICKED objects, not the whole scene — the scene
    // bbox includes the 1000-unit sketch reference plane, which made a giant
    // sphere.  Fall back to a small fixed size if no object is under the pick.
    let refSize = 0;
    for (const pick of list) {
      const mesh = objectsRef.current[pick.itemId];
      if (!mesh || !mesh.geometry) continue;
      mesh.geometry.computeBoundingSphere?.();
      const br = mesh.geometry.boundingSphere?.radius || 0;
      const ws = Math.abs(mesh.getWorldScale(new THREE.Vector3()).x) || 1;
      refSize = Math.max(refSize, br * ws);
    }
    const r = Math.max(0.02, (refSize || 1) * 0.04);
    const g = new THREE.Group();
    const colors = [0xffaa33, 0x33ddff];
    list.forEach((pick, i) => {
      const color = colors[i % colors.length];
      // Highlight the actual clicked face (translucent overlay) so it stays lit.
      if (pick.kind === "face" && pick.pts && pick.pts.length >= 3) {
        const flat = new Float32Array(pick.pts.length * 3);
        pick.pts.forEach((p, k) => {
          flat[k * 3] = p[0];
          flat[k * 3 + 1] = p[1];
          flat[k * 3 + 2] = p[2];
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(flat, 3));
        const face = new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          }),
        );
        face.renderOrder = 999;
        g.add(face);
      }
      // A sphere where the measurement actually runs from: the centre of a
      // face or a line, the vertex itself for a point.  Marking the clicked
      // spot instead would draw a line the readout disagrees with.
      const anchor = anchorOf(pick);
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(r, 16, 12),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      );
      if (anchor) m.position.copy(anchor);
      else m.position.set(pick.at[0], pick.at[1], pick.at[2]);
      m.renderOrder = 1000;
      g.add(m);
    });
    if (list.length >= 2) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          anchorOf(list[0]) ?? new THREE.Vector3(...list[0].at),
          anchorOf(list[1]) ?? new THREE.Vector3(...list[1].at),
        ]),
        new THREE.LineDashedMaterial({
          color: 0xffffff,
          dashSize: r * 2.5,
          gapSize: r * 1.5,
          depthTest: false,
        }),
      );
      line.computeLineDistances();
      line.renderOrder = 1000;
      g.add(line);
    }
    scene.add(g);
    measureGroup = g;
  };

  // Live primitive-dimensions preview (the dialog's dimensions, WITHOUT a store
  // rebuild, so resizing is instant).  A box (real geometry) scales in place so
  // its edges follow; a raymarched sphere/cylinder/torus/cone updates its shader
  // dimension uniforms and re-sizes its box hull.  The commit (modifyItem)
  // rebuilds from the store; clearBoxPreview reverts to the stored dimensions.
  const primHull = (type, d) => {
    if (type === "cube")
      return new THREE.BoxGeometry(d.width, d.height, d.depth);
    if (type === "sphere") {
      const r = d.radius * 2;
      return new THREE.BoxGeometry(r, r, r);
    }
    if (type === "cylinder")
      return new THREE.BoxGeometry(2 * d.radius, d.height, 2 * d.radius);
    if (type === "torus") {
      const o = 2 * (d.major + d.minor);
      return new THREE.BoxGeometry(o, 2 * d.minor, o);
    }
    if (type === "cone") {
      const o = 2 * Math.max(d.radiusBottom, d.radiusTop);
      return new THREE.BoxGeometry(o, d.height, o);
    }
    return null;
  };
  // Unscaled geometry size (mm) of an item's mesh, so the transform dialog can
  // derive per-axis lengths (localSize * item.scale) and convert an edited
  // length back to a scale.  Independent of item.scale, so it's stable to read.
  controls.getItemLocalSizeMm = (id) => {
    const mesh = objectsRef.current[id];
    if (!mesh?.geometry) return null;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    return {
      x: (bb.max.x - bb.min.x) * MM_PER_UNIT,
      y: (bb.max.y - bb.min.y) * MM_PER_UNIT,
      z: (bb.max.z - bb.min.z) * MM_PER_UNIT,
    };
  };
  controls.previewBoxDimensions = (id, dims) => {
    const mesh = objectsRef.current[id];
    const item = itemsRef.current.find((i) => i.id === id);
    if (!mesh || !item) return;
    if (item.type === "cube") {
      const st = item.dimensions || { width: 2, height: 2, depth: 2 };
      const sc = item.scale || { x: 1, y: 1, z: 1 };
      mesh.scale.set(
        (sc.x ?? 1) * (dims.width / (st.width || 2)),
        (sc.y ?? 1) * (dims.height / (st.height || 2)),
        (sc.z ?? 1) * (dims.depth / (st.depth || 2)),
      );
      return;
    }
    const u = mesh.material?.uniforms;
    if (u) {
      if (u.uRadius && dims.radius != null) u.uRadius.value = dims.radius;
      if (u.uHalfH && dims.height != null) u.uHalfH.value = dims.height / 2;
      if (u.uMajor && dims.major != null) u.uMajor.value = dims.major;
      if (u.uMinor && dims.minor != null) u.uMinor.value = dims.minor;
      if (u.uRb && dims.radiusBottom != null) u.uRb.value = dims.radiusBottom;
      if (u.uRt && dims.radiusTop != null) u.uRt.value = dims.radiusTop;
    }
    const hull = primHull(item.type, dims);
    if (hull) {
      mesh.geometry.dispose();
      mesh.geometry = hull;
      mesh.userData.hullGeometry = hull;
    }
  };
  controls.clearBoxPreview = (id) => {
    const item = itemsRef.current.find((i) => i.id === id);
    if (item) controls.previewBoxDimensions(id, primitiveDimensions(item));
  };

  // Ghost preview for CREATING a primitive: a translucent copy of the actual
  // shape (real shader, so a sphere reads as a sphere) at the spawn point, before
  // anything is committed to the timeline.  Updated live as the dialog changes.
  let primGhost = null;
  controls.clearPrimitivePreview = () => {
    if (!primGhost) return;
    scene.remove(primGhost);
    primGhost.geometry?.dispose();
    primGhost.material?.dispose();
    primGhost = null;
  };
  controls.showPrimitivePreview = ({ type, dimensions, position }) => {
    const geo = primHull(type, dimensions);
    if (!geo) return;
    const mat = createMaterial({ type, dimensions }, DEFAULT_MESH_COLOR);
    if (mat.uniforms?.uOpacity) {
      mat.uniforms.uOpacity.value = 0.55;
      mat.transparent = true;
    } else {
      mat.opacity = 0.55;
      mat.transparent = true;
    }
    controls.clearPrimitivePreview();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(position.x, position.y, position.z);
    mesh.renderOrder = 5;
    scene.add(mesh);
    primGhost = mesh;
  };

  // Expose extrude-overlay control to the React layer:
  //   • finalizeExtrudeWithDepth(d)         — commit at numeric depth `d`.
  //   • finalizeExtrudeWithFormula(f, d)    — commit storing formula `f`
  //                                           and using its resolved depth
  //                                           `d` for the preview/profile.
  //   • updateExtrudePreview(d)             — re-render the live preview
  //                                           mesh at depth `d`.
  controls.finalizeExtrudeWithDepth = (depth) => finalizeExtrude(depth);
  controls.finalizeExtrudeWithFormula = (formula, depth) =>
    finalizeExtrude(depth, formula);
  controls.cancelExtrude = () => cancelExtrude();
  controls.updateExtrudePreview = (depth) => {
    if (!extrude.hasProfiles) return;
    // Preserve the sign so a negative (backward) depth previews in the -Z
    // direction; makeExtrudePreviewMesh clamps the magnitude to ≥ 0.05.
    rebuildPreviews(depth);
  };
  // Enter the "pick a face / sketch plane to offset the extrude start" mode.
  controls.beginExtrudeStartPick = () => beginExtrudeStartPick();
  // Enter the "pick a face for the extrude to reach" mode (fills the distance).
  controls.beginExtrudeToPick = () => extrude.beginExtrudeToPick();
  // Extrude the selected solid face directly (the React extrude button calls
  // this when a face is selected).  Returns true if a face extrude started.
  controls.extrudeSelectedFace = () => extrude.startFaceExtrudeFromSelection();
  // Pre-select the original profile region when retargeting an extrude.
  controls.preselectRetargetProfile = () => preselectRetargetProfile();
}
