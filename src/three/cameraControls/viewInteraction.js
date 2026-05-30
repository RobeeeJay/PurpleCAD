// 3D view-mode pointer interaction: object hover highlighting (plain object
// hover plus edge/face/point modifier modes and sketch-placement-plane hover).
// Object click-select and placement-click are added in onViewMouseUp.  Split
// out of cameraControls.js.

export function createViewInteraction(
  {
    renderer,
    cameraRef,
    mouseRef,
    raycasterRef,
    objectsRef,
    itemsRef,
    sketchPlacementModeRef,
    sketchPlacementPlanesRef,
    cameraControlsRef,
  },
  {
    setHoveredId,
    applyFaceHighlight,
    clearFaceHighlight,
    applyEdgeHighlight,
    clearEdgeHighlight,
    applyPointHighlight,
    clearPointHighlight,
    isMac,
  },
) {
  const controls = cameraControlsRef.current;

  const onViewHover = (e) => {
    const currentCamera = cameraRef.current;
    if (!currentCamera) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycasterRef.current.setFromCamera(mouseRef.current, currentCamera);
    const meshArray = Object.values(objectsRef.current).filter((m) => {
      const it = itemsRef.current.find((i) => i.id === m.userData.itemId);
      return it?.type !== "sketch" && m.visible !== false;
    });
    const intersects = raycasterRef.current.intersectObjects(meshArray, false);

    if (sketchPlacementModeRef.current) {
      setHoveredId(null);
      sketchPlacementPlanesRef.current.forEach(({ mesh }) => {
        mesh.material.opacity = 0.18;
      });
      if (intersects.length > 0) {
        applyFaceHighlight(intersects[0], 0xff8833);
      } else {
        clearFaceHighlight();
        const planeMeshes = sketchPlacementPlanesRef.current.map((p) => p.mesh);
        const planeHits = raycasterRef.current.intersectObjects(
          planeMeshes,
          false,
        );
        if (planeHits.length > 0) planeHits[0].object.material.opacity = 0.45;
      }
    } else {
      // Modifier-key scheme:
      //   • CTRL (Cmd on Mac)        → edge selection mode
      //   • ALT                      → face selection mode
      //   • CTRL + ALT               → point selection mode
      //   • SHIFT (orthogonal)       → additive selection in any of the
      //                                above modes (incl. plain object mode).
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      const edgeMode = cmdOrCtrl && !e.altKey;
      const faceMode = !cmdOrCtrl && e.altKey;
      const pointMode = cmdOrCtrl && e.altKey;

      if (pointMode) {
        setHoveredId(null);
        clearFaceHighlight();
        clearEdgeHighlight();
        if (intersects.length > 0) applyPointHighlight(intersects[0]);
        else clearPointHighlight();
      } else if (edgeMode) {
        setHoveredId(null);
        clearFaceHighlight();
        clearPointHighlight();
        if (intersects.length > 0) applyEdgeHighlight(intersects[0]);
        else clearEdgeHighlight();
      } else if (faceMode) {
        setHoveredId(null);
        clearEdgeHighlight();
        clearPointHighlight();
        if (intersects.length > 0) applyFaceHighlight(intersects[0], 0x88ccff);
        else clearFaceHighlight();
      } else {
        clearFaceHighlight();
        clearEdgeHighlight();
        clearPointHighlight();
        setHoveredId(
          intersects.length > 0
            ? intersects[0].object.userData.itemId || null
            : null,
        );
      }
    }

    controls.mouseX = e.clientX;
    controls.mouseY = e.clientY;
  };

  return { onViewHover };
}
