// Camera navigation: mouse-wheel (sketch pan / ctrl-zoom / meta-pan / shift-
// orbit / scroll-pan) and two-finger touch pinch-zoom.  Shared by both sketch
// and 3D view modes.  Split out of cameraControls.js.

import * as THREE from "three";

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
        : (currentCamera.top - currentCamera.bottom) / rect.height;
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
        currentCamera.lookAt(tgt);
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
        : (currentCamera.top - currentCamera.bottom) / rect.height;
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
      currentCamera.lookAt(targetRef.current);
      setRotationState(currentCamera.quaternion.clone());
      save();
      return;
    }

    if (e.shiftKey) {
      if (shiftScrollSessionTimer === null) {
        setOrbitAnchor(
          getOrbitAnchor(
            cameraRef,
            targetRef,
            raycasterRef,
            sceneRef,
            objectsRef,
            itemsRef,
          ),
          cameraRef,
          targetRef,
          cameraControlsRef,
          orbitIndicator,
        );
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
      currentCamera.lookAt(targetRef.current);
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
      currentCamera.lookAt(targetRef.current);
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
      cam.lookAt(tgt);
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
