// MaterialDialog's live preview plus the view-fitting helpers that frame a
// selection or the whole scene.  Attaches onto the shared `controls` handle.

import * as THREE from "three";
import { useStore } from "../../store";
import { createMaterialPreviewHelpers } from "./materialPreview.js";
import { fitPointsToView, meshFitPoints, boxCorners } from "../cameraFit.js";

export function createMaterialAndFitHelpers({
  controls,
  scene,
  renderer,
  cameraRef,
  targetRef,
  itemsRef,
  objectsRef,
  handlesRef,
  boundingBoxRef,
  axisGroupRef,
  planeRef,
  sketchGridGroupRef,
  gridMaterial,
  rulerGroup,
}) {
  // Live preview for MaterialDialog: instantly applies in-progress
  // color/finish edits to the live mesh(es) without a store write.
  const materialPreview = createMaterialPreviewHelpers({
    objectsRef,
    itemsRef,
  });
  controls.previewMaterial = (target, materialProps) =>
    materialPreview.previewMaterial(target, materialProps);
  controls.restoreMaterialPreview = (target) =>
    materialPreview.restoreMaterialPreview(target);

  // The current view centre (camera orbit target) in world coords — the
  // toolbar reads this so a newly created primitive spawns where the user is
  // looking instead of always at the world origin.
  controls.getViewTarget = () => targetRef.current.clone();

  // Capture the current viewport canvas as a PNG blob, for the Save menu's
  // "Save image" option.  Relies on preserveDrawingBuffer (sceneSetup.js) so
  // the buffer is still readable after the frame has been composited.
  controls.captureScreenshot = () =>
    new Promise((resolve) => renderer.domElement.toBlob(resolve, "image/png"));

  // Capture a clean thumbnail of the project (a small JPEG data URL): reset-view
  // (isometric fit-all) framing, geometry shaded, with the ground plane / ruler
  // labels / sketches hidden.  When there are no solid objects, keep the sketch
  // plane and frame the origin instead.  Synchronous (render → toDataURL →
  // restore, all in one tick) so it also works during an unload/quit.
  controls.captureThumbnailDataUrl = () => {
    const cam = cameraRef.current;
    if (!cam) return null;

    // Solid (non-sketch, visible) meshes + the fit-point cloud (analytic
    // silhouette for round primitives, AABB corners otherwise) so the thumbnail
    // frames exactly like the Reset-view button.
    let any = false;
    const solidMeshes = [];
    const fitPts = [];
    for (const item of itemsRef.current) {
      if (item.type === "sketch" || item.visible === false) continue;
      const mesh = objectsRef.current[item.id];
      if (!mesh) continue;
      mesh.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(mesh);
      if (b.isEmpty()) continue;
      any = true;
      solidMeshes.push(mesh);
      meshFitPoints(item, mesh, fitPts);
    }

    // Hide overlays (restored after the capture).
    const hidden = [];
    const hide = (o) => {
      if (o && o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    };
    let gridMesh = null;
    scene.traverse((o) => {
      if (o.isMesh && o.material === gridMaterial) gridMesh = o;
      if (o.userData?.isShadowGround) hide(o);
      // Sketch line overlays: hide when there's a solid to show (they'd clutter
      // an object thumbnail); kept — and framed — when the project is sketch-only.
      if (o.userData?.isSketchOverlay) {
        if (any) hide(o);
        else if (o.visible) {
          o.updateWorldMatrix(true, true);
          const b = new THREE.Box3().setFromObject(o);
          if (!b.isEmpty()) boxCorners(b, fitPts);
        }
      }
    });
    hide(gridMesh);
    hide(rulerGroup);
    hide(sketchGridGroupRef?.current);
    hide(axisGroupRef?.current);
    handlesRef?.current?.forEach((h) => hide(h.mesh));
    const bb = boundingBoxRef?.current;
    if (bb) {
      hide(bb.boxMesh);
      hide(bb.labelX?.sprite);
      hide(bb.labelY?.sprite);
      hide(bb.labelZ?.sprite);
    }
    // The sketch plane is the fallback subject when the project has no objects.
    if (any) hide(planeRef?.current);

    // Force each solid to its shaded (analytic) material, opaque, for the shot.
    const matRestore = [];
    for (const mesh of solidMeshes) {
      const rec = { mesh, mat: mesh.material, geo: mesh.geometry };
      if (
        mesh.userData.hullGeometry &&
        mesh.geometry !== mesh.userData.hullGeometry
      )
        mesh.geometry = mesh.userData.hullGeometry;
      if (mesh.userData.shaderMat && mesh.material !== mesh.userData.shaderMat)
        mesh.material = mesh.userData.shaderMat;
      const m = mesh.material;
      if (m && "opacity" in m) {
        rec.opMat = m;
        rec.op = { t: m.transparent, o: m.opacity, d: m.depthWrite };
        m.transparent = false;
        m.opacity = 1;
        m.depthWrite = true;
        m.needsUpdate = true;
      }
      matRestore.push(rec);
    }

    // Isometric fit-all pose — the exact same fit as the Reset-view / Home
    // button, so a thumbnail frames identically to the default view.  The full
    // frame (no left-panel offset) is used since the shot has no overlay.
    const saved = {
      pos: cam.position.clone(),
      quat: cam.quaternion.clone(),
      zoom: cam.zoom,
    };
    const rotX = Math.asin(Math.sqrt(1 / 3));
    const rotY = Math.PI / 4;
    const dir = new THREE.Vector3(
      Math.sin(rotY) * Math.cos(rotX),
      Math.sin(rotX),
      Math.cos(rotY) * Math.cos(rotX),
    ).normalize();
    let center;
    // fitPointsToView returns null when nothing finite survives -- treat that
    // exactly like having no points rather than framing on NaN.
    const fit =
      fitPts.length > 0 ? fitPointsToView(fitPts, dir, cam, 0.9) : null;
    if (fit) {
      center = fit.target;
      cam.position.copy(fit.target).addScaledVector(dir, fit.distance);
      if (fit.endZoom != null) cam.zoom = fit.endZoom;
    } else {
      center = new THREE.Vector3();
      cam.position.copy(center).addScaledVector(dir, 15);
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(center);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);

    // Render one clean frame (no bloom composer), read it, downscale to the
    // project card's display size, then restore camera / overlays / materials.
    renderer.render(scene, cam);
    const src = renderer.domElement;
    // Match the card thumbnail (4:3, ~240 CSS px wide) at the device pixel ratio
    // so it's crisp on hi-DPI; cap at 2× to keep the stored data URL small.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const tw = Math.round(240 * dpr);
    const th = Math.round(180 * dpr);
    // Stepped halving keeps large minifications from aliasing, then a final
    // high-quality cover-crop into the 4:3 box.
    let cur = src;
    let cw = src.width;
    let ch = src.height;
    const cap = Math.max(tw, th) * 2;
    while (Math.min(cw, ch) > cap) {
      const nw = Math.max(tw, Math.round(cw / 2));
      const nh = Math.max(th, Math.round(ch / 2));
      const half = document.createElement("canvas");
      half.width = nw;
      half.height = nh;
      const hx = half.getContext("2d");
      hx.imageSmoothingEnabled = true;
      hx.imageSmoothingQuality = "high";
      hx.drawImage(cur, 0, 0, nw, nh);
      cur = half;
      cw = nw;
      ch = nh;
    }
    const thumb = document.createElement("canvas");
    thumb.width = tw;
    thumb.height = th;
    const ctx = thumb.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const cover = Math.max(tw / cw, th / ch);
    ctx.drawImage(
      cur,
      (tw - cw * cover) / 2,
      (th - ch * cover) / 2,
      cw * cover,
      ch * cover,
    );
    const dataUrl = thumb.toDataURL("image/jpeg", 0.72);

    cam.position.copy(saved.pos);
    cam.quaternion.copy(saved.quat);
    cam.zoom = saved.zoom;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    for (const o of hidden) o.visible = true;
    for (const r of matRestore) {
      r.mesh.geometry = r.geo;
      if (r.op) {
        r.opMat.transparent = r.op.t;
        r.opMat.opacity = r.op.o;
        r.opMat.depthWrite = r.op.d;
        r.opMat.needsUpdate = true;
      }
      r.mesh.material = r.mat;
    }
    return dataUrl;
  };

  // Drop the selected non-sketch objects so their lowest world-Y point
  // sits on the ground plane (Y=0).  Computes the min Y across all
  // selected meshes' world-space bounding boxes, then dispatches a
  // single setItemsTransform with each item's new Y position.
  controls.dropSelectedToGround = () => {
    const store = useStore.getState();
    const selected = (
      store.selectedIds && store.selectedIds.length > 0
        ? store.selectedIds
        : store.selectedId != null
          ? [store.selectedId]
          : []
    )
      .map((id) => ({ id, item: store.items.find((i) => i.id === id) }))
      .filter(({ item }) => item && item.type !== "sketch");
    if (selected.length === 0) return;
    let minY = Infinity;
    const box = new THREE.Box3();
    for (const { id } of selected) {
      const mesh = objectsRef.current?.[id];
      if (!mesh) continue;
      mesh.updateMatrixWorld(true);
      box.setFromObject(mesh);
      if (Number.isFinite(box.min.y) && box.min.y < minY) minY = box.min.y;
    }
    if (!Number.isFinite(minY)) return;
    const shift = -minY;
    if (Math.abs(shift) < 1e-6) return;
    const updates = selected.map(({ id, item }) => ({
      id,
      position: {
        x: item.position?.x ?? 0,
        y: (item.position?.y ?? 0) + shift,
        z: item.position?.z ?? 0,
      },
    }));
    store.setItemsTransform(updates);
    // Persist as undoable history entries so the move survives a replay
    // / reload (setItemsTransform alone only touches `items`).
    for (const u of updates) {
      useStore.getState().recordTransformHistory(u.id, "Moved");
    }
  };
}
