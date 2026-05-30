// 3D view-mode pointer interaction: object hover highlighting (plain object
// hover, edge/face/point modifier modes, sketch-placement-plane hover) and the
// mouse-up handling (orbit-flag reset, sketch-placement click, and object /
// sub-geometry click-select).  Split out of cameraControls.js.

import * as THREE from "three";
import { useStore } from "../../store";

export function createViewInteraction(
  {
    renderer,
    cameraRef,
    mouseRef,
    raycasterRef,
    objectsRef,
    itemsRef,
    sketchModeRef,
    sketchPlacementModeRef,
    sketchPlacementPlanesRef,
    cameraControlsRef,
    orbitIndicator,
  },
  {
    setHoveredId,
    selectItem,
    save,
    highlights,
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

  const onViewMouseUp = (e) => {
    controls.isRotating = false;
    controls.isPanning = false;
    orbitIndicator.visible = false;

    if (sketchPlacementModeRef.current && e.button === 0) {
      const dx = e.clientX - (controls.mouseDownX || e.clientX);
      const dy = e.clientY - (controls.mouseDownY || e.clientY);
      if (Math.hypot(dx, dy) < 5) {
        const currentCamera = cameraRef.current;
        if (currentCamera) {
          const rect = renderer.domElement.getBoundingClientRect();
          const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          raycasterRef.current.setFromCamera({ x: nx, y: ny }, currentCamera);

          const objHits = raycasterRef.current.intersectObjects(
            Object.values(objectsRef.current).filter(
              (m) => m.visible !== false,
            ),
            false,
          );
          let position, rotation;
          let hostSolidId = null;
          if (objHits.length > 0) {
            const hit = objHits[0];
            const normalMatrix = new THREE.Matrix3().getNormalMatrix(
              hit.object.matrixWorld,
            );
            const worldNormal = hit.face.normal
              .clone()
              .applyMatrix3(normalMatrix)
              .normalize();
            const q = new THREE.Quaternion().setFromUnitVectors(
              new THREE.Vector3(0, 0, 1),
              worldNormal,
            );
            const euler = new THREE.Euler().setFromQuaternion(q);
            position = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
            rotation = { x: euler.x, y: euler.y, z: euler.z };
            // Remember which solid this sketch was placed on so a later
            // cut-extrude from the sketch's loops targets only that
            // solid.  Without this, sketch-loop cuts fall back to
            // "every visible non-sketch solid", which silently turns
            // unrelated primitives into csg items at the same world
            // position (the visible appearance changes from analytic
            // shader to tessellated mesh — the user perceives this as
            // the cut having a wrong origin).
            hostSolidId = hit.object.userData?.itemId ?? null;
          } else {
            const planeMeshes = sketchPlacementPlanesRef.current.map(
              (p) => p.mesh,
            );
            const planeHits = raycasterRef.current.intersectObjects(
              planeMeshes,
              false,
            );
            if (planeHits.length > 0) {
              const hitPlane = sketchPlacementPlanesRef.current.find(
                (p) => p.mesh === planeHits[0].object,
              );
              if (hitPlane) {
                const hp = planeHits[0].point;
                // The placement-plane meshes are drawn at the current
                // camera target so they stay visible to the user, but the
                // canonical XZ/XY/YZ planes themselves pass through the
                // world origin.  Zero out the axis perpendicular to the
                // selected plane so a sketch created on (e.g.) XZ lands
                // at world Y=0 rather than wherever the camera happened
                // to be focused (often on top of the most recent solid).
                const onAxis = { x: hp.x, y: hp.y, z: hp.z };
                if (hitPlane.name === "XZ") onAxis.y = 0;
                else if (hitPlane.name === "XY") onAxis.z = 0;
                else if (hitPlane.name === "YZ") onAxis.x = 0;
                position = onAxis;
                rotation = hitPlane.euler;
              }
            }
          }

          if (position && rotation) {
            const hist = useStore.getState().history;
            let maxId = 0;
            hist.forEach((entry) => {
              if (
                entry.instruction?.type === "create" &&
                entry.instruction.item.id > maxId
              )
                maxId = entry.instruction.item.id;
            });
            const id = maxId + 1;
            useStore.getState().addItem({
              id,
              name: `Sketch ${id}`,
              type: "sketch",
              children: [],
              position,
              scale: { x: 1, y: 1, z: 1 },
              rotation,
              hostSolidId,
            });
            useStore.getState().setSketchPlacementMode(false);
          } else {
            useStore.getState().setSketchPlacementMode(false);
          }
        }
      }
      save();
      return;
    }

    if (sketchModeRef.current) {
      save();
      return;
    }

    const currentCamera = cameraRef.current;
    if (currentCamera) {
      const rect = renderer.domElement.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera({ x: nx, y: ny }, currentCamera);
      const selectableMeshes = Object.values(objectsRef.current).filter((m) => {
        if (!m.visible) return false;
        const it = itemsRef.current.find((i) => i.id === m.userData.itemId);
        return it?.type !== "sketch";
      });
      const intersects = raycasterRef.current.intersectObjects(
        selectableMeshes,
        false,
      );
      // Modifier-key scheme (must match the hover branch above):
      //   • CTRL/Cmd            → edge selection mode
      //   • ALT                 → face selection mode
      //   • CTRL/Cmd + ALT      → point selection mode (hover only)
      //   • SHIFT (orthogonal)  → additive: append/toggle within the
      //                           existing selection of the current mode.
      const cmdOrCtrl3d = isMac ? e.metaKey : e.ctrlKey;
      const edgeMode3d = cmdOrCtrl3d && !e.altKey;
      const faceMode3d = !cmdOrCtrl3d && e.altKey;
      if (intersects.length > 0) {
        const clickedId = intersects[0].object.userData.itemId || null;
        if (
          faceMode3d &&
          highlights.pendingFaceSelection &&
          highlights.pendingFaceSelection.itemId === clickedId
        ) {
          // Alt+click in face mode: commit face to sub-geometry selection.
          // Faces and edges are mutually exclusive — always clear edges.
          // With shift held, keep any existing face selection on this item
          // and toggle the clicked face; without shift, replace it.
          const prev = useStore.getState().selectedSubGeometry;
          const faces =
            e.shiftKey && prev?.itemId === clickedId && prev.edges.length === 0
              ? [...prev.faces]
              : [];
          const n = highlights.pendingFaceSelection;
          // Two stored faces are "the same" if BOTH the normal and the
          // centroid sample point are close — normal alone can't
          // distinguish coplanar disconnected faces.
          const sameFace = (f) =>
            Math.abs(f.nx - n.nx) < 0.01 &&
            Math.abs(f.ny - n.ny) < 0.01 &&
            Math.abs(f.nz - n.nz) < 0.01 &&
            (f.cx == null ||
              n.cx == null ||
              (Math.abs(f.cx - n.cx) < 0.05 &&
                Math.abs(f.cy - n.cy) < 0.05 &&
                Math.abs(f.cz - n.cz) < 0.05));
          const already = faces.some(sameFace);
          useStore.getState().setSelectedSubGeometry({
            itemId: clickedId,
            edges: [],
            faces: already
              ? faces.filter((f) => !sameFace(f))
              : [
                  ...faces,
                  {
                    nx: n.nx,
                    ny: n.ny,
                    nz: n.nz,
                    ...(n.cx != null ? { cx: n.cx, cy: n.cy, cz: n.cz } : null),
                  },
                ],
          });
          // Sub-geometry selection is exclusive with multi-object selection.
          selectItem(null);
          // Remove the hover overlay so the persistent selection highlight
          // (a darker shade, drawn at a lower renderOrder) becomes immediately
          // visible at click time.  Without this, the bright hover overlay
          // continues drawing over the selection until the next pointer move,
          // making the click appear to have no visual effect.
          clearFaceHighlight();
        } else if (
          edgeMode3d &&
          highlights.pendingEdgeSelection &&
          highlights.pendingEdgeSelection.itemId === clickedId
        ) {
          // Ctrl/Cmd+click in edge mode: commit edge to sub-geometry
          // selection.  Edges and faces are mutually exclusive — always
          // clear faces.  Shift extends the prior edge selection.
          const prev = useStore.getState().selectedSubGeometry;
          const edges =
            e.shiftKey && prev?.itemId === clickedId && prev.faces.length === 0
              ? [...prev.edges]
              : [];
          const ed = highlights.pendingEdgeSelection;
          const already = edges.some(
            (e2) =>
              Math.abs(e2.ax - ed.ax) < 0.001 &&
              Math.abs(e2.ay - ed.ay) < 0.001 &&
              Math.abs(e2.az - ed.az) < 0.001 &&
              Math.abs(e2.bx - ed.bx) < 0.001 &&
              Math.abs(e2.by - ed.by) < 0.001 &&
              Math.abs(e2.bz - ed.bz) < 0.001,
          );
          useStore.getState().setSelectedSubGeometry({
            itemId: clickedId,
            edges: already
              ? edges.filter(
                  (e2) =>
                    !(
                      Math.abs(e2.ax - ed.ax) < 0.001 &&
                      Math.abs(e2.ay - ed.ay) < 0.001 &&
                      Math.abs(e2.az - ed.az) < 0.001 &&
                      Math.abs(e2.bx - ed.bx) < 0.001 &&
                      Math.abs(e2.by - ed.by) < 0.001 &&
                      Math.abs(e2.bz - ed.bz) < 0.001
                    ),
                )
              : [
                  ...edges,
                  {
                    ax: ed.ax,
                    ay: ed.ay,
                    az: ed.az,
                    bx: ed.bx,
                    by: ed.by,
                    bz: ed.bz,
                  },
                ],
            faces: [],
          });
          // Sub-geometry selection is exclusive with multi-object selection.
          selectItem(null);
          // Remove the hover overlay so the persistent selection highlight
          // becomes immediately visible at click time (same rationale as in
          // the face-commit branch above).
          clearEdgeHighlight();
        } else {
          // Normal (object-mode) click: shift adds to multi-object selection.
          useStore.getState().clearSelectedSubGeometry();
          if (e.shiftKey && clickedId)
            useStore.getState().addToSelection(clickedId);
          else selectItem(clickedId);
        }
      } else if (!e.shiftKey) {
        selectItem(null);
        useStore.getState().clearSelectedSubGeometry();
      }
    }
    save();
  };

  return { onViewHover, onViewMouseUp };
}
