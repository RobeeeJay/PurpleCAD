// Per-frame render loop: drives the camera fly-in tween, repositions
// the sketch-grid origin to track the orbit target while in sketch
// mode, keeps the axis indicator + transform handles + bounding-box
// dimension labels at a constant on-screen size, and dispatches to
// the bloom composer (or the raw renderer when smooth mode is off).
// Returns a `stop()` that cancelAnimationFrames the next tick.

import * as THREE from "three";
import { updateRuler3D } from "../sceneSetup.js";
import { useStore } from "../../store";
import {
  CROSS_SECTION_PLANE,
  updateCrossSectionPlane,
  crossSectionViewPlane,
} from "../crossSection.js";
import { updateCaps } from "../crossSectionCaps.js";

const _rulerPos = new THREE.Vector3();
const _camRight = new THREE.Vector3();

// Width of the left objects/timeline overlay (`.left-panel` in App.css). The
// axis indicator is nudged right by half this so it reads centred in the 3D
// area the user can actually see, not the canvas centre hidden behind the panel.
const LEFT_PANEL_PX = 250;

export function createAnimateLoop({
  scene,
  renderer,
  cameraRef,
  targetRef,
  cameraAnimRef,
  sketchModeRef,
  sketchGridGroupRef,
  sketchShapesGroupRef,
  sketchPlacementPlanesRef,
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
        // Pin the XYZ indicator to the view centre (the camera target) so it
        // stays on-screen as the view pans, rather than scrolling off with the
        // world origin.  The arrows still point along the true world axes.
        // Then shift it right by half the left overlay's width so it sits in the
        // centre of the *visible* 3D area, clear of the objects/timeline panel.
        const canvasH = renderer.domElement.clientHeight || 1;
        const worldPerPx =
          (gizmoScale(targetRef.current) * REFERENCE_HEIGHT) / canvasH;
        _camRight.set(1, 0, 0).applyQuaternion(cameraRef.current.quaternion);
        axisGroupRef.current.position
          .copy(targetRef.current)
          .addScaledVector(_camRight, (LEFT_PANEL_PX / 2) * worldPerPx);
        // 0.5: render the XYZ indicator at half the authored on-screen size.
        const s = gizmoScale(axisGroupRef.current.position) * 0.5;
        axisGroupRef.current.scale.setScalar(s);
      }
      // Sketch-placement plane previews: keep them a constant on-screen size so
      // they're equally easy to click whatever the zoom (they're authored as
      // fixed-world 4×4 meshes).
      if (sketchPlacementPlanesRef?.current?.length) {
        for (const { mesh } of sketchPlacementPlanesRef.current) {
          mesh.scale.setScalar(gizmoScale(mesh.position) * 0.7);
        }
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
        const GIZMO_SCALE = 0.5;
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
      // Bounding-box dimension labels (the W/H/D "mm" sprites): sit each on the
      // midpoint of its axis edge of the (object-oriented) bounding box, held at
      // a constant on-screen SIZE only.  Restamped every frame; each sprite
      // caches its authored scale so we multiply not compound.
      if (boundingBoxRef?.current) {
        const bbox = boundingBoxRef.current;
        const center = bbox.boxMesh.position;
        const s = gizmoScale(center);
        // Sit each dimension label at the midpoint of its axis edge on the
        // bounding box (X bottom-front, Y front-right, Z bottom-right), nudged
        // just outward so it hugs the edge.  Only the SIZE is held constant on
        // screen (scale by s); the position tracks the box, not the gizmo.
        const hw = bbox.boxMesh.scale.x / 2,
          hh = bbox.boxMesh.scale.y / 2,
          hd = bbox.boxMesh.scale.z / 2;
        const G = 0.3 * s;
        // Local (box-frame) edge-midpoint offsets, then rotated into the box's
        // orientation so labels track the edges of a rotated bounding box.
        const q = bbox.boxMesh.quaternion;
        const edgeOff = [
          [0, -hh - G, hd + G], // X
          [hw + G, 0, hd + G], // Y
          [hw + G, -hh - G, 0], // Z
        ];
        [bbox.labelX, bbox.labelY, bbox.labelZ].forEach((label, i) => {
          if (!label?.sprite) return;
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
          const o = edgeOff[i];
          sp.position.set(o[0], o[1], o[2]).applyQuaternion(q).add(center);
        });
      }
      // Constraint annotations: keep a constant on-screen size so they don't
      // balloon on zoom-in or vanish on zoom-out.  Value/angle LABEL sprites
      // multiply their authored scale; the small indicator MARKS (rings, ticks,
      // arcs — recentered on a local anchor at build time) scale from unit about
      // that anchor.  The dimension/leader LINES are left alone so they keep
      // spanning the measured geometry.  CONSTRAINT_LABEL_SCALE sets the size.
      if (sketchModeRef.current && sketchShapesGroupRef?.current) {
        const CONSTRAINT_LABEL_SCALE = 1.5;
        const g = sketchShapesGroupRef.current;
        g.updateWorldMatrix(false, true);
        g.traverse((o) => {
          const isLabel = o.isSprite && o.userData.isConstraintObj;
          const isMark = o.userData.constraintMark;
          if (!isLabel && !isMark) return;
          _rulerPos.setFromMatrixPosition(o.matrixWorld);
          const s = gizmoScale(_rulerPos) * CONSTRAINT_LABEL_SCALE;
          if (isLabel) {
            if (o.userData.baseScale == null) {
              o.userData.baseScale = {
                x: o.scale.x,
                y: o.scale.y,
                z: o.scale.z,
              };
            }
            const b = o.userData.baseScale;
            o.scale.set(b.x * s, b.y * s, b.z * s);
          } else {
            o.scale.setScalar(s);
          }
        });
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
        // Recycle the labels around the camera target, but shifted right by half
        // the left overlay's width (same as the axis indicator) so the ruler is
        // centred on the visible 3D area rather than the canvas centre half-
        // hidden behind the objects/timeline panel.
        const canvasH = renderer.domElement.clientHeight || 1;
        const worldPerPx = (viewHeight / canvasH) * (LEFT_PANEL_PX / 2);
        _camRight.set(1, 0, 0).applyQuaternion(cameraRef.current.quaternion);
        updateRuler3D(
          rulerGroup,
          targetRef.current.x + _camRight.x * worldPerPx,
          targetRef.current.z + _camRight.z * worldPerPx,
          viewHeight,
          useStore.getState().theme,
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
    // Keep the cross-section cut locked to the camera as it orbits / pans,
    // re-pose the hatched caps, and feed the view-space plane to the analytic
    // primitive shaders (they clip their computed surface point themselves).
    if (useStore.getState().crossSectionView) {
      updateCrossSectionPlane(cameraRef.current, targetRef.current);
      updateCaps(CROSS_SECTION_PLANE, targetRef.current);
      const vp = crossSectionViewPlane(cameraRef.current);
      Object.values(objectsRef.current).forEach((mesh) => {
        const u = mesh.userData.shaderMat?.uniforms;
        if (u?.uClipEnabled) {
          u.uClipNormal.value.copy(vp.normal);
          u.uClipConstant.value = vp.constant;
        }
      });
    }
    // While the path-traced render is actually running it owns the canvas (its
    // own RAF loop accumulates samples) — skip the raster render so we don't
    // fight it.  Gated on pathTracerActive (not the toggle) so a failed start
    // never leaves the view frozen.
    if (useStore.getState().pathTracerActive) return;
    if (composerRef.current) composerRef.current.render();
    else renderer.render(scene, cameraRef.current);
  };
  animate();
  return {
    stop: () => cancelAnimationFrame(animId),
  };
}
