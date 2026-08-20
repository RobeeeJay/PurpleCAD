// Camera navigation: mouse-wheel (sketch pan / ctrl-zoom / meta-pan / shift-
// orbit / scroll-pan) and two-finger touch pinch-zoom.  Shared by both sketch
// and 3D view modes.  Split out of cameraControls.js.

import * as THREE from "three";
import { panelAwareLookAt } from "../sceneSetup.js";

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
  },
  { save, setRotationState, getOrbitAnchor, setOrbitAnchor, isMac },
) {
  const controls = cameraControlsRef.current;

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

  const onMouseWheel = (e) => {
    e.preventDefault();
    const currentCamera = cameraRef.current;
    if (!currentCamera) return;

    if (sketchModeRef.current && !(e.ctrlKey && isMac)) {
      const forward = new THREE.Vector3();
      currentCamera.getWorldDirection(forward);
      const right = new THREE.Vector3()
        .crossVectors(forward, currentCamera.up)
        .normalize();
      const rect = renderer.domElement.getBoundingClientRect();
      const worldPerPx = currentCamera.isPerspectiveCamera
        ? (2 *
            currentCamera.position.distanceTo(targetRef.current) *
            Math.tan((currentCamera.fov * Math.PI) / 360)) /
          rect.height
        : // Orthographic: the visible world height is (top - bottom) / zoom, so
          // the world-per-pixel must divide by zoom — otherwise panning moves
          // too far zoomed in and too little zoomed out.
          (currentCamera.top - currentCamera.bottom) /
          currentCamera.zoom /
          rect.height;
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
      const worldPerPx = currentCamera.isPerspectiveCamera
        ? (2 *
            currentCamera.position.distanceTo(targetRef.current) *
            Math.tan((currentCamera.fov * Math.PI) / 360)) /
          rect.height
        : // Orthographic: the visible world height is (top - bottom) / zoom, so
          // the world-per-pixel must divide by zoom — otherwise panning moves
          // too far zoomed in and too little zoomed out.
          (currentCamera.top - currentCamera.bottom) /
          currentCamera.zoom /
          rect.height;
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
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const groundPlane = new THREE.Plane(
        new THREE.Vector3(0, 1, 0),
        -targetRef.current.y,
      );
      const hitAt = (sx, sy) => {
        const nx = ((sx - rect.left) / rect.width) * 2 - 1;
        const ny = -((sy - rect.top) / rect.height) * 2 + 1;
        const r = new THREE.Raycaster();
        r.setFromCamera({ x: nx, y: ny }, currentCamera);
        const h = new THREE.Vector3();
        return r.ray.intersectPlane(groundPlane, h) ? h.clone() : null;
      };
      const h0 = hitAt(cx, cy),
        h1 = hitAt(cx + 100, cy),
        h2 = hitAt(cx, cy + 100);
      if (h0 && h1 && h2) {
        const panDxWorld = new THREE.Vector3()
          .subVectors(h1, h0)
          .divideScalar(100);
        const panDyWorld = new THREE.Vector3()
          .subVectors(h2, h0)
          .divideScalar(100);
        const worldOffset = new THREE.Vector3()
          .addScaledVector(panDxWorld, e.deltaX)
          .addScaledVector(panDyWorld, e.deltaY);
        currentCamera.position.x += worldOffset.x;
        currentCamera.position.z += worldOffset.z;
        targetRef.current.x += worldOffset.x;
        targetRef.current.z += worldOffset.z;
      } else {
        currentCamera.position.y -= e.deltaY * 0.05;
        targetRef.current.y -= e.deltaY * 0.05;
      }
      lookAtView(currentCamera, targetRef.current);
    }
    save();
  };

  // ── Touch pinch-to-zoom ────────────────────────────────────────────────────

  let pinchDist = null;
  const getPinchDist = (touches) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };
  const onTouchStart = (e) => {
    if (e.touches.length === 2) pinchDist = getPinchDist(e.touches);
  };
  const onTouchMove = (e) => {
    if (e.touches.length !== 2 || pinchDist === null) return;
    e.preventDefault();
    const newDist = getPinchDist(e.touches);
    const scale = newDist / pinchDist;
    pinchDist = newDist;
    const cam = cameraRef.current;
    const tgt = targetRef.current;
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
  };
  const onTouchEnd = (e) => {
    if (e.touches.length < 2) pinchDist = null;
  };

  const disposeNavigation = () => clearTimeout(shiftScrollSessionTimer);

  return {
    onMouseWheel,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    disposeNavigation,
  };
}
