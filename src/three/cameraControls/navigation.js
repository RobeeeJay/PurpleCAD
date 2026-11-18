// Camera navigation: mouse-wheel (sketch pan / ctrl-zoom / meta-pan / shift-
// orbit / scroll-pan), and zoomBy for a pinch (touchInput.js).  Shared by
// both sketch and 3D view modes.  Split out of cameraControls.js.

import * as THREE from "three";
import { panelAwareLookAt } from "../sceneSetup.js";

// World units per screen pixel at the pivot's distance.
export function worldPerPixel(camera, target, rectHeight) {
  return camera.isPerspectiveCamera
    ? (2 *
        camera.position.distanceTo(target) *
        Math.tan((camera.fov * Math.PI) / 360)) /
        rectHeight
    : // Orthographic: the visible world height is (top - bottom) / zoom, so
      // the world-per-pixel must divide by zoom -- otherwise panning moves
      // too far zoomed in and too little zoomed out.
      (camera.top - camera.bottom) / camera.zoom / rectHeight;
}

// The plain scroll pan never leaves the ground plane: sideways scroll moves
// along the view's right, flattened onto the ground, and vertical scroll
// along its forward direction.  It used to raycast the screen onto the
// ground, which a level view (Right, Front) never meets: the pan fell back to
// moving the camera straight up, and sideways scroll did nothing.
// Vertical scroll is scaled the way a ground point under the cursor moves --
// by 1 / sin(tilt) -- clamped so a level view doesn't race off.
const MIN_PAN_TILT_SIN = 0.35;
export function groundPanOffset(camera, target, dx, dy, rectHeight) {
  const wpp = worldPerPixel(camera, target, rectHeight);
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  right.y = 0;
  right.normalize();
  // Forward and screen-up flatten to the same ground direction, and their
  // sum never vanishes: forward is level in a side view, screen-up in a top
  // one.
  const ahead = forward.clone().add(up);
  ahead.y = 0;
  ahead.normalize();
  const tilt = Math.max(Math.abs(forward.y), MIN_PAN_TILT_SIN);
  return new THREE.Vector3()
    .addScaledVector(right, dx * wpp)
    .addScaledVector(ahead, (-dy * wpp) / tilt);
}

export function createNavigationHandlers(
  {
    cameraRef,
    targetRef,
    renderer,
    sketchModeRef,
    raycasterRef,
    sceneRef,
    objectsRef,
    itemsRef,
    cameraControlsRef,
    orbitIndicator,
    cameraAnimRef,
  },
  { save, setRotationState, getOrbitAnchor, setOrbitAnchor, isMac },
) {
  const controls = cameraControlsRef.current;
  // Read-only, for e2e: the orbit pivot's spot and the camera it is seen
  // through (mouse-navigation.spec.js).
  controls.getOrbitIndicator = () => ({
    spot: orbitIndicator,
    cam: cameraRef.current,
  });

  let shiftScrollSessionTimer = null;
  // Fraction of the current view distance the fresh anchor raycast must
  // differ from the EXISTING pivot by before we treat it as a real move (a
  // pan) rather than resampling noise. The panel-shifted crosshair ray isn't
  // the rotation axis itself, so re-sampling it while orbiting a fixed pivot
  // traces a cone around it and lands on a slightly different point every
  // time EVEN WITH NO PAN AT ALL — purely from the camera having rotated
  // during the session that just ended. Gating on "did a pan branch run"
  // isn't reliable either: real trackpad hardware can misclassify an event
  // (momentum-scroll tail after a pan, or a modifier-key race on the first
  // event of a new gesture), so this compares the RAYCAST RESULT against the
  // current pivot directly — ground truth, not an event-classification
  // proxy — and only re-anchors when the two genuinely disagree by more than
  // resampling noise.
  const ANCHOR_STABLE_FRACTION = 0.05;

  // Sketch mode has no orbit-pivot concept (it uses screen-locked HTML
  // rulers, not a 3D ground ruler/pivot ring) so it keeps plain symmetric
  // lookAt; every 3D-view orbit/pan/zoom site applies the same compensating
  // yaw so the visible-area centre (not raw canvas centre) is what actually
  // stays fixed under the cursor/pivot.
  const lookAtView = (cam, tgt) => {
    if (sketchModeRef.current) cam.lookAt(tgt);
    else panelAwareLookAt(cam, tgt, renderer.domElement.clientWidth);
  };

  // The user's own navigation beats a camera tween (Home, a view-cube face,
  // entering a sketch).  Left running, the tween's onComplete set the orbit
  // angles back to its end pose and threw away every orbit, pan and zoom made
  // while it ran.  Jump to its end instead -- its onComplete still runs, so
  // what it does besides the angles (saving the view, leaving a sketch) is
  // kept -- and apply the input from there.
  const finishCameraTween = () => {
    const anim = cameraAnimRef.current;
    if (!anim) return;
    cameraAnimRef.current = null;
    const cam = cameraRef.current;
    cam.position.copy(anim.endPos);
    targetRef.current.copy(anim.endTarget);
    cam.up.copy(anim.endUp).normalize();
    if (anim.endZoom != null) {
      cam.zoom = anim.endZoom;
      cam.updateProjectionMatrix();
    }
    lookAtView(cam, targetRef.current);
    anim.onComplete?.();
  };

  const onMouseWheel = (e) => {
    e.preventDefault();
    const currentCamera = cameraRef.current;
    if (!currentCamera) return;
    finishCameraTween();

    if (sketchModeRef.current && !(e.ctrlKey && isMac)) {
      const forward = new THREE.Vector3();
      currentCamera.getWorldDirection(forward);
      const right = new THREE.Vector3()
        .crossVectors(forward, currentCamera.up)
        .normalize();
      const rect = renderer.domElement.getBoundingClientRect();
      const worldPerPx = worldPerPixel(
        currentCamera,
        targetRef.current,
        rect.height,
      );
      const panSpeed = worldPerPx * 1.2;
      const offset = new THREE.Vector3()
        .addScaledVector(right, e.deltaX * panSpeed)
        .addScaledVector(currentCamera.up, -e.deltaY * panSpeed);
      currentCamera.position.add(offset);
      targetRef.current.add(offset);
      currentCamera.lookAt(targetRef.current);
      save();
      return;
    }

    if (e.ctrlKey && isMac) {
      const scale = Math.exp(-e.deltaY * 0.04);
      const tgt = targetRef.current;
      if (currentCamera instanceof THREE.OrthographicCamera) {
        currentCamera.zoom = Math.max(
          0.05,
          Math.min(50, currentCamera.zoom * scale),
        );
        currentCamera.updateProjectionMatrix();
      } else {
        const dir = new THREE.Vector3().subVectors(currentCamera.position, tgt);
        const newDist = Math.max(0.5, Math.min(500, dir.length() / scale));
        currentCamera.position
          .copy(tgt)
          .addScaledVector(dir.normalize(), newDist);
        lookAtView(currentCamera, tgt);
      }
      setRotationState(currentCamera.quaternion.clone());
      save();
      return;
    }

    if (e.metaKey || (e.ctrlKey && !isMac)) {
      const rect = renderer.domElement.getBoundingClientRect();
      const worldPerPx = worldPerPixel(
        currentCamera,
        targetRef.current,
        rect.height,
      );
      const forward = new THREE.Vector3();
      currentCamera.getWorldDirection(forward);
      const right = new THREE.Vector3()
        .crossVectors(forward, currentCamera.up)
        .normalize();
      const up = currentCamera.up.clone().normalize();
      const offset = new THREE.Vector3()
        .addScaledVector(right, e.deltaX * worldPerPx)
        .addScaledVector(up, -e.deltaY * worldPerPx);
      currentCamera.position.add(offset);
      targetRef.current.add(offset);
      lookAtView(currentCamera, targetRef.current);
      setRotationState(currentCamera.quaternion.clone());
      save();
      return;
    }

    if (e.shiftKey) {
      if (shiftScrollSessionTimer === null) {
        const freshAnchor = getOrbitAnchor(
          cameraRef,
          targetRef,
          raycasterRef,
          sceneRef,
          objectsRef,
          itemsRef,
          renderer,
        );
        const viewDist = currentCamera.position.distanceTo(targetRef.current);
        const anchorDrift = freshAnchor.distanceTo(targetRef.current);
        if (anchorDrift > viewDist * ANCHOR_STABLE_FRACTION) {
          setOrbitAnchor(
            freshAnchor,
            cameraRef,
            targetRef,
            cameraControlsRef,
            orbitIndicator,
          );
        } else {
          // The fresh raycast landed close to the EXISTING pivot: resampling
          // noise (a pause, not a real pan), so don't touch target/rotation —
          // just re-show the ring where it already is.
          orbitIndicator.position.copy(targetRef.current);
          orbitIndicator.visible = true;
        }
      }
      clearTimeout(shiftScrollSessionTimer);
      shiftScrollSessionTimer = setTimeout(() => {
        shiftScrollSessionTimer = null;
        orbitIndicator.visible = false;
      }, 400);

      const rotSpeed = 0.004;
      controls.targetRotationY += e.deltaX * rotSpeed;
      controls.targetRotationX -= e.deltaY * rotSpeed;
      controls.targetRotationX = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, controls.targetRotationX),
      );
      const distance = currentCamera.position.distanceTo(targetRef.current);
      currentCamera.position.x =
        targetRef.current.x +
        Math.sin(controls.targetRotationY) *
          Math.cos(controls.targetRotationX) *
          distance;
      currentCamera.position.y =
        targetRef.current.y + Math.sin(controls.targetRotationX) * distance;
      currentCamera.position.z =
        targetRef.current.z +
        Math.cos(controls.targetRotationY) *
          Math.cos(controls.targetRotationX) *
          distance;
      lookAtView(currentCamera, targetRef.current);
      setRotationState(currentCamera.quaternion.clone());
    } else {
      const rect = renderer.domElement.getBoundingClientRect();
      const offset = groundPanOffset(
        currentCamera,
        targetRef.current,
        e.deltaX,
        e.deltaY,
        rect.height,
      );
      currentCamera.position.add(offset);
      targetRef.current.add(offset);
      lookAtView(currentCamera, targetRef.current);
    }
    save();
  };

  // Zoom about the pivot by a factor (> 1 closer): a pinch (touchInput.js).
  const zoomBy = (scale) => {
    const cam = cameraRef.current;
    const tgt = targetRef.current;
    if (!cam) return;
    finishCameraTween();
    if (cam instanceof THREE.OrthographicCamera) {
      cam.zoom = Math.max(0.05, Math.min(50, cam.zoom * scale));
      cam.updateProjectionMatrix();
    } else {
      const dir = new THREE.Vector3().subVectors(cam.position, tgt);
      const newCamDist = Math.max(0.5, Math.min(500, dir.length() / scale));
      cam.position.copy(tgt).addScaledVector(dir.normalize(), newCamDist);
      lookAtView(cam, tgt);
    }
    setRotationState(cam.quaternion.clone());
    save();
  };

  const disposeNavigation = () => clearTimeout(shiftScrollSessionTimer);

  return {
    onMouseWheel,
    zoomBy,
    disposeNavigation,
  };
}
