// Per-frame render loop: drives the camera fly-in tween, repositions
// the sketch-grid origin to track the orbit target while in sketch
// mode, keeps the axis indicator + transform handles + bounding-box
// dimension labels at a constant on-screen size, and dispatches to
// the bloom composer (or the raw renderer when smooth mode is off).
// Returns a `stop()` that cancelAnimationFrames the next tick.

import * as THREE from "three";
import { updateRuler3D } from "../sceneSetup.js";

const _rulerPos = new THREE.Vector3();

export function createAnimateLoop({
  scene,
  renderer,
  cameraRef,
  targetRef,
  cameraAnimRef,
  sketchModeRef,
  sketchGridGroupRef,
  objectsRef,
  selectedIdRef,
  axisGroupRef,
  handlesRef,
  boundingBoxRef,
  gridMaterial,
  rulerGroup,
  composerRef,
  setRotationState,
}) {
  let animId;
  const animate = () => {
    animId = requestAnimationFrame(animate);

    if (cameraAnimRef.current) {
      const anim = cameraAnimRef.current;
      const t = Math.min(1, (Date.now() - anim.startTime) / anim.duration);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      cameraRef.current.position.lerpVectors(anim.startPos, anim.endPos, ease);
      targetRef.current.lerpVectors(anim.startTarget, anim.endTarget, ease);
      cameraRef.current.up
        .lerpVectors(anim.startUp, anim.endUp, ease)
        .normalize();
      cameraRef.current.lookAt(targetRef.current);
      // Orthographic "fit all" also tweens zoom so the bbox ends up framed.
      if (anim.endZoom != null && anim.startZoom != null) {
        cameraRef.current.zoom =
          anim.startZoom + (anim.endZoom - anim.startZoom) * ease;
        cameraRef.current.updateProjectionMatrix();
      }
      setRotationState(cameraRef.current.quaternion.clone());
      if (t >= 1) {
        if (anim.onComplete) anim.onComplete();
        cameraAnimRef.current = null;
      }
    }

    if (sketchModeRef.current && sketchGridGroupRef?.current) {
      const minorGrid = sketchGridGroupRef.current.userData.minorGrid;
      const sketchMesh = objectsRef.current[selectedIdRef.current];
      if (minorGrid && sketchMesh) {
        const inv = sketchMesh.quaternion.clone().invert();
        const local = targetRef.current
          .clone()
          .sub(sketchMesh.position)
          .applyQuaternion(inv);
        minorGrid.position.set(Math.round(local.x), Math.round(local.y), 0);
      }
    }

    // Keep on-screen UI overlays (axis indicator, transform handles,
    // bounding-box dimension labels) a constant size regardless of
    // zoom by scaling each inversely to the camera's effective view
    // height.  Without this they balloon when the camera zooms in and
    // disappear into the object when it zooms out.
    const cam = cameraRef.current;
    if (cam) {
      const REFERENCE_HEIGHT = 10; // arbitrary baseline; tuned visually
      const gizmoScale = (worldPos) => {
        if (cam.isOrthographicCamera) {
          // (top - bottom) / zoom is the world height the camera shows.
          return (cam.top - cam.bottom) / cam.zoom / REFERENCE_HEIGHT;
        }
        // Perspective: visible height at distance d is 2*d*tan(fov/2).
        const d = cam.position.distanceTo(worldPos);
        return (2 * d * Math.tan((cam.fov * Math.PI) / 360)) / REFERENCE_HEIGHT;
      };
      if (axisGroupRef?.current && axisGroupRef.current.visible) {
        const s = gizmoScale(axisGroupRef.current.position);
        axisGroupRef.current.scale.setScalar(s);
      }
      if (handlesRef?.current && handlesRef.current.length > 0) {
        // The rotation tori (dir === null) sit at the gizmo centre; use one as
        // the cluster centre so the axis/scale handles can be re-offset from it.
        const centerHandle = handlesRef.current.find((h) => h.dir === null);
        const center = centerHandle
          ? centerHandle.mesh.position
          : handlesRef.current[0].mesh.position;
        // Overall on-screen size of the rotation/resize/drag gizmo, as a
        // fraction of the authored size (handles + ring radius + handle
        // offset all scale together so the cluster stays coherent).
        const GIZMO_SCALE = 0.25;
        const s = gizmoScale(center) * GIZMO_SCALE;
        handlesRef.current.forEach(({ mesh: hm, dir }) => {
          // Each handle was authored at unit scale; reset rather than
          // multiply so we don't compound across frames.
          if (hm.userData.baseScale == null) hm.userData.baseScale = 1;
          hm.scale.setScalar(hm.userData.baseScale * s);
          // Scale the axis/scale handles' offset from the centre by the same
          // factor so they ride on the (also-scaled) rings at every zoom
          // instead of drifting off them.  Tori (dir null) stay at centre.
          if (dir) {
            const off = hm.userData.baseOffsetDist ?? 1.5;
            hm.position.copy(center).addScaledVector(dir, off * s);
          }
        });
      }
      // Bounding-box dimension labels (the "20mm" sprites at the
      // selection's edges) are world-scaled sprites — they shrink to
      // nothing on zoom-out and dominate the viewport on zoom-in
      // without this pass.  Each sprite caches its authored scale on
      // userData.baseScale on first sight so we can multiply rather
      // than compound.
      if (boundingBoxRef?.current) {
        const bbox = boundingBoxRef.current;
        const s = gizmoScale(bbox.boxMesh.position);
        for (const label of [bbox.labelX, bbox.labelY, bbox.labelZ]) {
          if (!label?.sprite) continue;
          const sp = label.sprite;
          if (sp.userData.baseScale == null) {
            sp.userData.baseScale = {
              x: sp.scale.x,
              y: sp.scale.y,
              z: sp.scale.z,
            };
          }
          const b = sp.userData.baseScale;
          sp.scale.set(b.x * s, b.y * s, b.z * s);
        }
      }
      // Ruler labels: keep a constant on-screen size, and reveal/hide the
      // finer tiers by how much world the camera shows.  viewHeight is in
      // scene units (1 unit = 10 mm).  Tier thresholds are tuned so the
      // 10 mm labels drop out once the view spans more than ~450 mm and the
      // 1 mm labels only appear once it tightens below ~60 mm.
      if (rulerGroup && (sketchModeRef.current || composerRef.current)) {
        // Sketch mode uses the screen-locked HTML rulers instead; the
        // world-space ground ruler is hidden (it's off the sketch plane).
        // Smooth (composer) render mode is a presentation view — hide the
        // ground rulers there too so they don't clutter the rendered result.
        rulerGroup.visible = false;
      } else if (rulerGroup) {
        rulerGroup.visible = true;
        const viewHeight = gizmoScale(targetRef.current) * REFERENCE_HEIGHT;
        // Recycle the labels around the camera target so they follow the view
        // (tier visibility + which absolute mm labels are shown live here).
        updateRuler3D(
          rulerGroup,
          targetRef.current.x,
          targetRef.current.z,
          viewHeight,
        );
        // Fade the matching 1 mm ground grid in over a small band centred on
        // the same threshold the 1 mm ruler tier toggles at (viewHeight 7).
        if (gridMaterial.uniforms.uUltraFade) {
          const t = Math.min(1, Math.max(0, (viewHeight - 6) / 2));
          gridMaterial.uniforms.uUltraFade.value = 1 - t * t * (3 - 2 * t);
        }
        // Scale each label by ITS OWN distance to the camera so labels far
        // across the ground plane stay the same on-screen size as near ones
        // (a single target-distance factor would let far labels shrink under
        // perspective).  Update the hierarchy once, then read each matrixWorld.
        rulerGroup.updateWorldMatrix(false, true);
        rulerGroup.traverse((o) => {
          if (!o.userData.isRulerLabel) return;
          const b = o.userData.baseScale;
          _rulerPos.setFromMatrixPosition(o.matrixWorld);
          const sp = gizmoScale(_rulerPos);
          o.scale.set(b.x * sp, b.y * sp, b.z * sp);
        });
      }
    }
    gridMaterial.uniforms.uCameraPos.value.copy(cameraRef.current.position);
    if (composerRef.current) composerRef.current.render();
    else renderer.render(scene, cameraRef.current);
  };
  animate();
  return {
    stop: () => cancelAnimationFrame(animId),
  };
}
