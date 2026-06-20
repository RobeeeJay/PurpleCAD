// Transform-handle (gizmo) drag for 3D-view mode: hit-testing the
// move/scale/rotate handles, applying the live transform to the mesh + its
// descendants + bounding box during the drag, and committing to the store on
// release.  All keyed on the shared handleDragRef.  Split out of
// cameraControls.js.

import * as THREE from "three";
import { useStore } from "../../store";
import {
  MM_PER_UNIT,
  snapUnitToIntervalMm,
  getMeshDimensions,
  getMeshBBoxCenter,
  gizmoCenterFor,
  redrawDimSprite,
  placeDimLabels,
} from "../sceneObjects.js";
import { rotationQuaternionForDrag } from "./rotationHandle.js";

export function createTransformHandleDrag({
  renderer,
  cameraRef,
  objectsRef,
  itemsRef,
  handlesRef,
  handleDragRef,
  boundingBoxRef,
  transformDebounceRef,
  raycasterRef,
  selectedIdRef,
  cameraControlsRef,
}) {
  const controls = cameraControlsRef.current;

  // item.position to store from a mesh: for extrudes the mesh sits at
  // item.position + rotated centroid offset, so subtract that back out.
  const meshCommitPos = (mesh) => {
    const elo = mesh.userData.extrudeLocalOffset;
    if (!elo) {
      return { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };
    }
    const off = new THREE.Vector3(elo.x, elo.y, elo.z).applyEuler(
      mesh.rotation,
    );
    return {
      x: mesh.position.x - off.x,
      y: mesh.position.y - off.y,
      z: mesh.position.z - off.z,
    };
  };

  // Returns true if a handle was hit (drag started) so the caller can return.
  const tryBeginHandleDrag = (e) => {
    // While the change-origin tool is armed, clicks pick an origin — never grab
    // a transform handle.
    const { originToolActive, originVertexPick } = useStore.getState();
    if (originToolActive || originVertexPick != null) return false;
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycasterRef.current.setFromCamera({ x: nx, y: ny }, cameraRef.current);

    const handleMeshes = handlesRef.current.map((h) => h.mesh);
    if (handleMeshes.length > 0) {
      const hits = raycasterRef.current.intersectObjects(handleMeshes);
      if (hits.length > 0) {
        const hitHandle = handlesRef.current.find(
          (h) => h.mesh === hits[0].object,
        );
        if (hitHandle) {
          const selId = selectedIdRef.current;
          const mesh = objectsRef.current[selId];
          if (mesh) {
            const cam = cameraRef.current;
            const startPos = mesh.position.clone();
            // Custom origin: a point in the mesh's local frame whose WORLD
            // position must stay fixed through rotate/scale (the pivot).
            const dragItem = itemsRef.current.find((i) => i.id === selId);
            const originLocal = dragItem?.origin
              ? new THREE.Vector3(
                  dragItem.origin.x,
                  dragItem.origin.y,
                  dragItem.origin.z,
                )
              : null;
            let pivot = null;
            if (originLocal) {
              mesh.updateMatrixWorld();
              pivot = mesh.localToWorld(originLocal.clone());
            }
            const isRotHandle = hitHandle.type.startsWith("rot");
            let axisDirScreen = null;
            if (!isRotHandle && hitHandle.type !== "scale") {
              const p0 = startPos.clone().project(cam);
              const p1 = startPos
                .clone()
                .addScaledVector(hitHandle.dir, 1)
                .project(cam);
              const v = new THREE.Vector2(p1.x - p0.x, p1.y - p0.y);
              if (v.length() > 0.0001) axisDirScreen = v.normalize();
            }
            const worldPerNDC = cam.isPerspectiveCamera
              ? cam.position.distanceTo(startPos) *
                Math.tan((cam.fov * Math.PI) / 360)
              : (cam.top - cam.bottom) / 2;

            const startDescendantPositions = {};
            const startDescendantQuaternions = {};
            const collectDescendants = (pid) => {
              itemsRef.current.forEach((di) => {
                if (di.parentId === pid) {
                  const dMesh = objectsRef.current[di.id];
                  if (dMesh) {
                    startDescendantPositions[di.id] = dMesh.position.clone();
                    startDescendantQuaternions[di.id] =
                      dMesh.quaternion.clone();
                  }
                  collectDescendants(di.id);
                }
              });
            };
            collectDescendants(selId);

            handleDragRef.current = {
              handleType: hitHandle.type,
              dir: isRotHandle ? null : hitHandle.dir.clone(),
              axisDirScreen,
              worldPerNDC,
              startMouseX: e.clientX,
              startMouseY: e.clientY,
              startPos,
              startScale: mesh.scale.x,
              startRotation: isRotHandle
                ? {
                    x: mesh.rotation.x,
                    y: mesh.rotation.y,
                    z: mesh.rotation.z,
                  }
                : null,
              startParentQuaternion: isRotHandle
                ? mesh.quaternion.clone()
                : null,
              itemId: selId,
              originLocal,
              pivot,
              startDescendantPositions,
              startDescendantQuaternions,
            };
            controls.mouseDownX = e.clientX;
            controls.mouseDownY = e.clientY;
            controls.mouseX = e.clientX;
            controls.mouseY = e.clientY;
            return true;
          }
        }
      }
    }
    return false;
  };

  // Returns true if a handle drag is in progress (and was applied).
  const updateHandleDrag = (e) => {
    if (!handleDragRef.current) return false;
    const drag = handleDragRef.current;
    const mesh = objectsRef.current[drag.itemId];
    if (mesh) {
      const rect = renderer.domElement.getBoundingClientRect();
      const dxPx = e.clientX - drag.startMouseX;
      const dyPx = e.clientY - drag.startMouseY;
      const { snapEnabled, snapDistanceMm, snapAngleDeg } = useStore.getState();

      if (drag.handleType.startsWith("rot")) {
        // See cameraControls/rotationHandle.js for the per-axis sign
        // convention.  Rotates around the WORLD axis the handle
        // represents (premultiplied with the orientation captured at
        // drag start) so each handle stays decoupled from any other
        // axis the object is already rotated on.
        const snapRad =
          snapEnabled && snapAngleDeg > 0 ? (snapAngleDeg * Math.PI) / 180 : 0;
        const newQuat = rotationQuaternionForDrag(
          drag.handleType,
          drag.startParentQuaternion,
          dxPx,
          snapRad,
        );
        if (newQuat) mesh.quaternion.copy(newQuat);
        // Rotate around the custom origin: hold the pivot's world position fixed
        // by moving the mesh so the (rotated, scaled) origin lands back on it.
        if (drag.pivot && drag.originLocal) {
          const off = drag.originLocal
            .clone()
            .multiplyScalar(mesh.scale.x)
            .applyQuaternion(mesh.quaternion);
          mesh.position.copy(drag.pivot).sub(off);
        }
        const bb = boundingBoxRef.current;
        if (bb) bb.boxMesh.rotation.copy(mesh.rotation);

        if (drag.startParentQuaternion && drag.startDescendantPositions) {
          const deltaQuat = mesh.quaternion
            .clone()
            .multiply(drag.startParentQuaternion.clone().invert());
          // Children orbit the same fixed pivot (else the moved mesh.position).
          const rotCenter = drag.pivot || mesh.position;
          Object.entries(drag.startDescendantPositions).forEach(
            ([idStr, startDPos]) => {
              const dMesh = objectsRef.current[parseInt(idStr, 10)];
              if (!dMesh) return;
              const relPos = startDPos.clone().sub(rotCenter);
              relPos.applyQuaternion(deltaQuat);
              dMesh.position.copy(rotCenter).add(relPos);
              const startDQuat = drag.startDescendantQuaternions?.[idStr];
              if (startDQuat)
                dMesh.quaternion.copy(deltaQuat.clone().multiply(startDQuat));
            },
          );
        }
      } else if (drag.handleType === "scale") {
        mesh.scale.setScalar(
          Math.max(0.05, drag.startScale * Math.pow(2, -dyPx / 200)),
        );
        // Scale about the custom origin: keep its world position fixed.
        if (drag.pivot && drag.originLocal) {
          const off = drag.originLocal
            .clone()
            .multiplyScalar(mesh.scale.x)
            .applyQuaternion(mesh.quaternion);
          mesh.position.copy(drag.pivot).sub(off);
        }
      } else {
        const dxNDC = (dxPx / rect.width) * 2;
        const dyNDC = (-dyPx / rect.height) * 2;
        const projected = drag.axisDirScreen
          ? dxNDC * drag.axisDirScreen.x + dyNDC * drag.axisDirScreen.y
          : 0;
        mesh.position
          .copy(drag.startPos)
          .addScaledVector(drag.dir, projected * drag.worldPerNDC);

        // Snap the moved world coordinate(s) to the interval.  The translate
        // handles are world-axis aligned, so snap each axis the handle drives.
        if (snapEnabled && snapDistanceMm > 0) {
          for (let a = 0; a < 3; a++) {
            if (Math.abs(drag.dir.getComponent(a)) > 0.5) {
              mesh.position.setComponent(
                a,
                snapUnitToIntervalMm(
                  mesh.position.getComponent(a),
                  snapDistanceMm,
                ),
              );
            }
          }
        }

        if (drag.startDescendantPositions) {
          const delta = new THREE.Vector3().subVectors(
            mesh.position,
            drag.startPos,
          );
          Object.entries(drag.startDescendantPositions).forEach(
            ([idStr, startDPos]) => {
              const dMesh = objectsRef.current[parseInt(idStr, 10)];
              if (dMesh) dMesh.position.copy(startDPos).add(delta);
            },
          );
        }
      }

      // Fixed gizmo radius (keep in sync with GIZMO_EXT in transformHandles.js)
      // so the widget keeps its size while the object is resized.  The handle
      // cluster rides the pivot (custom origin or bbox centre); the bounding box
      // stays around the geometry.
      const ext = 1.0;
      const item = itemsRef.current.find((i) => i.id === drag.itemId);
      const center = gizmoCenterFor(item, mesh);
      const bboxCenter = getMeshBBoxCenter(mesh);
      handlesRef.current.forEach(({ mesh: hm, dir }) => {
        hm.userData.baseOffsetDist = ext + 0.5;
        if (dir) hm.position.copy(center).addScaledVector(dir, ext + 0.5);
        else hm.position.copy(center);
      });

      const bb = boundingBoxRef.current;
      if (bb) {
        const dim = getMeshDimensions(mesh);
        bb.boxMesh.scale.set(dim.w, dim.h, dim.d);
        bb.boxMesh.position.copy(bboxCenter);
        const mmX = Math.round(dim.w * MM_PER_UNIT);
        const mmY = Math.round(dim.h * MM_PER_UNIT);
        const mmZ = Math.round(dim.d * MM_PER_UNIT);
        redrawDimSprite(bb.labelX, mmX + "mm", "#ff4444");
        redrawDimSprite(bb.labelY, mmY + "mm", "#4488ff");
        redrawDimSprite(bb.labelZ, mmZ + "mm", "#44ff44");
        placeDimLabels(bb, bboxCenter, dim);
      }
    }
    controls.mouseX = e.clientX;
    controls.mouseY = e.clientY;
    return true;
  };

  // Returns true if a handle drag was committed to the store.
  const commitHandleDrag = () => {
    if (!handleDragRef.current) return false;
    const drag = handleDragRef.current;
    const mesh = objectsRef.current[drag.itemId];
    if (mesh) {
      if (drag.handleType.startsWith("rot")) {
        // Rotating around a custom origin also moved the mesh, so commit the new
        // position alongside the rotation.
        const rotPos = drag.pivot ? meshCommitPos(mesh) : null;
        useStore.getState().setItemTransform(drag.itemId, rotPos, null, {
          x: mesh.rotation.x,
          y: mesh.rotation.y,
          z: mesh.rotation.z,
        });
        if (
          drag.startDescendantPositions &&
          Object.keys(drag.startDescendantPositions).length > 0
        ) {
          const updates = Object.keys(drag.startDescendantPositions)
            .map((idStr) => {
              const dMesh = objectsRef.current[parseInt(idStr, 10)];
              if (!dMesh) return null;
              return {
                id: parseInt(idStr, 10),
                position: {
                  x: dMesh.position.x,
                  y: dMesh.position.y,
                  z: dMesh.position.z,
                },
                rotation: {
                  x: dMesh.rotation.x,
                  y: dMesh.rotation.y,
                  z: dMesh.rotation.z,
                },
              };
            })
            .filter(Boolean);
          if (updates.length > 0)
            useStore.getState().setItemsTransform(updates);
        }
      } else {
        // For extrude meshes, mesh.position = item.position + rotated_centroid_offset.
        // We must subtract the offset before storing so that the next buildSceneObjects
        // call re-applies it and the solid stays in the same world position.
        const elo = mesh.userData.extrudeLocalOffset;
        let commitPos;
        if (elo) {
          const offsetWorld = new THREE.Vector3(elo.x, elo.y, elo.z).applyEuler(
            mesh.rotation,
          );
          commitPos = {
            x: mesh.position.x - offsetWorld.x,
            y: mesh.position.y - offsetWorld.y,
            z: mesh.position.z - offsetWorld.z,
          };
        } else {
          commitPos = {
            x: mesh.position.x,
            y: mesh.position.y,
            z: mesh.position.z,
          };
        }
        useStore
          .getState()
          .setItemTransform(
            drag.itemId,
            commitPos,
            { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z },
            null,
          );
        if (
          drag.startDescendantPositions &&
          Object.keys(drag.startDescendantPositions).length > 0
        ) {
          const updates = Object.keys(drag.startDescendantPositions)
            .map((idStr) => {
              const dMesh = objectsRef.current[parseInt(idStr, 10)];
              if (!dMesh) return null;
              const dElo = dMesh.userData.extrudeLocalOffset;
              let dPos;
              if (dElo) {
                const dOffsetWorld = new THREE.Vector3(
                  dElo.x,
                  dElo.y,
                  dElo.z,
                ).applyEuler(dMesh.rotation);
                dPos = {
                  x: dMesh.position.x - dOffsetWorld.x,
                  y: dMesh.position.y - dOffsetWorld.y,
                  z: dMesh.position.z - dOffsetWorld.z,
                };
              } else {
                dPos = {
                  x: dMesh.position.x,
                  y: dMesh.position.y,
                  z: dMesh.position.z,
                };
              }
              return { id: parseInt(idStr, 10), position: dPos };
            })
            .filter(Boolean);
          if (updates.length > 0)
            useStore.getState().setItemsTransform(updates);
        }
      }

      // Record the transform to history IMMEDIATELY at drag commit
      // rather than via an 800ms debounce.  The debounced version had
      // a race: setItemTransform updates items[] live, but until the
      // debounce fires history is stale.  Any history-replaying action
      // (eg. addItem → replayUpTo) inside that 800ms window would
      // rebuild items from the stale history and the dragged object
      // would snap back to its pre-drag position.  recordTransformHistory's
      // own merge-in-place logic already coalesces successive transforms
      // on the same item, so the debounce wasn't needed for coalescing.
      if (transformDebounceRef.current) {
        clearTimeout(transformDebounceRef.current);
        transformDebounceRef.current = null;
      }
      const label = drag.handleType.startsWith("rot")
        ? "Rotated"
        : drag.handleType === "scale"
          ? "Scaled"
          : "Moved";
      useStore.getState().recordTransformHistory(drag.itemId, label);
    }
    handleDragRef.current = null;
    return true;
  };

  return { tryBeginHandleDrag, updateHandleDrag, commitHandleDrag };
}
