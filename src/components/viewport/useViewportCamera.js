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
    // Include the drawn sketch geometry (the object-view line overlays) when
    // it's visible, so a reset frames sketches too — not their 1000-unit plane
    // (that's the mesh in objectsRef), just the shapes.
    sceneRef.current?.traverse((o) => {
      if (!o.userData?.isSketchOverlay || !o.visible) return;
      o.updateWorldMatrix(true, true);
      const b = new THREE.Box3().setFromObject(o);
      if (b.isEmpty()) return;
      box.union(b);
      any = true;
    });

    let center, distance;
    let endZoom = null;
    if (any) {
      center = box.getCenter(new THREE.Vector3());
      // Fit to the ACTUAL projected bounding box (its 8 corners in the view
      // frame), not an enclosing sphere — the sphere over-frames non-cube
      // shapes and leaves everything small.  A little margin avoids edge clip.
      const pad = 1.06;
      // Camera basis looking from center + dir back at center (up = +Y).
      const zAxis = dir.clone().normalize(); // camera -> target axis
      const xAxis = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), zAxis)
        .normalize();
      const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
      const tanV = Math.tan((camera.fov * Math.PI) / 360);
      const tanH = tanV * camera.aspect;
      let maxX = 1e-4;
      let maxY = 1e-4;
      let maxZ = 0;
      // For perspective, each corner needs the camera far enough that its own
      // lateral offset fits the frustum AT ITS OWN DEPTH — coupling depth and
      // lateral per corner (taking the maxima separately over-frames deep
      // objects, which is why 3D solids sat small while flat sketches filled).
      let need = 0;
      const p = new THREE.Vector3();
      for (let i = 0; i < 8; i++) {
        p.set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ).sub(center);
        const cx = Math.abs(p.dot(xAxis));
        const cy = Math.abs(p.dot(yAxis));
        const cz = p.dot(zAxis); // +cz is toward the camera
        maxX = Math.max(maxX, cx);
        maxY = Math.max(maxY, cy);
        maxZ = Math.max(maxZ, Math.abs(cz));
        need = Math.max(
          need,
          cz + Math.max((cx * pad) / tanH, (cy * pad) / tanV),
        );
      }
      if (camera.isOrthographicCamera) {
        const fw = camera.right - camera.left;
        const fh = camera.top - camera.bottom;
        endZoom = Math.min(fw / (2 * maxX * pad), fh / (2 * maxY * pad));
        distance = maxZ + 5; // clear of the near/far planes
      } else {
        distance = need;
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

  // ── Camera reset (document / project load) ─────────────────────────────────
  // Reset == the Home button's isometric fit-all, so a loaded project frames
  // its geometry.  Deferred a frame so the new scene's meshes exist before we
  // measure them.
  useEffect(() => {
    if (
      !cameraRef.current ||
      !cameraControlsRef.current ||
      cameraResetTrigger === 0
    )
      return;
    const raf = requestAnimationFrame(() => handleHome());
    return () => cancelAnimationFrame(raf);
  }, [cameraResetTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  return { handleOrientationChange, handleHome };
}
