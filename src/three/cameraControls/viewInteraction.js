// 3D view-mode pointer interaction: object hover highlighting (plain object
// hover, edge/face/point modifier modes, sketch-placement-plane hover) and the
// mouse-up handling (orbit-flag reset, sketch-placement click, and object /
// sub-geometry click-select).  Split out of cameraControls.js.

import * as THREE from "three";
import { useStore } from "../../store";
import { START_FACE_HIGHLIGHT, FACE_HOVER_COLOR } from "../theme.js";
import { nearestVertexOf } from "../objectOrigin.js";
import { effectiveSelectionTypes } from "../../store/selectionMode.js";

// The snappable 2D points of a sketch shape (endpoints, corners, centres) — the
// candidates the hole tool highlights/snaps its centre to.
function shapeSnapPoints2D(shape) {
  switch (shape.type) {
    case "line":
      return [
        { x: shape.x1, y: shape.y1 },
        { x: shape.x2, y: shape.y2 },
      ];
    case "rect":
      return [
        { x: shape.x1, y: shape.y1 },
        { x: shape.x2, y: shape.y1 },
        { x: shape.x2, y: shape.y2 },
        { x: shape.x1, y: shape.y2 },
      ];
    case "circle":
    case "ellipse":
      return [{ x: shape.cx, y: shape.cy }];
    case "arc":
      return [
        { x: shape.cx, y: shape.cy },
        {
          x: shape.cx + Math.cos(shape.startAngle) * shape.r,
          y: shape.cy + Math.sin(shape.startAngle) * shape.r,
        },
        {
          x: shape.cx + Math.cos(shape.endAngle) * shape.r,
          y: shape.cy + Math.sin(shape.endAngle) * shape.r,
        },
      ];
    case "point":
      return [{ x: shape.x, y: shape.y }];
    default:
      return [];
  }
}

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
    highlightWorldPoint,
    isMac,
  },
) {
  const controls = cameraControlsRef.current;
  // World-space hole-centre snap captured on hover (a sketch point), consumed by
  // the click handler so it commits exactly what was highlighted.
  let holeSketchSnap = null;

  // Nearest visible sketch point to the cursor, in world space, within `maxPx`
  // screen distance — or null.  Sketch meshes carry the plane transform even
  // while hidden, so the points project correctly.
  const nearestSketchPoint = (clientX, clientY, cam, rect, maxPx = 14) => {
    const cx = clientX - rect.left,
      cy = clientY - rect.top;
    let best = null,
      bestD = maxPx;
    for (const item of itemsRef.current) {
      if (item.type !== "sketch" || item.visible === false || !item.shapes)
        continue;
      const mesh = objectsRef.current[item.id];
      if (!mesh) continue;
      for (const shape of item.shapes) {
        for (const pt of shapeSnapPoints2D(shape)) {
          const w = new THREE.Vector3(pt.x, pt.y, 0)
            .applyQuaternion(mesh.quaternion)
            .add(mesh.position);
          const p = w.clone().project(cam);
          if (p.z > 1) continue; // behind the camera
          const sx = (p.x * 0.5 + 0.5) * rect.width;
          const sy = (-p.y * 0.5 + 0.5) * rect.height;
          const d = Math.hypot(sx - cx, sy - cy);
          if (d < bestD) {
            bestD = d;
            best = w;
          }
        }
      }
    }
    return best;
  };
  // What the last hover settled on ("object" | "face" | "edge" | "point" | null)
  // so the click commits the same entity the priority highlighted.
  let lastHoverType = null;

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

    // Hole tool, point phase: snap-highlight the hole centre to the nearest
    // object vertex (on the body under the cursor) or sketch point.
    const holeToolHover = useStore.getState().holeTool;
    if (holeToolHover && holeToolHover.phase === "point") {
      clearFaceHighlight();
      clearEdgeHighlight();
      clearPointHighlight();
      setHoveredId(null);
      holeSketchSnap = null;
      const hit = intersects[0];
      let onVertex = false;
      if (hit) {
        const d = applyPointHighlight(hit);
        const cam = currentCamera;
        const worldPerPx = cam.isPerspectiveCamera
          ? (2 * Math.tan((cam.fov * Math.PI) / 360) * hit.distance) /
            rect.height
          : (cam.top - cam.bottom) / rect.height;
        if (d != null && d <= 11 * worldPerPx) onVertex = true;
        else clearPointHighlight();
      }
      if (!onVertex) {
        const sp = nearestSketchPoint(
          e.clientX,
          e.clientY,
          currentCamera,
          rect,
        );
        if (sp) {
          highlightWorldPoint(sp);
          holeSketchSnap = sp;
        }
      }
      controls.mouseX = e.clientX;
      controls.mouseY = e.clientY;
      return;
    }

    if (sketchPlacementModeRef.current) {
      setHoveredId(null);
      sketchPlacementPlanesRef.current.forEach(({ mesh }) => {
        mesh.material.opacity = 0.18;
      });
      // Prioritise the three main sketch planes; highlight an object face only
      // when the cursor isn't over a plane.
      const planeMeshes = sketchPlacementPlanesRef.current.map((p) => p.mesh);
      const planeHits = raycasterRef.current.intersectObjects(
        planeMeshes,
        false,
      );
      if (planeHits.length > 0) {
        clearFaceHighlight();
        planeHits[0].object.material.opacity = 0.45;
      } else if (intersects.length > 0) {
        applyFaceHighlight(intersects[0], START_FACE_HIGHLIGHT);
      } else {
        clearFaceHighlight();
      }
    } else {
      // Selection widget drives what hovering highlights (no modifier keys).
      const eff = effectiveSelectionTypes(useStore.getState());
      clearFaceHighlight();
      clearEdgeHighlight();
      clearPointHighlight();
      if (eff.object) {
        lastHoverType = "object";
        setHoveredId(
          intersects.length > 0
            ? intersects[0].object.userData.itemId || null
            : null,
        );
      } else {
        setHoveredId(null);
        lastHoverType = null;
        const hit = intersects[0];
        if (hit) {
          // Priority point > edge > face, gated by a pixel budget converted to
          // world units at the hit depth so corners/edges win only when near.
          const cam = currentCamera;
          const worldPerPx = cam.isPerspectiveCamera
            ? (2 * Math.tan((cam.fov * Math.PI) / 360) * hit.distance) /
              rect.height
            : (cam.top - cam.bottom) / rect.height;
          const vThr = 11 * worldPerPx;
          const eThr = 9 * worldPerPx;
          if (eff.point) {
            const d = applyPointHighlight(hit);
            if (d != null && d <= vThr) lastHoverType = "point";
            else clearPointHighlight();
          }
          if (!lastHoverType && eff.edge) {
            const d = applyEdgeHighlight(hit);
            if (d != null && d <= eThr) lastHoverType = "edge";
            else clearEdgeHighlight();
          }
          if (!lastHoverType && eff.face) {
            applyFaceHighlight(hit, FACE_HOVER_COLOR);
            lastHoverType = "face";
          }
        }
      }
    }

    controls.mouseX = e.clientX;
    controls.mouseY = e.clientY;
  };

  const onViewMouseUp = (e) => {
    controls.isRotating = false;
    controls.isPanning = false;
    orbitIndicator.visible = false;

    // Split tool: a click picks the object to split, then the cut plane/face.
    const splitPick = useStore.getState().splitPick;
    if (splitPick && e.button === 0) {
      const dx = e.clientX - (controls.mouseDownX || e.clientX);
      const dy = e.clientY - (controls.mouseDownY || e.clientY);
      if (Math.hypot(dx, dy) < 5) {
        if (splitPick === "object")
          controls.pickSplitObject(e.clientX, e.clientY);
        else controls.pickSplitCut(e.clientX, e.clientY);
      }
      return;
    }

    // Circular pattern axis: a click picks the sketch line / face edge to rotate
    // around.
    if (useStore.getState().circularAxisPick && e.button === 0) {
      const dx = e.clientX - (controls.mouseDownX || e.clientX);
      const dy = e.clientY - (controls.mouseDownY || e.clientY);
      if (Math.hypot(dx, dy) < 5)
        controls.pickCircularAxis(e.clientX, e.clientY);
      return;
    }

    // Plane picking: clicks either accumulate vertices (3-point mode) or pick a
    // single face's plane, depending on the active mode.
    const planePick = useStore.getState().planePickActive;
    if (planePick && e.button === 0) {
      const dx = e.clientX - (controls.mouseDownX || e.clientX);
      const dy = e.clientY - (controls.mouseDownY || e.clientY);
      if (Math.hypot(dx, dy) < 5) {
        if (planePick === "face")
          controls.planeFacePickClick(e.clientX, e.clientY);
        else controls.planePickClick(e.clientX, e.clientY);
      }
      return;
    }

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

          // Prioritise the three main sketch planes; only fall back to an
          // object face when the cursor isn't over a plane.
          const planeMeshes = sketchPlacementPlanesRef.current.map(
            (p) => p.mesh,
          );
          const planeHits = raycasterRef.current.intersectObjects(
            planeMeshes,
            false,
          );
          let position, rotation;
          let hostSolidId = null;
          if (planeHits.length > 0) {
            const hitPlane = sketchPlacementPlanesRef.current.find(
              (p) => p.mesh === planeHits[0].object,
            );
            if (hitPlane) {
              const hp = planeHits[0].point;
              // The placement-plane meshes are drawn at the current camera
              // target so they stay visible to the user, but the canonical
              // XZ/XY/YZ planes themselves pass through the world origin.
              // Zero out the axis perpendicular to the selected plane so a
              // sketch created on (e.g.) XZ lands at world Y=0 rather than
              // wherever the camera happened to be focused.
              const onAxis = { x: hp.x, y: hp.y, z: hp.z };
              if (hitPlane.name === "XZ") onAxis.y = 0;
              else if (hitPlane.name === "XY") onAxis.z = 0;
              else if (hitPlane.name === "YZ") onAxis.x = 0;
              position = onAxis;
              rotation = hitPlane.euler;
            }
          } else {
            const objHits = raycasterRef.current.intersectObjects(
              Object.values(objectsRef.current).filter(
                (m) => m.visible !== false,
              ),
              false,
            );
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
              // cut-extrude from the sketch's loops targets only that solid.
              hostSolidId = hit.object.userData?.itemId ?? null;
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

      // Change-origin tool intercepts the click before normal selection.
      const { originVertexPick, originToolActive } = useStore.getState();
      if (originVertexPick != null || originToolActive) {
        if (intersects.length > 0) {
          const hit = intersects[0];
          const clickedId = hit.object.userData.itemId;
          if (originVertexPick != null) {
            // Snap the origin to the nearest vertex of the picked object.
            if (clickedId === originVertexPick) {
              const mesh = hit.object;
              const lp = mesh.worldToLocal(hit.point.clone());
              const pos = mesh.geometry?.attributes?.position?.array;
              if (pos) {
                const v = nearestVertexOf(pos, lp.x, lp.y, lp.z);
                useStore.getState().setItemOrigin(clickedId, v);
              }
            }
          } else if (clickedId != null) {
            // Tool armed: open the origin chooser for the clicked object.
            useStore.getState().openOriginDialog(clickedId);
          }
        }
        save();
        return;
      }

      // Hole tool: phase "face" captures the drilled face; phase "point"
      // captures the hole centre (a vertex if near one, else the spot on the
      // face).  Both stored in the target's local geometry frame.
      const holeTool = useStore.getState().holeTool;
      if (
        holeTool &&
        (holeTool.phase === "face" || holeTool.phase === "point")
      ) {
        // A sketch point was snap-highlighted on hover: commit it (in the body's
        // local frame) regardless of what the ray hit.
        if (holeTool.phase === "point" && holeSketchSnap) {
          const mesh = objectsRef.current[holeTool.itemId];
          if (mesh) {
            const lp = mesh.worldToLocal(holeSketchSnap.clone());
            useStore.getState().setHolePoint({ x: lp.x, y: lp.y, z: lp.z });
          }
          save();
          return;
        }
        if (intersects.length > 0) {
          const hit = intersects[0];
          const mesh = hit.object;
          const id = mesh.userData.itemId;
          if (holeTool.phase === "face") {
            const it = itemsRef.current.find((i) => i.id === id);
            const isPrim = ["sphere", "cylinder", "torus"].includes(it?.type);
            const worldN = hit.face
              ? hit.face.normal.clone()
              : new THREE.Vector3(0, 1, 0);
            if (!isPrim && hit.face)
              worldN.applyMatrix3(
                new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld),
              );
            worldN.normalize();
            const invQ = mesh
              .getWorldQuaternion(new THREE.Quaternion())
              .invert();
            const localN = worldN.clone().applyQuaternion(invQ).normalize();
            const localP = mesh.worldToLocal(hit.point.clone());
            useStore.getState().setHoleFace(id, {
              normal: { x: localN.x, y: localN.y, z: localN.z },
              point: { x: localP.x, y: localP.y, z: localP.z },
            });
          } else if (id === holeTool.itemId) {
            // Snap to the nearest vertex when close, else use the hit point.
            const lp = mesh.worldToLocal(hit.point.clone());
            const pos = mesh.geometry?.attributes?.position?.array;
            let p = { x: lp.x, y: lp.y, z: lp.z };
            if (pos) {
              const v = nearestVertexOf(pos, lp.x, lp.y, lp.z);
              const d = Math.hypot(v.x - lp.x, v.y - lp.y, v.z - lp.z);
              if (d < 0.12) p = v;
            }
            useStore.getState().setHolePoint(p);
          }
        }
        save();
        return;
      }

      // The selection widget decides what a click commits — matching the hover
      // priority (point > edge > face) captured in lastHoverType.  Shift stays
      // additive within a sub-type.
      if (intersects.length > 0) {
        const clickedId = intersects[0].object.userData.itemId || null;
        if (
          lastHoverType === "face" &&
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
          lastHoverType === "edge" &&
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
          // Curve detection selects the whole connected chain at once; a plain
          // edge is a one-element chain.
          const chain = ed.edges?.length ? ed.edges : [ed];
          const eqEdge = (a, b) =>
            Math.abs(a.ax - b.ax) < 0.001 &&
            Math.abs(a.ay - b.ay) < 0.001 &&
            Math.abs(a.az - b.az) < 0.001 &&
            Math.abs(a.bx - b.bx) < 0.001 &&
            Math.abs(a.by - b.by) < 0.001 &&
            Math.abs(a.bz - b.bz) < 0.001;
          // Toggle off the whole chain when its primary edge is already in.
          const primaryPresent = edges.some((e2) => eqEdge(e2, ed));
          let newEdges;
          if (primaryPresent) {
            newEdges = edges.filter((e2) => !chain.some((c) => eqEdge(e2, c)));
          } else {
            newEdges = [...edges];
            chain.forEach((c) => {
              if (!newEdges.some((e2) => eqEdge(e2, c)))
                newEdges.push({
                  ax: c.ax,
                  ay: c.ay,
                  az: c.az,
                  bx: c.bx,
                  by: c.by,
                  bz: c.bz,
                });
            });
          }
          useStore.getState().setSelectedSubGeometry({
            itemId: clickedId,
            edges: newEdges,
            faces: [],
          });
          // Sub-geometry selection is exclusive with multi-object selection.
          selectItem(null);
          // Remove the hover overlay so the persistent selection highlight
          // becomes immediately visible at click time (same rationale as in
          // the face-commit branch above).
          clearEdgeHighlight();
        } else if (lastHoverType === "point") {
          // Point selection: snap to the nearest vertex and record it (the hover
          // sphere stays as the marker until the next pointer move).
          const mesh = intersects[0].object;
          const lp = mesh.worldToLocal(intersects[0].point.clone());
          const posArr = mesh.geometry?.attributes?.position?.array;
          if (posArr) {
            // Stored in the mesh's local frame (like edges) so the persistent
            // selection-highlight group can place it with the mesh transform.
            const v = nearestVertexOf(posArr, lp.x, lp.y, lp.z);
            useStore.getState().setSelectedSubGeometry({
              itemId: clickedId,
              edges: [],
              faces: [],
              points: [{ x: v.x, y: v.y, z: v.z }],
            });
            selectItem(null);
          }
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
