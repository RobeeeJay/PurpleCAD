// Camera-orientation hooks for the Viewport: the rotation-widget handlers
// (orient-to-face, home/fit-all) plus the effects that switch projection mode,
// keep sketch mode orthographic, and handle the camera-reset trigger.  Split
// out of Viewport.jsx to keep that component focused on scene wiring.

import { useEffect, useCallback } from "react";
import * as THREE from "three";
import { useStore } from "../../store";
import { saveCameraState } from "../../three/cameraControls.js";

export function useViewportCamera({
  containerRef,
  sceneRef,
  cameraRef,
  rendererRef,
  cameraControlsRef,
  targetRef,
  cameraAnimRef,
  composerRef,
  objectsRef,
  itemsRef,
  projectionMode,
  fov,
  isInSketchMode,
  cameraResetTrigger,
  setRotationState,
}) {
  const handleOrientationChange = useCallback((targetRotX, targetRotY) => {
    if (!cameraRef.current || !cameraControlsRef.current) return;
    const camera = cameraRef.current;
    const controls = cameraControlsRef.current;
    const distance = camera.position.distanceTo(targetRef.current);
    const endPos = new THREE.Vector3(
      targetRef.current.x +
        Math.sin(targetRotY) * Math.cos(targetRotX) * distance,
      targetRef.current.y + Math.sin(targetRotX) * distance,
      targetRef.current.z +
        Math.cos(targetRotY) * Math.cos(targetRotX) * distance,
    );
    cameraAnimRef.current = {
      startPos: camera.position.clone(),
      endPos,
      startTarget: targetRef.current.clone(),
      endTarget: targetRef.current.clone(),
      startUp: camera.up.clone(),
      endUp: new THREE.Vector3(0, 1, 0),
      startTime: Date.now(),
      duration: 300,
      onComplete: () => {
        controls.targetRotationX = targetRotX;
        controls.targetRotationY = targetRotY;
        saveCameraState(cameraRef, targetRef, cameraControlsRef);
      },
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Home button: orient isometric AND frame all visible models. Falls back to
  // a pure reorient (current target + distance) when the scene is empty.
  const handleHome = useCallback(() => {
    const camera = cameraRef.current;
    const controls = cameraControlsRef.current;
    if (!camera || !controls) return;
    const rotX = Math.asin(Math.sqrt(1 / 3));
    const rotY = Math.PI / 4;
    const dir = new THREE.Vector3(
      Math.sin(rotY) * Math.cos(rotX),
      Math.sin(rotX),
      Math.cos(rotY) * Math.cos(rotX),
    ).normalize();

    const box = new THREE.Box3();
    let any = false;
    for (const item of itemsRef.current) {
      if (item.type === "sketch" || item.visible === false) continue;
      const mesh = objectsRef.current[item.id];
      if (!mesh) continue;
      mesh.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(mesh);
      if (b.isEmpty()) continue;
      box.union(b);
      any = true;
    }

    let center, distance;
    let endZoom = null;
    if (any) {
      center = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
      const pad = 1.25;
      if (camera.isOrthographicCamera) {
        const fw = camera.right - camera.left;
        const fh = camera.top - camera.bottom;
        // zoom small enough that the tighter frustum dimension still spans the bbox
        endZoom = Math.min(fw, fh) / (2 * radius * pad);
        distance = radius * 4 + 5; // clear of the 0.1–1000 near/far planes
      } else {
        const vfov = (camera.fov * Math.PI) / 180;
        const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
        const fitFov = Math.min(vfov, hfov);
        distance = (radius * pad) / Math.sin(fitFov / 2);
      }
    } else {
      center = targetRef.current.clone();
      distance = camera.position.distanceTo(targetRef.current);
    }

    cameraAnimRef.current = {
      startPos: camera.position.clone(),
      endPos: center.clone().addScaledVector(dir, distance),
      startTarget: targetRef.current.clone(),
      endTarget: center,
      startUp: camera.up.clone(),
      endUp: new THREE.Vector3(0, 1, 0),
      startZoom: camera.isOrthographicCamera ? camera.zoom : null,
      endZoom,
      startTime: Date.now(),
      duration: 400,
      onComplete: () => {
        controls.targetRotationX = rotX;
        controls.targetRotationY = rotY;
        saveCameraState(cameraRef, targetRef, cameraControlsRef);
      },
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Projection mode switch ────────────────────────────────────────────────
  useEffect(() => {
    if (!cameraRef.current || !containerRef.current || !rendererRef.current)
      return;
    const container = containerRef.current;
    const renderer = rendererRef.current;
    const currentCamera = cameraRef.current;
    const currentRotX = cameraControlsRef.current.targetRotationX;
    const currentRotY = cameraControlsRef.current.targetRotationY;
    const currentPosition = currentCamera.position.clone();
    const aspect = container.clientWidth / container.clientHeight;
    const frustumSize = 20;
    let newCamera;
    if (projectionMode === "orthographic") {
      newCamera = new THREE.OrthographicCamera(
        (-frustumSize * aspect) / 2,
        (frustumSize * aspect) / 2,
        frustumSize / 2,
        -frustumSize / 2,
        0.1,
        1000,
      );
      const distance = Math.max(
        10,
        currentPosition.distanceTo(targetRef.current),
      );
      newCamera.position.set(
        targetRef.current.x +
          Math.sin(currentRotY) * Math.cos(currentRotX) * distance,
        targetRef.current.y + Math.sin(currentRotX) * distance,
        targetRef.current.z +
          Math.cos(currentRotY) * Math.cos(currentRotX) * distance,
      );
    } else {
      newCamera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 1000);
      newCamera.position.copy(currentPosition);
    }
    newCamera.lookAt(targetRef.current);
    currentCamera.children.forEach((child) => {
      if (child instanceof THREE.Light) {
        currentCamera.remove(child);
        newCamera.add(child);
      }
    });
    sceneRef.current.remove(currentCamera);
    sceneRef.current.add(newCamera);
    cameraRef.current = newCamera;
    if (composerRef.current && composerRef.current.passes.length > 0)
      composerRef.current.passes[0].camera = newCamera;
    renderer.clear();
    renderer.render(sceneRef.current, newCamera);
  }, [projectionMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live-update the perspective field of view (the Settings dialog) without
  // recreating the camera.  Orthographic / sketch mode has no FOV to set.
  useEffect(() => {
    const cam = cameraRef.current;
    if (cam?.isPerspectiveCamera) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }, [fov]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sketch mode must stay orthographic so the 3D geometry seen behind the
  // sketch plane is a parallel projection (no perspective foreshortening).
  // useSketchModeEffect forces this once on entry; this keeps it enforced if
  // the projection is toggled to perspective while a sketch is still active.
  useEffect(() => {
    if (isInSketchMode && projectionMode !== "orthographic") {
      useStore.getState().setProjectionMode("orthographic");
    }
  }, [isInSketchMode, projectionMode]);

  // ── Camera reset ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (
      !cameraRef.current ||
      !cameraControlsRef.current ||
      cameraResetTrigger === 0
    )
      return;
    const camera = cameraRef.current;
    const controls = cameraControlsRef.current;
    targetRef.current.set(0, 0, 0);
    controls.targetRotationX = Math.asin(Math.sqrt(1 / 3));
    controls.targetRotationY = Math.PI / 4;
    camera.position.set(10, 10, 10);
    camera.lookAt(targetRef.current);
    setRotationState(camera.quaternion.clone());
  }, [cameraResetTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  return { handleOrientationChange, handleHome };
}
