import * as THREE from "three";
import { useStore } from "../store";
import {
  getObjectDimensions, getObjectExtent, redrawDimSprite, placeDimLabels,
  buildSketchShape, getSketchShapePoints, sketchDimText, MM_PER_UNIT,
} from "./sceneObjects.js";

export function loadCameraState() {
  try {
    const saved = localStorage.getItem("cad-camera-state");
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.warn("Failed to load camera state:", e);
  }
  return { positionX: 10, positionY: 10, positionZ: 10, targetX: 0, targetY: 0, targetZ: 0 };
}

export function saveCameraState(cameraRef, targetRef, cameraControlsRef) {
  if (!cameraRef.current || !cameraControlsRef.current) return;
  try {
    localStorage.setItem("cad-camera-state", JSON.stringify({
      positionX: cameraRef.current.position.x,
      positionY: cameraRef.current.position.y,
      positionZ: cameraRef.current.position.z,
      targetX: targetRef.current.x,
      targetY: targetRef.current.y,
      targetZ: targetRef.current.z,
      rotationX: cameraControlsRef.current.targetRotationX,
      rotationY: cameraControlsRef.current.targetRotationY,
    }));
  } catch (e) {
    console.warn("Failed to save camera state:", e);
  }
}

export function getOrbitAnchor(cameraRef, targetRef, raycasterRef, sceneRef, objectsRef, itemsRef) {
  const cam = cameraRef.current;
  if (!cam) return targetRef.current.clone();
  sceneRef.current.updateMatrixWorld();
  raycasterRef.current.setFromCamera({ x: 0, y: 0 }, cam);
  const solidMeshes = Object.values(objectsRef.current).filter((m) => {
    if (!m.visible) return false;
    const it = itemsRef.current.find((i) => i.id === m.userData.itemId);
    return it && it.type !== "sketch";
  });
  if (solidMeshes.length > 0) {
    const hits = raycasterRef.current.intersectObjects(solidMeshes, false);
    if (hits.length > 0) return hits[0].point.clone();
  }
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  if (raycasterRef.current.ray.intersectPlane(groundPlane, hit)) return hit.clone();
  return targetRef.current.clone();
}

export function setOrbitAnchor(newTarget, cameraRef, targetRef, cameraControlsRef, orbitIndicator) {
  targetRef.current.copy(newTarget);
  const dp = new THREE.Vector3().subVectors(cameraRef.current.position, newTarget);
  const dist = dp.length();
  cameraControlsRef.current.targetRotationX = dist > 0 ? Math.asin(Math.max(-1, Math.min(1, dp.y / dist))) : 0;
  cameraControlsRef.current.targetRotationY = Math.atan2(dp.x, dp.z);
  orbitIndicator.position.copy(newTarget);
  orbitIndicator.visible = true;
}

// ── Main event attachment ────────────────────────────────────────────────────

export function attachCameraControls(ctx) {
  const {
    renderer, scene, cameraRef, targetRef, raycasterRef, mouseRef,
    cameraControlsRef, objectsRef, itemsRef,
    handlesRef, handleDragRef, transformDebounceRef, boundingBoxRef,
    faceHighlightRef, edgeHighlightRef, pointHighlightRef,
    sketchModeRef, sketchDrawRef, sketchPlacementModeRef, sketchPlacementPlanesRef,
    activeSketchToolRef, selectedIdRef, selectedIdsRef, dimHintRef,
    cameraAnimRef, savedCameraStateRef, planeRef, axisGroupRef,
    orbitIndicator, gridMaterial, composerRef,
    setRotationState, setHoveredId, selectItem, setSketchDrawPhase,
    sceneRef,
  } = ctx;

  const controls = cameraControlsRef.current;
  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform);

  const save = () => saveCameraState(cameraRef, targetRef, cameraControlsRef);

  // ── Sketch drawing helpers ─────────────────────────────────────────────────

  const screenToSketchLocal = (screenX, screenY, sketchMesh) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(sketchMesh.quaternion);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, sketchMesh.position);
    const worldPt = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, worldPt)) return null;
    const localPt = worldPt.clone().sub(sketchMesh.position).applyQuaternion(sketchMesh.quaternion.clone().invert());
    return { x: localPt.x, y: localPt.y };
  };

  const clearSketchPreview = () => {
    const draw = sketchDrawRef.current;
    if (draw) {
      draw.previewObjects.forEach((obj) => {
        scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      draw.previewObjects = [];
    }
  };

  const updateSketchPreview = (screenX, screenY) => {
    const draw = sketchDrawRef.current;
    if (!draw) return;
    const selItem = itemsRef.current.find((i) => i.id === selectedIdRef.current);
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!sketchMesh) return;
    const cur = screenToSketchLocal(screenX, screenY, sketchMesh);
    if (!cur) return;
    clearSketchPreview();
    const shape = buildSketchShape(draw.tool, draw.startLocal, cur);
    if (shape) {
      const pts = getSketchShapePoints(shape, sketchMesh);
      if (pts.length >= 2) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.75, depthTest: false }),
        );
        line.renderOrder = 1002;
        scene.add(line);
        draw.previewObjects.push(line);
      }
    }
    if (dimHintRef.current) {
      const rect = renderer.domElement.getBoundingClientRect();
      dimHintRef.current.textContent = sketchDimText(draw.tool, draw.startLocal, cur);
      dimHintRef.current.style.display = "block";
      dimHintRef.current.style.left = `${screenX - rect.left + 16}px`;
      dimHintRef.current.style.top = `${screenY - rect.top - 10}px`;
    }
  };

  const handleSketchClick = (screenX, screenY) => {
    const selItem = itemsRef.current.find((i) => i.id === selectedIdRef.current);
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!sketchMesh) return;
    const localPt = screenToSketchLocal(screenX, screenY, sketchMesh);
    if (!localPt) return;
    if (!sketchDrawRef.current) {
      sketchDrawRef.current = { tool: activeSketchToolRef.current, startLocal: localPt, previewObjects: [] };
      setSketchDrawPhase("second");
    } else {
      const shape = buildSketchShape(sketchDrawRef.current.tool, sketchDrawRef.current.startLocal, localPt);
      clearSketchPreview();
      sketchDrawRef.current = null;
      setSketchDrawPhase("first");
      if (dimHintRef.current) dimHintRef.current.style.display = "none";
      if (shape) useStore.getState().addSketchShape(selectedIdRef.current, shape);
    }
  };

  // ── Highlight helpers ──────────────────────────────────────────────────────

  const clearHL = (ref) => {
    if (ref.current) {
      scene.remove(ref.current);
      ref.current.geometry.dispose();
      ref.current.material.dispose();
      ref.current = null;
    }
  };

  const clearFaceHighlight = () => clearHL(faceHighlightRef);
  const clearEdgeHighlight = () => clearHL(edgeHighlightRef);
  const clearPointHighlight = () => clearHL(pointHighlightRef);

  const applyFaceHighlight = (hit, color) => {
    const hitMesh = hit.object;
    const hitNormal = hit.face.normal;
    const geo = hitMesh.geometry;
    const posAttr = geo.getAttribute("position");
    const indexAttr = geo.index;
    const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
    const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
    const triNormal = new THREE.Vector3();
    const matchVerts = [];
    for (let i = 0; i < triCount; i++) {
      let a, b, c;
      if (indexAttr) {
        a = indexAttr.getX(i * 3); b = indexAttr.getX(i * 3 + 1); c = indexAttr.getX(i * 3 + 2);
      } else { a = i * 3; b = i * 3 + 1; c = i * 3 + 2; }
      vA.set(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a));
      vB.set(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b));
      vC.set(posAttr.getX(c), posAttr.getY(c), posAttr.getZ(c));
      triNormal.crossVectors(
        new THREE.Vector3().subVectors(vB, vA),
        new THREE.Vector3().subVectors(vC, vA),
      ).normalize();
      if (Math.abs(triNormal.dot(hitNormal)) > 0.999)
        matchVerts.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);
    }
    clearFaceHighlight();
    if (matchVerts.length > 0) {
      const hlGeo = new THREE.BufferGeometry();
      hlGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(matchVerts), 3));
      const hlMat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.5, depthTest: true,
        side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      });
      const hlMesh = new THREE.Mesh(hlGeo, hlMat);
      hlMesh.position.copy(hitMesh.position);
      hlMesh.rotation.copy(hitMesh.rotation);
      hlMesh.scale.copy(hitMesh.scale);
      hlMesh.renderOrder = 996;
      scene.add(hlMesh);
      faceHighlightRef.current = hlMesh;
    }
  };

  const distToSeg = (p, a, b) => {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ap = new THREE.Vector3().subVectors(p, a);
    const t = Math.max(0, Math.min(1, ap.dot(ab) / Math.max(ab.lengthSq(), 1e-10)));
    return p.distanceTo(new THREE.Vector3().addVectors(a, ab.multiplyScalar(t)));
  };

  const applyEdgeHighlight = (hit) => {
    clearEdgeHighlight();
    const hitMesh = hit.object;
    const localHit = hitMesh.worldToLocal(hit.point.clone());
    const edgesGeo = new THREE.EdgesGeometry(hitMesh.geometry);
    const posAttr = edgesGeo.getAttribute("position");
    let minDist = Infinity, bestA = null, bestB = null;
    for (let i = 0; i < posAttr.count; i += 2) {
      const a = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      const b = new THREE.Vector3(posAttr.getX(i + 1), posAttr.getY(i + 1), posAttr.getZ(i + 1));
      const d = distToSeg(localHit, a, b);
      if (d < minDist) { minDist = d; bestA = a; bestB = b; }
    }
    edgesGeo.dispose();
    if (bestA) {
      const hlGeo = new THREE.BufferGeometry();
      hlGeo.setAttribute("position", new THREE.BufferAttribute(
        new Float32Array([bestA.x, bestA.y, bestA.z, bestB.x, bestB.y, bestB.z]), 3,
      ));
      const hlLine = new THREE.LineSegments(hlGeo, new THREE.LineBasicMaterial({ color: 0xffdd00, depthTest: false }));
      hlLine.position.copy(hitMesh.position);
      hlLine.rotation.copy(hitMesh.rotation);
      hlLine.scale.copy(hitMesh.scale);
      hlLine.renderOrder = 998;
      scene.add(hlLine);
      edgeHighlightRef.current = hlLine;
    }
  };

  const applyPointHighlight = (hit) => {
    clearPointHighlight();
    const hitMesh = hit.object;
    const localHit = hitMesh.worldToLocal(hit.point.clone());
    const posAttr = hitMesh.geometry.getAttribute("position");
    let minDist = Infinity, bestV = null;
    const seen = new Set();
    for (let i = 0; i < posAttr.count; i++) {
      const v = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      const key = `${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = v.distanceTo(localHit);
      if (d < minDist) { minDist = d; bestV = v.clone(); }
    }
    if (bestV) {
      bestV.applyMatrix4(hitMesh.matrixWorld);
      const hlMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xff44aa, depthTest: false }),
      );
      hlMesh.position.copy(bestV);
      hlMesh.renderOrder = 999;
      scene.add(hlMesh);
      pointHighlightRef.current = hlMesh;
    }
  };

  // ── Mouse event handlers ───────────────────────────────────────────────────

  const onMouseDown = (e) => {
    if (e.button === 0) {
      if (sketchModeRef.current && activeSketchToolRef.current) {
        controls.mouseDownX = e.clientX;
        controls.mouseDownY = e.clientY;
        controls.mouseX = e.clientX;
        controls.mouseY = e.clientY;
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera({ x: nx, y: ny }, cameraRef.current);

      const handleMeshes = handlesRef.current.map((h) => h.mesh);
      if (handleMeshes.length > 0) {
        const hits = raycasterRef.current.intersectObjects(handleMeshes);
        if (hits.length > 0) {
          const hitHandle = handlesRef.current.find((h) => h.mesh === hits[0].object);
          if (hitHandle) {
            const selId = selectedIdRef.current;
            const mesh = objectsRef.current[selId];
            if (mesh) {
              const cam = cameraRef.current;
              const startPos = mesh.position.clone();
              const isRotHandle = hitHandle.type.startsWith("rot");
              let axisDirScreen = null;
              if (!isRotHandle && hitHandle.type !== "scale") {
                const p0 = startPos.clone().project(cam);
                const p1 = startPos.clone().addScaledVector(hitHandle.dir, 1).project(cam);
                const v = new THREE.Vector2(p1.x - p0.x, p1.y - p0.y);
                if (v.length() > 0.0001) axisDirScreen = v.normalize();
              }
              const worldPerNDC = cam.isPerspectiveCamera
                ? cam.position.distanceTo(startPos) * Math.tan((cam.fov * Math.PI) / 360)
                : (cam.top - cam.bottom) / 2;

              const startDescendantPositions = {};
              const startDescendantQuaternions = {};
              const collectDescendants = (pid) => {
                itemsRef.current.forEach((di) => {
                  if (di.parentId === pid) {
                    const dMesh = objectsRef.current[di.id];
                    if (dMesh) {
                      startDescendantPositions[di.id] = dMesh.position.clone();
                      startDescendantQuaternions[di.id] = dMesh.quaternion.clone();
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
                startRotation: isRotHandle ? { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z } : null,
                startParentQuaternion: isRotHandle ? mesh.quaternion.clone() : null,
                itemId: selId,
                startDescendantPositions,
                startDescendantQuaternions,
              };
              controls.mouseDownX = e.clientX;
              controls.mouseDownY = e.clientY;
              controls.mouseX = e.clientX;
              controls.mouseY = e.clientY;
              return;
            }
          }
        }
      }
      controls.mouseDownX = e.clientX;
      controls.mouseDownY = e.clientY;
    } else if (e.button === 2) {
      if (!sketchModeRef.current) {
        controls.isRotating = true;
        setOrbitAnchor(
          getOrbitAnchor(cameraRef, targetRef, raycasterRef, sceneRef, objectsRef, itemsRef),
          cameraRef, targetRef, cameraControlsRef, orbitIndicator,
        );
      }
    }
  };

  const onMouseMove = (e) => {
    const currentCamera = cameraRef.current;
    if (!currentCamera) return;

    if (sketchModeRef.current && activeSketchToolRef.current) {
      if (sketchDrawRef.current) updateSketchPreview(e.clientX, e.clientY);
      controls.mouseX = e.clientX;
      controls.mouseY = e.clientY;
      return;
    }

    if (handleDragRef.current) {
      const drag = handleDragRef.current;
      const mesh = objectsRef.current[drag.itemId];
      if (mesh) {
        const rect = renderer.domElement.getBoundingClientRect();
        const dxPx = e.clientX - drag.startMouseX;
        const dyPx = e.clientY - drag.startMouseY;

        if (drag.handleType.startsWith("rot")) {
          const delta = -dxPx * 0.01;
          if (drag.handleType === "rotX")      mesh.rotation.x = drag.startRotation.x + delta;
          else if (drag.handleType === "rotY") mesh.rotation.y = drag.startRotation.y - delta;
          else if (drag.handleType === "rotZ") mesh.rotation.z = drag.startRotation.z + delta;
          const bb = boundingBoxRef.current;
          if (bb) bb.boxMesh.rotation.copy(mesh.rotation);

          if (drag.startParentQuaternion && drag.startDescendantPositions) {
            const deltaQuat = mesh.quaternion.clone().multiply(drag.startParentQuaternion.clone().invert());
            Object.entries(drag.startDescendantPositions).forEach(([idStr, startDPos]) => {
              const dMesh = objectsRef.current[parseInt(idStr, 10)];
              if (!dMesh) return;
              const relPos = startDPos.clone().sub(mesh.position);
              relPos.applyQuaternion(deltaQuat);
              dMesh.position.copy(mesh.position).add(relPos);
              const startDQuat = drag.startDescendantQuaternions?.[idStr];
              if (startDQuat) dMesh.quaternion.copy(deltaQuat.clone().multiply(startDQuat));
            });
          }
        } else if (drag.handleType === "scale") {
          mesh.scale.setScalar(Math.max(0.05, drag.startScale * Math.pow(2, -dyPx / 200)));
        } else {
          const dxNDC = (dxPx / rect.width) * 2;
          const dyNDC = (-dyPx / rect.height) * 2;
          const projected = drag.axisDirScreen
            ? dxNDC * drag.axisDirScreen.x + dyNDC * drag.axisDirScreen.y
            : 0;
          mesh.position.copy(drag.startPos).addScaledVector(drag.dir, projected * drag.worldPerNDC);

          if (drag.startDescendantPositions) {
            const delta = new THREE.Vector3().subVectors(mesh.position, drag.startPos);
            Object.entries(drag.startDescendantPositions).forEach(([idStr, startDPos]) => {
              const dMesh = objectsRef.current[parseInt(idStr, 10)];
              if (dMesh) dMesh.position.copy(startDPos).add(delta);
            });
          }
        }

        const item = itemsRef.current.find((i) => i.id === drag.itemId);
        const ext = getObjectExtent(item ? item.type : "cube", mesh.scale.x);
        handlesRef.current.forEach(({ mesh: hm, dir }) => {
          if (dir) hm.position.copy(mesh.position).addScaledVector(dir, ext + 0.5);
          else hm.position.copy(mesh.position);
        });

        const bb = boundingBoxRef.current;
        if (bb) {
          const itype = item ? item.type : "cube";
          const dim = getObjectDimensions(itype, mesh.scale.x);
          bb.boxMesh.scale.set(dim.w, dim.h, dim.d);
          bb.boxMesh.position.copy(mesh.position);
          const mmX = Math.round(dim.w * MM_PER_UNIT);
          const mmY = Math.round(dim.h * MM_PER_UNIT);
          const mmZ = Math.round(dim.d * MM_PER_UNIT);
          redrawDimSprite(bb.labelX, mmX + "mm", "#ff4444");
          redrawDimSprite(bb.labelY, mmY + "mm", "#4488ff");
          redrawDimSprite(bb.labelZ, mmZ + "mm", "#44ff44");
          placeDimLabels(bb, mesh.position, dim);
        }
      }
      controls.mouseX = e.clientX;
      controls.mouseY = e.clientY;
      return;
    }

    // ── Hover highlighting ────────────────────────────────────────────────
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
      sketchPlacementPlanesRef.current.forEach(({ mesh }) => { mesh.material.opacity = 0.18; });
      if (intersects.length > 0) {
        applyFaceHighlight(intersects[0], 0xff8833);
      } else {
        clearFaceHighlight();
        const planeMeshes = sketchPlacementPlanesRef.current.map((p) => p.mesh);
        const planeHits = raycasterRef.current.intersectObjects(planeMeshes, false);
        if (planeHits.length > 0) planeHits[0].object.material.opacity = 0.45;
      }
    } else {
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      const edgeMode = e.shiftKey && !cmdOrCtrl;
      const pointMode = e.shiftKey && cmdOrCtrl;
      const faceMode = !e.shiftKey && cmdOrCtrl;

      if (pointMode) {
        setHoveredId(null); clearFaceHighlight(); clearEdgeHighlight();
        if (intersects.length > 0) applyPointHighlight(intersects[0]); else clearPointHighlight();
      } else if (edgeMode) {
        setHoveredId(null); clearFaceHighlight(); clearPointHighlight();
        if (intersects.length > 0) applyEdgeHighlight(intersects[0]); else clearEdgeHighlight();
      } else if (faceMode) {
        setHoveredId(null); clearEdgeHighlight(); clearPointHighlight();
        if (intersects.length > 0) applyFaceHighlight(intersects[0], 0x88ccff); else clearFaceHighlight();
      } else {
        clearFaceHighlight(); clearEdgeHighlight(); clearPointHighlight();
        setHoveredId(intersects.length > 0 ? (intersects[0].object.userData.itemId || null) : null);
      }
    }

    controls.mouseX = e.clientX;
    controls.mouseY = e.clientY;
  };

  const onMouseUp = (e) => {
    if (sketchModeRef.current && activeSketchToolRef.current && e.button === 0) {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5) handleSketchClick(e.clientX, e.clientY);
      return;
    }

    if (handleDragRef.current) {
      const drag = handleDragRef.current;
      const mesh = objectsRef.current[drag.itemId];
      if (mesh) {
        if (drag.handleType.startsWith("rot")) {
          useStore.getState().setItemTransform(drag.itemId, null, null, {
            x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z,
          });
          if (drag.startDescendantPositions && Object.keys(drag.startDescendantPositions).length > 0) {
            const updates = Object.keys(drag.startDescendantPositions).map((idStr) => {
              const dMesh = objectsRef.current[parseInt(idStr, 10)];
              if (!dMesh) return null;
              return {
                id: parseInt(idStr, 10),
                position: { x: dMesh.position.x, y: dMesh.position.y, z: dMesh.position.z },
                rotation: { x: dMesh.rotation.x, y: dMesh.rotation.y, z: dMesh.rotation.z },
              };
            }).filter(Boolean);
            if (updates.length > 0) useStore.getState().setItemsTransform(updates);
          }
        } else {
          useStore.getState().setItemTransform(drag.itemId,
            { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
            { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z },
            null,
          );
          if (drag.startDescendantPositions && Object.keys(drag.startDescendantPositions).length > 0) {
            const updates = Object.keys(drag.startDescendantPositions).map((idStr) => {
              const dMesh = objectsRef.current[parseInt(idStr, 10)];
              if (!dMesh) return null;
              return { id: parseInt(idStr, 10), position: { x: dMesh.position.x, y: dMesh.position.y, z: dMesh.position.z } };
            }).filter(Boolean);
            if (updates.length > 0) useStore.getState().setItemsTransform(updates);
          }
        }

        if (transformDebounceRef.current) clearTimeout(transformDebounceRef.current);
        const capturedId = drag.itemId;
        const capturedType = drag.handleType;
        transformDebounceRef.current = setTimeout(() => {
          const currentItem = useStore.getState().items.find((i) => i.id === capturedId);
          if (!currentItem) return;
          const label = capturedType.startsWith("rot") ? "Rotated" : capturedType === "scale" ? "Scaled" : "Moved";
          useStore.getState().recordTransformHistory(capturedId, label);
        }, 800);
      }
      handleDragRef.current = null;
      return;
    }

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
            Object.values(objectsRef.current).filter((m) => m.visible !== false), false,
          );
          let position, rotation;
          if (objHits.length > 0) {
            const hit = objHits[0];
            const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
            const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal);
            const euler = new THREE.Euler().setFromQuaternion(q);
            position = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
            rotation = { x: euler.x, y: euler.y, z: euler.z };
          } else {
            const planeMeshes = sketchPlacementPlanesRef.current.map((p) => p.mesh);
            const planeHits = raycasterRef.current.intersectObjects(planeMeshes, false);
            if (planeHits.length > 0) {
              const hitPlane = sketchPlacementPlanesRef.current.find((p) => p.mesh === planeHits[0].object);
              if (hitPlane) {
                const hp = planeHits[0].point;
                position = { x: hp.x, y: hp.y, z: hp.z };
                rotation = hitPlane.euler;
              }
            }
          }

          if (position && rotation) {
            const hist = useStore.getState().history;
            let maxId = 0;
            hist.forEach((entry) => {
              if (entry.instruction?.type === "create" && entry.instruction.item.id > maxId)
                maxId = entry.instruction.item.id;
            });
            const id = maxId + 1;
            useStore.getState().addItem({ id, name: `Sketch ${id}`, type: "sketch", children: [], position, scale: { x: 1, y: 1, z: 1 }, rotation });
            useStore.getState().setSketchPlacementMode(false);
          }
        }
      }
      save();
      return;
    }

    if (sketchModeRef.current) { save(); return; }

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
      const intersects = raycasterRef.current.intersectObjects(selectableMeshes, false);
      if (intersects.length > 0) {
        const clickedId = intersects[0].object.userData.itemId || null;
        if (e.shiftKey && clickedId) useStore.getState().addToSelection(clickedId);
        else selectItem(clickedId);
      } else if (!e.shiftKey) {
        selectItem(null);
      }
    }
    save();
  };

  // ── Wheel handler ──────────────────────────────────────────────────────────

  let shiftScrollSessionTimer = null;

  const onMouseWheel = (e) => {
    e.preventDefault();
    const currentCamera = cameraRef.current;
    if (!currentCamera) return;

    if (e.ctrlKey && isMac) {
      const scale = Math.exp(-e.deltaY * 0.04);
      const tgt = targetRef.current;
      if (currentCamera instanceof THREE.OrthographicCamera) {
        currentCamera.zoom = Math.max(0.05, Math.min(50, currentCamera.zoom * scale));
        currentCamera.updateProjectionMatrix();
      } else {
        const dir = new THREE.Vector3().subVectors(currentCamera.position, tgt);
        const newDist = Math.max(0.5, Math.min(500, dir.length() / scale));
        currentCamera.position.copy(tgt).addScaledVector(dir.normalize(), newDist);
        currentCamera.lookAt(tgt);
      }
      setRotationState(currentCamera.quaternion.clone());
      save();
      return;
    }

    if (e.metaKey || (e.ctrlKey && !isMac)) {
      const rect = renderer.domElement.getBoundingClientRect();
      const worldPerPx = currentCamera.isPerspectiveCamera
        ? (2 * currentCamera.position.distanceTo(targetRef.current) * Math.tan((currentCamera.fov * Math.PI) / 360)) / rect.height
        : (currentCamera.top - currentCamera.bottom) / rect.height;
      const forward = new THREE.Vector3(); currentCamera.getWorldDirection(forward);
      const right = new THREE.Vector3().crossVectors(forward, currentCamera.up).normalize();
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
          getOrbitAnchor(cameraRef, targetRef, raycasterRef, sceneRef, objectsRef, itemsRef),
          cameraRef, targetRef, cameraControlsRef, orbitIndicator,
        );
      }
      clearTimeout(shiftScrollSessionTimer);
      shiftScrollSessionTimer = setTimeout(() => { shiftScrollSessionTimer = null; orbitIndicator.visible = false; }, 400);

      const rotSpeed = 0.004;
      controls.targetRotationY += e.deltaX * rotSpeed;
      controls.targetRotationX -= e.deltaY * rotSpeed;
      controls.targetRotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, controls.targetRotationX));
      const distance = currentCamera.position.distanceTo(targetRef.current);
      currentCamera.position.x = targetRef.current.x + Math.sin(controls.targetRotationY) * Math.cos(controls.targetRotationX) * distance;
      currentCamera.position.y = targetRef.current.y + Math.sin(controls.targetRotationX) * distance;
      currentCamera.position.z = targetRef.current.z + Math.cos(controls.targetRotationY) * Math.cos(controls.targetRotationX) * distance;
      currentCamera.lookAt(targetRef.current);
      setRotationState(currentCamera.quaternion.clone());
    } else if (sketchModeRef.current) {
      const panSpeed = 0.05;
      const forward = new THREE.Vector3(); currentCamera.getWorldDirection(forward);
      const right = new THREE.Vector3().crossVectors(forward, currentCamera.up).normalize();
      const offset = new THREE.Vector3()
        .addScaledVector(right, e.deltaX * panSpeed)
        .addScaledVector(currentCamera.up, -e.deltaY * panSpeed);
      currentCamera.position.add(offset);
      targetRef.current.add(offset);
      currentCamera.lookAt(targetRef.current);
    } else {
      const rect = renderer.domElement.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -targetRef.current.y);
      const hitAt = (sx, sy) => {
        const nx = ((sx - rect.left) / rect.width) * 2 - 1;
        const ny = -((sy - rect.top) / rect.height) * 2 + 1;
        const r = new THREE.Raycaster();
        r.setFromCamera({ x: nx, y: ny }, currentCamera);
        const h = new THREE.Vector3();
        return r.ray.intersectPlane(groundPlane, h) ? h.clone() : null;
      };
      const h0 = hitAt(cx, cy), h1 = hitAt(cx + 100, cy), h2 = hitAt(cx, cy + 100);
      if (h0 && h1 && h2) {
        const panDxWorld = new THREE.Vector3().subVectors(h1, h0).divideScalar(100);
        const panDyWorld = new THREE.Vector3().subVectors(h2, h0).divideScalar(100);
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
  const onTouchStart = (e) => { if (e.touches.length === 2) pinchDist = getPinchDist(e.touches); };
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
  const onTouchEnd = (e) => { if (e.touches.length < 2) pinchDist = null; };

  // ── Keyboard ───────────────────────────────────────────────────────────────

  const onModifierUp = (e) => {
    if (e.key === "Meta" || e.key === "Control") { clearHL(faceHighlightRef); clearHL(pointHighlightRef); }
    if (e.key === "Shift") { clearHL(edgeHighlightRef); clearHL(pointHighlightRef); }
  };
  const onKeyDown = (e) => {
    if (e.key === "Escape" && sketchPlacementModeRef.current)
      useStore.getState().setSketchPlacementMode(false);
  };

  // ── Animate loop ───────────────────────────────────────────────────────────

  let animId;
  const animate = () => {
    animId = requestAnimationFrame(animate);

    if (cameraAnimRef.current) {
      const anim = cameraAnimRef.current;
      const t = Math.min(1, (Date.now() - anim.startTime) / anim.duration);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      cameraRef.current.position.lerpVectors(anim.startPos, anim.endPos, ease);
      targetRef.current.lerpVectors(anim.startTarget, anim.endTarget, ease);
      cameraRef.current.up.lerpVectors(anim.startUp, anim.endUp, ease).normalize();
      cameraRef.current.lookAt(targetRef.current);
      setRotationState(cameraRef.current.quaternion.clone());
      if (t >= 1) {
        if (anim.onComplete) anim.onComplete();
        cameraAnimRef.current = null;
      }
    }

    gridMaterial.uniforms.uCameraPos.value.copy(cameraRef.current.position);
    if (composerRef.current) composerRef.current.render();
    else renderer.render(scene, cameraRef.current);
  };
  animate();

  // ── Attach listeners ───────────────────────────────────────────────────────

  const el = renderer.domElement;
  el.addEventListener("mousedown", onMouseDown);
  el.addEventListener("mousemove", onMouseMove);
  el.addEventListener("mouseup", onMouseUp);
  el.addEventListener("wheel", onMouseWheel, { passive: false });
  const onContextMenu = (e) => e.preventDefault();
  el.addEventListener("contextmenu", onContextMenu);
  el.addEventListener("touchstart", onTouchStart, { passive: true });
  el.addEventListener("touchmove", onTouchMove, { passive: false });
  el.addEventListener("touchend", onTouchEnd);
  document.addEventListener("keyup", onModifierUp);
  document.addEventListener("keydown", onKeyDown);

  return () => {
    cancelAnimationFrame(animId);
    clearTimeout(shiftScrollSessionTimer);
    el.removeEventListener("mousedown", onMouseDown);
    el.removeEventListener("mousemove", onMouseMove);
    el.removeEventListener("mouseup", onMouseUp);
    el.removeEventListener("wheel", onMouseWheel);
    el.removeEventListener("contextmenu", onContextMenu);
    el.removeEventListener("touchstart", onTouchStart);
    el.removeEventListener("touchmove", onTouchMove);
    el.removeEventListener("touchend", onTouchEnd);
    document.removeEventListener("keyup", onModifierUp);
    document.removeEventListener("keydown", onKeyDown);
  };
}
