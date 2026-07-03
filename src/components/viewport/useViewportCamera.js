// Camera-orientation hooks for the Viewport: the rotation-widget handlers
// (orient-to-face, home/fit-all) plus the effects that switch projection mode,
// keep sketch mode orthographic, and handle the camera-reset trigger.  Split
// out of Viewport.jsx to keep that component focused on scene wiring.

import { useEffect, useCallback } from "react";
import * as THREE from "three";
import { useStore } from "../../store";
import { saveCameraState } from "../../three/cameraControls.js";
import { primitiveDimensions } from "../../three/sceneObjects/dimensions.js";

// Local-space silhouette samples for the round primitives.  Their meshes are
// rendered by an analytic shader inside an enclosing BoxGeometry hull, so the
// mesh AABB is the 2r cube — much larger than the visible shape.  Framing that
// hull leaves spheres/cylinders/cones filling barely half the view.  Sampling
// the true surface lets the fit frame what the user actually sees.  Returns
// null for anything that isn't a round primitive (use its real AABB instead).
function analyticLocalPoints(item) {
  const t = item?.type;
  if (t !== "sphere" && t !== "cylinder" && t !== "cone" && t !== "torus")
    return null;
  const d = primitiveDimensions(item);
  const pts = [];
  const RING = 24;
  if (t === "sphere") {
    const r = d.radius;
    for (let a = 0; a < RING; a++) {
      const th = (a / RING) * 2 * Math.PI;
      for (const ph of [Math.PI * 0.25, Math.PI * 0.5, Math.PI * 0.75])
        pts.push(
          new THREE.Vector3(
            r * Math.sin(ph) * Math.cos(th),
            r * Math.cos(ph),
            r * Math.sin(ph) * Math.sin(th),
          ),
        );
    }
    pts.push(new THREE.Vector3(0, r, 0), new THREE.Vector3(0, -r, 0));
  } else if (t === "cylinder") {
    const r = d.radius;
    const h = d.height / 2;
    for (let a = 0; a < RING; a++) {
      const th = (a / RING) * 2 * Math.PI;
      const x = r * Math.cos(th);
      const z = r * Math.sin(th);
      pts.push(new THREE.Vector3(x, h, z), new THREE.Vector3(x, -h, z));
    }
  } else if (t === "cone") {
    const rb = d.radiusBottom;
    const rt = d.radiusTop;
    const h = d.height / 2;
    for (let a = 0; a < RING; a++) {
      const th = (a / RING) * 2 * Math.PI;
      const c = Math.cos(th);
      const s = Math.sin(th);
      pts.push(
        new THREE.Vector3(rb * c, -h, rb * s),
        new THREE.Vector3(rt * c, h, rt * s),
      );
    }
  } else {
    // torus: ring in the XZ plane, tube radius `minor` reaching ±minor in Y
    const R = d.major;
    const m = d.minor;
    for (let a = 0; a < RING; a++) {
      const th = (a / RING) * 2 * Math.PI;
      const c = Math.cos(th);
      const s = Math.sin(th);
      pts.push(
        new THREE.Vector3((R + m) * c, 0, (R + m) * s),
        new THREE.Vector3((R - m) * c, 0, (R - m) * s),
        new THREE.Vector3(R * c, m, R * s),
        new THREE.Vector3(R * c, -m, R * s),
      );
    }
  }
  return pts;
}

// Width (px) of the objects/timeline overlay that floats over the LEFT of the
// canvas.  The 3D canvas spans the full width, but this strip is obscured, so
// "centred" means centred in the visible region to its right.  Mirrors the
// value the animate loop uses to place the axis indicator.
const LEFT_PANEL_PX = 250;

// Frame a world-space point cloud so its tightest extent fills `fill` of the
// USABLE view rectangle (0.9 == 90%, leaving a small margin) with the object
// centred in that rectangle — same isometric direction `dir`, up = +Y.  The
// usable rectangle is given in NDC as `frame` = { cx, cy, halfW, halfH } (the
// centre and half-extents of the un-obscured area; default is the whole
// [-1,1] frame).  Returns { target, distance, endZoom } (endZoom for ortho).
//
// Perspective is the hard case: the world-bbox centre does NOT project to the
// frame centre for a spread-out / asymmetric layout, so a naive "frame the max
// |offset| about the bbox centre" leaves everything jammed against one edge.
// We instead solve for the exact minimum camera distance D and a lateral
// offset (a,b) of the view centre such that every point lands inside the target
// rectangle.  Feasibility at a given D is a simple interval test per axis;
// binary-search D for the tightest fit, then balance each axis so the projected
// extent is centred on the rectangle.  Provably tight and never clips.
function fitPointsToView(
  pts,
  dir,
  camera,
  fill,
  frame = { cx: 0, cy: 0, halfW: 1, halfH: 1 },
) {
  const zAxis = dir.clone().normalize();
  const xAxis = new THREE.Vector3()
    .crossVectors(new THREE.Vector3(0, 1, 0), zAxis)
    .normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  const origin = new THREE.Box3()
    .setFromPoints(pts)
    .getCenter(new THREE.Vector3());

  // Target NDC window per axis: centre and half-range (fill of the usable half).
  const Rx = fill * frame.halfW;
  const Ry = fill * frame.halfH;
  const cX = frame.cx;
  const cY = frame.cy;

  // View-frame coordinates of every point relative to `origin`.
  const U = [];
  const V = [];
  const W = [];
  const p = new THREE.Vector3();
  let maxW = -Infinity;
  let minW = Infinity;
  for (const q of pts) {
    p.copy(q).sub(origin);
    U.push(p.dot(xAxis));
    V.push(p.dot(yAxis));
    const w = p.dot(zAxis);
    W.push(w);
    if (w > maxW) maxW = w;
    if (w < minW) minW = w;
  }
  const wc = (minW + maxW) / 2;

  if (camera.isOrthographicCamera) {
    // Parallel projection: exact centred fit in one shot, no depth coupling.
    let uMn = Infinity,
      uMx = -Infinity,
      vMn = Infinity,
      vMx = -Infinity;
    for (let i = 0; i < U.length; i++) {
      if (U[i] < uMn) uMn = U[i];
      if (U[i] > uMx) uMx = U[i];
      if (V[i] < vMn) vMn = V[i];
      if (V[i] > vMx) vMx = V[i];
    }
    const spanU = Math.max(uMx - uMn, 1e-4);
    const spanV = Math.max(vMx - vMn, 1e-4);
    const fw = camera.right - camera.left;
    const fh = camera.top - camera.bottom;
    // Zoom so the cloud's projected half-extent reaches the target half-range.
    const endZoom = Math.min((Rx * fw) / spanU, (Ry * fh) / spanV);
    // Offset the look-at point so the cloud centre lands on the window centre.
    const a = (uMn + uMx) / 2 - (cX * fw) / (2 * endZoom);
    const b = (vMn + vMx) / 2 - (cY * fh) / (2 * endZoom);
    const target = origin
      .clone()
      .addScaledVector(xAxis, a)
      .addScaledVector(yAxis, b)
      .addScaledVector(zAxis, wc);
    return { target, distance: maxW - wc + 5, endZoom };
  }

  // Perspective.  ndc for a point at depth w and lateral u, camera at depth D
  // and lateral offset a:  ndc = (u - a) / ((D - w) * tan).  Requiring
  // ndc ∈ [c - R, c + R] gives a feasible interval for a; the axis is fittable
  // at D iff that interval is non-empty (and every point is in front of the eye).
  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  const tanH = tanV * camera.aspect;
  const interval = (arr, tan, D, c, R) => {
    let lo = -Infinity;
    let hi = Infinity;
    for (let i = 0; i < arr.length; i++) {
      const m = tan * (D - W[i]);
      if (m <= 0) return null; // point at/behind the eye
      lo = Math.max(lo, arr[i] - (c + R) * m);
      hi = Math.min(hi, arr[i] - (c - R) * m);
    }
    return lo <= hi ? [lo, hi] : null;
  };
  const feasible = (D) =>
    D > maxW &&
    !!interval(U, tanH, D, cX, Rx) &&
    !!interval(V, tanV, D, cY, Ry);

  const bs = new THREE.Sphere();
  new THREE.Box3().setFromPoints(pts).getBoundingSphere(bs);
  let dHi =
    maxW +
    (bs.radius / (Math.min(Rx, Ry) * Math.min(tanH, tanV))) * 2 +
    bs.radius +
    1;
  while (!feasible(dHi)) dHi *= 2;
  let dLo = maxW + 1e-6;
  for (let it = 0; it < 60; it++) {
    const dm = (dLo + dHi) / 2;
    if (feasible(dm)) dHi = dm;
    else dLo = dm;
  }
  const D = dHi;

  // Balance each axis: pick the offset that centres the projected extent on the
  // window centre (make max−c == c−min).  The binding axis interval collapses
  // to a point (already centred); the loose axis gets centred here.
  const balance = (arr, tan, c, R) => {
    const iv = interval(arr, tan, D, c, R);
    let lo = iv[0];
    let hi = iv[1];
    for (let it = 0; it < 50; it++) {
      const a = (lo + hi) / 2;
      let gMax = -Infinity;
      let gMin = Infinity;
      for (let i = 0; i < arr.length; i++) {
        const n = (arr[i] - a) / ((D - W[i]) * tan);
        if (n > gMax) gMax = n;
        if (n < gMin) gMin = n;
      }
      // Increasing a lowers every ndc; drive the midpoint toward c.
      if (gMax + gMin > 2 * c) lo = a;
      else hi = a;
    }
    return (lo + hi) / 2;
  };
  const a = balance(U, tanH, cX, Rx);
  const b = balance(V, tanV, cY, Ry);
  const target = origin
    .clone()
    .addScaledVector(xAxis, a)
    .addScaledVector(yAxis, b)
    .addScaledVector(zAxis, wc);
  return { target, distance: D - wc, endZoom: null };
}

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

    // Collect world-space sample points to fit — the TRUE silhouette for round
    // primitives (see analyticLocalPoints), the real AABB corners for
    // everything else.  Framing points (not unioned AABBs) is what lets the
    // fit ignore the oversized shader-hull box around a sphere/cylinder.
    const pts = [];
    const _m = new THREE.Matrix4();
    for (const item of itemsRef.current) {
      if (item.type === "sketch" || item.visible === false) continue;
      const mesh = objectsRef.current[item.id];
      if (!mesh) continue;
      mesh.updateMatrixWorld(true);
      const local = analyticLocalPoints(item);
      if (local) {
        _m.copy(mesh.matrixWorld);
        for (const lp of local) pts.push(lp.clone().applyMatrix4(_m));
      } else {
        const b = new THREE.Box3().setFromObject(mesh);
        if (b.isEmpty()) continue;
        for (let i = 0; i < 8; i++)
          pts.push(
            new THREE.Vector3(
              i & 1 ? b.max.x : b.min.x,
              i & 2 ? b.max.y : b.min.y,
              i & 4 ? b.max.z : b.min.z,
            ),
          );
      }
    }
    // Include the drawn sketch geometry (the object-view line overlays) when
    // it's visible, so a reset frames sketches too — not their 1000-unit plane
    // (that's the mesh in objectsRef), just the shapes.
    sceneRef.current?.traverse((o) => {
      if (!o.userData?.isSketchOverlay || !o.visible) return;
      o.updateWorldMatrix(true, true);
      const b = new THREE.Box3().setFromObject(o);
      if (b.isEmpty()) return;
      for (let i = 0; i < 8; i++)
        pts.push(
          new THREE.Vector3(
            i & 1 ? b.max.x : b.min.x,
            i & 2 ? b.max.y : b.min.y,
            i & 4 ? b.max.z : b.min.z,
          ),
        );
    });

    let center, distance;
    let endZoom = null;
    const any = pts.length > 0;
    if (any) {
      // The objects/timeline overlay hides a strip on the LEFT of the canvas;
      // frame into the visible region to its right so the model isn't pushed
      // half under the panel.  cx = panel/width is that region's NDC centre;
      // its NDC half-width shrinks by the same fraction.
      const canvasW = rendererRef.current?.domElement?.clientWidth || 1;
      const panel = Math.min(LEFT_PANEL_PX, canvasW * 0.8);
      const frac = panel / canvasW;
      const frame = { cx: frac, cy: 0, halfW: 1 - frac, halfH: 1 };
      // 0.9 == frame the tightest extent to 90% of the usable view, centred.
      const fit = fitPointsToView(pts, dir, camera, 0.9, frame);
      center = fit.target;
      distance = fit.distance;
      endZoom = fit.endZoom;
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
