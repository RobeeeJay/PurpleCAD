// Per-frame render loop: drives the camera fly-in tween, repositions
// the sketch-grid origin to track the orbit target while in sketch
// mode, keeps the axis indicator + transform handles + bounding-box
// dimension labels at a constant on-screen size, and dispatches to
// the bloom composer (or the raw renderer when smooth mode is off).
// Returns a `stop()` that cancelAnimationFrames the next tick.

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
        // Use the first handle's position as a stand-in for "the gizmo
        // cluster centre"; all handles belong to one selection.
        const ref = handlesRef.current[0].mesh.position;
        const s = gizmoScale(ref);
        handlesRef.current.forEach(({ mesh: hm }) => {
          // Each handle was authored at unit scale; reset rather than
          // multiply so we don't compound across frames.
          if (hm.userData.baseScale == null) hm.userData.baseScale = 1;
          hm.scale.setScalar(hm.userData.baseScale * s);
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
