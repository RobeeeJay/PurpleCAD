// Per-frame render loop: drives the camera fly-in tween, repositions
// the sketch-grid origin to track the orbit target while in sketch
// mode, keeps the axis indicator + transform handles + bounding-box
// dimension labels at a constant on-screen size, and dispatches to
// the bloom composer (or the raw renderer when smooth mode is off).
// Returns a `stop()` that cancelAnimationFrames the next tick.

import * as THREE from "three";
import {
  updateRuler3D,
  ndcGapPx,
  rulerFadeOpacity,
  pointBehindCamera,
  groundRayCrossing,
  panelAwareLookAt,
} from "../sceneSetup.js";
import { useStore } from "../../store";
import { applyScreenDashes } from "../screenDash.js";
import {
  CROSS_SECTION_PLANE,
  updateCrossSectionPlane,
  crossSectionViewPlane,
  orientationFromAngles,
} from "../crossSection.js";
import { updateCaps } from "../crossSectionCaps.js";

const _rulerPos = new THREE.Vector3();
const _rulerNext = new THREE.Vector3();
const _rulerNdcPoint = new THREE.Vector3();
const _rulerCamDir = new THREE.Vector3();
const _camForward = new THREE.Vector3();

// Persisted across frames — see groundRayCrossing's doc comment (sceneSetup.js)
// for why the ruler's cross-point is rebuilt fresh from the camera's own
// forward ray every frame rather than tracking targetRef.current (which the
// orbit-anchor recentre can reassign out from under it, instantly).
let _rulerCrossState = { x: 0, z: 0, hit: true };

// On-demand rendering.  The loop keeps ticking (cheap) but only does the
// expensive per-frame work + render() when something actually changed, instead
// of pinning ~60 fps of bloom-composer raster on a static scene.  A frame is
// rendered when: an explicit invalidation is pending (requestRender — wired to
// every store change), the camera pose moved, a continuous state is running
// (camera tween / cross-section), or we're inside the short activity window a
// pointer/wheel/key press opens (so interaction never stutters even if an update
// lands a frame late).  Conservative on purpose — over-rendering a little beats a
// stale view.
let _needsRender = true;
export function requestRender() {
  _needsRender = true;
}

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
  cameraControlsRef,
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
  // Frozen camera pose while cross-section is active (orbit/pan then move the
  // cut plane instead of the view).  Re-captured after any camera animation.
  let frozenPose = null;
  let prevAnimActive = false;

  // On-demand gate state.  lastCam remembers the pose we last rendered so we can
  // detect a camera move; activeUntil holds a short "keep rendering" window that
  // any pointer/wheel/key interaction opens.
  const lastCam = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 0, zoom: 0 };
  let activeUntil = 0;
  const ACTIVITY_MS = 400;
  const bumpActivity = () => {
    activeUntil = performance.now() + ACTIVITY_MS;
  };
  // Any store change may alter what's drawn (selection, hover, items, material,
  // theme, render mode …) — open the activity window rather than enumerate every
  // key.  A window (not a one-shot) because the scene mutation happens in a React
  // effect that runs AFTER the state change: a one-shot flag could be consumed by
  // a frame that renders the pre-effect scene, leaving the update stale.  The
  // window keeps rendering long enough to catch the effect (and short async mesh
  // builds that resolve just after).
  const unsubscribe = useStore.subscribe(bumpActivity);
  // Pointer/wheel/key activity opens the window so interaction stays smooth even
  // for updates that don't move the camera or hit the store this exact frame.
  const canvas = renderer.domElement;
  const onActivity = () => bumpActivity();
  const activityEvents = ["pointerdown", "pointermove", "wheel", "keydown"];
  for (const ev of activityEvents)
    canvas.addEventListener(ev, onActivity, { passive: true });
  // A resize changes the canvas/camera but isn't a canvas pointer event, so it
  // must invalidate explicitly or an idle view would render at the old size.
  window.addEventListener("resize", onActivity, { passive: true });

  const cameraMoved = () => {
    const cam = cameraRef.current;
    if (!cam) return false;
    const p = cam.position,
      q = cam.quaternion;
    const moved =
      p.x !== lastCam.x ||
      p.y !== lastCam.y ||
      p.z !== lastCam.z ||
      q.x !== lastCam.qx ||
      q.y !== lastCam.qy ||
      q.z !== lastCam.qz ||
      q.w !== lastCam.qw ||
      cam.zoom !== lastCam.zoom;
    if (moved) {
      lastCam.x = p.x;
      lastCam.y = p.y;
      lastCam.z = p.z;
      lastCam.qx = q.x;
      lastCam.qy = q.y;
      lastCam.qz = q.z;
      lastCam.qw = q.w;
      lastCam.zoom = cam.zoom;
    }
    return moved;
  };

  const animate = () => {
    animId = requestAnimationFrame(animate);

    // Continuous states that must render every frame while they run: a camera
    // tween, and cross-section (orbiting moves the CUT while the camera is held,
    // so cameraMoved() can't see it).  The path tracer owns the canvas itself.
    const continuous =
      !!cameraAnimRef.current || useStore.getState().crossSectionView;
    // Skip the whole per-frame body + render when nothing changed.  cameraMoved()
    // is called for its side effect (updating lastCam) only when we might skip,
    // so an active frame doesn't wastefully re-latch it.
    if (!_needsRender && !continuous && performance.now() >= activeUntil) {
      if (!cameraMoved()) return; // truly idle — don't touch the GPU
    } else {
      cameraMoved(); // keep lastCam current so the next idle check is correct
    }
    _needsRender = false;

    if (cameraAnimRef.current) {
      const anim = cameraAnimRef.current;
      const t = Math.min(1, (Date.now() - anim.startTime) / anim.duration);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      cameraRef.current.position.lerpVectors(anim.startPos, anim.endPos, ease);
      targetRef.current.lerpVectors(anim.startTarget, anim.endTarget, ease);
      cameraRef.current.up
        .lerpVectors(anim.startUp, anim.endUp, ease)
        .normalize();
      if (sketchModeRef.current) {
        cameraRef.current.lookAt(targetRef.current);
      } else {
        panelAwareLookAt(
          cameraRef.current,
          targetRef.current,
          renderer.domElement.clientWidth,
        );
      }
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
      // renderer.render() (end of this function) is what normally refreshes
      // the camera's matrixWorld via the scene graph — but this block reads
      // it EARLIER in the same frame (unproject/project for the ruler and
      // label-fade projections), so without this it's always one frame
      // stale: the FIRST frame after any position/orientation change (a new
      // wheel tick while rotating) computes the ruler's ground-ray crossing
      // from the PREVIOUS frame's camera transform, then self-corrects next
      // frame once render() catches up — visible as the ruler numbers
      // "jiggling on the opposite axis to the one they label" while
      // rotating (the stale-vs-correct values differ mostly in the
      // off-axis/perpendicular coordinate, since each label's OWN-axis
      // position is quantized to a grid step and doesn't visibly move for
      // a one-frame swap).
      cam.updateMatrixWorld();
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
      // Construction-line dashes are world lengths, so a fixed dash reads as a
      // solid line once the view zooms in. Size them per frame from the same
      // measure the gizmos use, in pixels of canvas height, so a construction
      // line looks equally dashed at every zoom. The camera target stands in
      // for depth under perspective; sketch work sits on or near it.
      applyScreenDashes(
        (gizmoScale(targetRef.current) * REFERENCE_HEIGHT) /
          (renderer.domElement.clientHeight || 1),
      );
      if (axisGroupRef?.current && axisGroupRef.current.visible) {
        // Pin the XYZ indicator to the view centre (the camera target) so it
        // stays on-screen as the view pans, rather than scrolling off with the
        // world origin.  The arrows still point along the true world axes.
        // panelAwareLookAt already renders the target at the centre of the
        // *visible* 3D area (clear of the objects/timeline panel), so no
        // extra screen-space shift is needed here.
        axisGroupRef.current.position.copy(targetRef.current);
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
          const isLabel =
            o.isSprite &&
            (o.userData.isConstraintObj || o.userData.isCornerDim);
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
        // Where the ruler's two rows CROSS is rebuilt fresh, every frame, from
        // the camera's OWN forward ray through the visible area's centre (the
        // canvas minus the left panel) intersected with the ground — never
        // from targetRef.current (the orbit pivot), which navigation.js's
        // orbit-anchor recentre can reassign instantly out from under it. See
        // groundRayCrossing's doc comment (sceneSetup.js) for why chasing that
        // reassignment with a glide never fully closed the gap.
        const canvasWForRuler = renderer.domElement.clientWidth || 1;
        const panelForRuler = Math.min(LEFT_PANEL_PX, canvasWForRuler * 0.8);
        const ndcXForRuler = panelForRuler / canvasWForRuler;
        _rulerNdcPoint.set(ndcXForRuler, 0, 0.5).unproject(cam);
        _rulerCamDir.subVectors(_rulerNdcPoint, cam.position);
        _rulerCrossState = groundRayCrossing(
          cam.position,
          _rulerCamDir,
          _rulerCrossState,
        );
        const viewHeight =
          gizmoScale(
            _rulerNdcPoint.set(_rulerCrossState.x, 0, _rulerCrossState.z),
          ) * REFERENCE_HEIGHT;
        updateRuler3D(
          rulerGroup,
          _rulerCrossState.x,
          _rulerCrossState.z,
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
        const canvasHRuler = renderer.domElement.clientHeight || 1;
        cam.getWorldDirection(_camForward);
        rulerGroup.traverse((o) => {
          if (!o.userData.isRulerLabel) return;
          const b = o.userData.baseScale;
          _rulerPos.setFromMatrixPosition(o.matrixWorld);
          const sp = gizmoScale(_rulerPos);
          o.scale.set(b.x * sp, b.y * sp, b.z * sp);
          // Fade a label out once its own on-screen gap to the NEXT grid step
          // collapses below a legible width.  A row viewed nearly edge-on (the
          // camera's forward direction close to parallel with the row — which
          // happens continuously while orbiting) compresses evenly-spaced
          // world points toward the vanishing point; same-size text there
          // overlaps its neighbours into an illegible garbled cluster — read as
          // "the ruler numbers jump around" while rotating.  Same-size labels
          // can't fix POSITION compression, only skipping the crowded ones can.
          const axis = o.userData.gridAxis;
          const step = o.userData.gridStep;
          if (axis && step && o.material) {
            _rulerNext.copy(_rulerPos);
            if (axis === "x") _rulerNext.x += step;
            else _rulerNext.z += step;
            // A "next" point behind the camera isn't actually crowding this
            // on-screen label — skip the (invalid) projection-based check and
            // stay fully opaque.  See pointBehindCamera's doc comment.
            if (pointBehindCamera(_rulerNext, cam.position, _camForward)) {
              o.material.opacity = 1;
              o.visible = true;
              return;
            }
            _rulerPos.project(cam);
            _rulerNext.project(cam);
            const pxGap = ndcGapPx(
              _rulerPos,
              _rulerNext,
              canvasWForRuler,
              canvasHRuler,
            );
            const t = rulerFadeOpacity(pxGap);
            o.material.opacity = t;
            o.visible = t > 0.01;
          }
        });
      }
    }
    gridMaterial.uniforms.uCameraPos.value.copy(cameraRef.current.position);
    // Keep the cross-section cut locked to the camera as it orbits / pans,
    // re-pose the hatched caps, and feed the view-space plane to the analytic
    // primitive shaders (they clip their computed surface point themselves).
    const animActive = !!cameraAnimRef.current;
    if (useStore.getState().crossSectionView) {
      const cam = cameraRef.current;
      const cc = cameraControlsRef?.current;
      // Freeze the camera: snapshot the pose when cross-section starts (or just
      // after a camera animation ends), then hold it there every frame so orbit
      // /pan gestures move the CUT rather than the view.
      if (!frozenPose || (prevAnimActive && !animActive)) {
        frozenPose = {
          pos: cam.position.clone(),
          quat: cam.quaternion.clone(),
          rotX: cc ? cc.targetRotationX : 0,
          rotY: cc ? cc.targetRotationY : 0,
        };
      }
      if (!animActive && frozenPose) {
        cam.position.copy(frozenPose.pos);
        cam.quaternion.copy(frozenPose.quat);
        cam.updateMatrixWorld(true);
      }
      // The cut spins with the live orbit angles even though the camera is held.
      const orient = cc
        ? orientationFromAngles(cc.targetRotationX, cc.targetRotationY)
        : cam.quaternion;
      updateCrossSectionPlane(orient, targetRef.current);
      updateCaps(CROSS_SECTION_PLANE, targetRef.current);
      const vp = crossSectionViewPlane(cam);
      Object.values(objectsRef.current).forEach((mesh) => {
        const u = mesh.userData.shaderMat?.uniforms;
        if (u?.uClipEnabled) {
          u.uClipNormal.value.copy(vp.normal);
          u.uClipConstant.value = vp.constant;
        }
      });
    } else if (frozenPose) {
      // Leaving cross-section: put the orbit angles back where the frozen camera
      // is, so exiting doesn't snap the view to wherever the cut was dragged to.
      if (cameraControlsRef?.current && frozenPose.rotX != null) {
        cameraControlsRef.current.targetRotationX = frozenPose.rotX;
        cameraControlsRef.current.targetRotationY = frozenPose.rotY;
      }
      frozenPose = null;
    }
    prevAnimActive = animActive;
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
    stop: () => {
      cancelAnimationFrame(animId);
      unsubscribe();
      for (const ev of activityEvents)
        canvas.removeEventListener(ev, onActivity);
      window.removeEventListener("resize", onActivity);
    },
  };
}
