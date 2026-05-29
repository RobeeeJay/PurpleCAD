// Manages the lifecycle of "sketch mode" — what happens when the
// selected item is a sketch.  Entering: save the user's camera state,
// force isometric projection, animate a fly-in to the sketch plane,
// build the grid + axis overlay, and re-run applyRenderMode so 3D
// geometry behind the active sketch becomes see-through.  Leaving:
// dispose the grid + preview overlays, restore the saved camera, and
// rebuild scene objects so any downstream extrudes pick up the latest
// sketch shapes.

import { useEffect } from "react";
import * as THREE from "three";
import {
  buildSceneObjects,
  applyRenderMode,
} from "../../three/sceneObjects.js";
import { useStore } from "../../store";

// Quantize a world coord into a stable key so triangles that share a vertex
// (even with tiny float drift, e.g. from CSG) map to the same edge. 1e4 → 1e-4
// scene units ≈ 0.001 mm.
function vKey(x, y, z) {
  const q = 1e4;
  return `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
}

// Tessellated stand-in for the analytic primitives: their rendered mesh is only
// a box hull (the shader raymarches the real shape inside it), so the box would
// silhouette as a square.  Dims match the wireframe overlay in renderMode.js so
// the outline lines up with what the shader draws.
function analyticSilhouetteGeometry(type) {
  switch (type) {
    case "sphere":
      return new THREE.SphereGeometry(1.5, 64, 48);
    case "cylinder":
      return new THREE.CylinderGeometry(1, 1, 2, 64);
    case "torus":
      return new THREE.TorusGeometry(1.0, 0.4, 36, 64);
    default:
      return null;
  }
}

// True outline (silhouette) of a mesh projected orthographically onto a plane.
// An edge is on the silhouette if it's a boundary edge (one triangle) or it is
// shared by a front-facing and a back-facing triangle relative to the plane
// normal.  Unlike EdgesGeometry (facet boundaries — curved bodies come out
// faceted/square), this traces the actual outline, so a sphere projects to a
// circle and a cylinder to its real profile.  Returns a flat [x,y,z,…] segment
// array already dropped onto the plane, or null when there's nothing to draw.
function buildSilhouetteSegments(geometry, matrixWorld, origin, normal) {
  const posAttr = geometry?.getAttribute("position");
  if (!posAttr) return null;
  const index = geometry.getIndex();
  const triCount = (index ? index.count : posAttr.count) / 3;
  const mw = matrixWorld;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const fn = new THREE.Vector3();
  const getVert = (target, t, corner) => {
    const vi = index ? index.getX(t * 3 + corner) : t * 3 + corner;
    target.fromBufferAttribute(posAttr, vi).applyMatrix4(mw);
  };

  // edgeKey -> { front, back, count, p1, p2 }
  const edges = new Map();
  const addEdge = (p, q, front) => {
    const kp = vKey(p.x, p.y, p.z);
    const kq = vKey(q.x, q.y, q.z);
    const key = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
    let e = edges.get(key);
    if (!e) {
      e = {
        front: false,
        back: false,
        count: 0,
        p1: [p.x, p.y, p.z],
        p2: [q.x, q.y, q.z],
      };
      edges.set(key, e);
    }
    e.count++;
    if (front) e.front = true;
    else e.back = true;
  };

  for (let t = 0; t < triCount; t++) {
    getVert(a, t, 0);
    getVert(b, t, 1);
    getVert(c, t, 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    fn.crossVectors(ab, ac); // world face normal (length irrelevant)
    const front = fn.dot(normal) > 0;
    addEdge(a, b, front);
    addEdge(b, c, front);
    addEdge(c, a, front);
  }

  const out = [];
  const drop = (px, py, pz) => {
    const d =
      (px - origin.x) * normal.x +
      (py - origin.y) * normal.y +
      (pz - origin.z) * normal.z;
    out.push(px - normal.x * d, py - normal.y * d, pz - normal.z * d);
  };
  edges.forEach((e) => {
    if (e.count !== 1 && !(e.front && e.back)) return; // interior, not outline
    drop(e.p1[0], e.p1[1], e.p1[2]);
    drop(e.p2[0], e.p2[1], e.p2[2]);
  });
  return out.length ? new Float32Array(out) : null;
}

export function useSketchModeEffect({
  sceneRef,
  cameraRef,
  rendererRef,
  cameraControlsRef,
  objectsRef,
  originalMaterialsRef,
  itemsRef,
  axisGroupRef,
  planeRef,
  sketchPlacementPlanesRef,
  composerRef,
  envTextureRef,
  sketchModeRef,
  sketchDrawRef,
  sketchShapesGroupRef,
  sketchGhostGroupRef,
  sketchGridGroupRef,
  savedCameraStateRef,
  cameraAnimRef,
  targetRef,
  dimHintRef,
  preSketchProjectionRef,
  setSketchMode,
  setSketchDrawPhase,
  setRotationState,
  selectedId,
  items,
  projectionMode,
  printPrecision,
}) {
  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;
    const selectedItem = items.find((i) => i.id === selectedId);
    const isSketch = selectedItem && selectedItem.type === "sketch";

    const clearSketchGrid = () => {
      if (sketchGridGroupRef.current) {
        scene.remove(sketchGridGroupRef.current);
        sketchGridGroupRef.current.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (obj.material.map) obj.material.map.dispose();
            obj.material.dispose();
          }
        });
        sketchGridGroupRef.current = null;
      }
    };

    if (!isSketch) {
      if (sketchModeRef.current) {
        sketchModeRef.current = false;
        setSketchMode(false);
        if (sketchDrawRef.current) {
          sketchDrawRef.current.previewObjects.forEach((obj) => {
            scene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
          });
          sketchDrawRef.current = null;
        }
        if (dimHintRef.current) dimHintRef.current.style.display = "none";
        setSketchDrawPhase(null);
        useStore.getState().setActiveSketchTool(null);
        if (sketchShapesGroupRef.current) {
          scene.remove(sketchShapesGroupRef.current);
          sketchShapesGroupRef.current.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
          });
          sketchShapesGroupRef.current = null;
        }
        if (sketchGhostGroupRef.current) {
          scene.remove(sketchGhostGroupRef.current);
          sketchGhostGroupRef.current.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
          });
          sketchGhostGroupRef.current = null;
        }
        if (axisGroupRef.current)
          axisGroupRef.current.visible = useStore.getState().axisVisible;
        if (planeRef.current) planeRef.current.visible = true;
        // Restore the projection mode the user had selected before
        // entering sketch mode.  Sketch mode forces isometric so the
        // sketch plane sits flat with no perspective distortion.
        if (
          preSketchProjectionRef.current &&
          preSketchProjectionRef.current !== "isometric"
        ) {
          useStore.getState().setProjectionMode(preSketchProjectionRef.current);
        }
        preSketchProjectionRef.current = null;
        // Rebuild scene objects so any sketch-dependent geometry (e.g. extrudes)
        // picks up the latest sketch shapes before becoming visible again.
        buildSceneObjects(
          itemsRef.current,
          scene,
          objectsRef,
          originalMaterialsRef,
        );
        applyRenderMode(useStore.getState().renderMode, {
          scene,
          renderer: rendererRef.current,
          cameraRef,
          objectsRef,
          originalMaterialsRef,
          itemsRef,
          axisGroupRef,
          planeRef,
          sketchPlacementPlanesRef,
          composerRef,
          envTextureRef,
          sketchModeRef,
          printPrecision:
            useStore.getState().curveResolution === "print" ? 0.01 : null,
        });
        clearSketchGrid();
        const saved = savedCameraStateRef.current;
        if (saved && cameraRef.current && cameraControlsRef.current) {
          const camera = cameraRef.current;
          const controls = cameraControlsRef.current;
          cameraAnimRef.current = {
            startPos: camera.position.clone(),
            endPos: new THREE.Vector3(
              saved.positionX,
              saved.positionY,
              saved.positionZ,
            ),
            startTarget: targetRef.current.clone(),
            endTarget: new THREE.Vector3(
              saved.targetX,
              saved.targetY,
              saved.targetZ,
            ),
            startUp: camera.up.clone(),
            endUp: new THREE.Vector3(0, 1, 0),
            startTime: Date.now(),
            duration: 500,
            onComplete: () => {
              cameraRef.current.up.set(0, 1, 0);
              controls.targetRotationX = saved.rotationX;
              controls.targetRotationY = saved.rotationY;
              setRotationState(cameraRef.current.quaternion.clone());
              savedCameraStateRef.current = null;
            },
          };
        }
      }
      return;
    }

    const mesh = objectsRef.current[selectedId];
    if (!mesh) return;

    if (!sketchModeRef.current) {
      if (cameraRef.current && cameraControlsRef.current) {
        const camera = cameraRef.current;
        const controls = cameraControlsRef.current;
        savedCameraStateRef.current = {
          positionX: camera.position.x,
          positionY: camera.position.y,
          positionZ: camera.position.z,
          targetX: targetRef.current.x,
          targetY: targetRef.current.y,
          targetZ: targetRef.current.z,
          rotationX: controls.targetRotationX,
          rotationY: controls.targetRotationY,
        };
      }
      sketchModeRef.current = true;
      setSketchMode(true);
      if (axisGroupRef.current) axisGroupRef.current.visible = false;
      // Re-run applyRenderMode so the new sketchModeRef.current=true is
      // observed: 3D geometry becomes see-through and the active sketch
      // plane drops to ~0.05 opacity instead of being hidden.  The
      // previous code hid every mesh + projected edge-ghosts onto the
      // sketch plane — now the real geometry stays visible behind the
      // sketch, no ghost projection needed.
      preSketchProjectionRef.current = projectionMode;
      if (projectionMode !== "isometric") {
        useStore.getState().setProjectionMode("isometric");
      }
      applyRenderMode(useStore.getState().renderMode, {
        scene,
        renderer: rendererRef.current,
        cameraRef,
        objectsRef,
        originalMaterialsRef,
        itemsRef,
        axisGroupRef,
        planeRef,
        sketchPlacementPlanesRef,
        composerRef,
        envTextureRef,
        sketchModeRef,
        printPrecision,
      });

      // Camera fly-in to the sketch plane.  This MUST be inside the
      // first-entry guard — the surrounding effect's dependency array
      // includes `items`, so without the guard every sketch-shape add
      // would re-trigger this animation and jump the camera.
      const worldNormal = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(mesh.quaternion)
        .normalize();
      const worldUp = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(mesh.quaternion)
        .normalize();
      const meshCenter = mesh.position.clone();
      const camPos = meshCenter.clone().addScaledVector(worldNormal, 15);
      if (cameraRef.current && cameraControlsRef.current) {
        const camera = cameraRef.current;
        const controls = cameraControlsRef.current;
        cameraAnimRef.current = {
          startPos: camera.position.clone(),
          endPos: camPos.clone(),
          startTarget: targetRef.current.clone(),
          endTarget: meshCenter.clone(),
          startUp: camera.up.clone(),
          endUp: worldUp.clone(),
          startTime: Date.now(),
          duration: 500,
          onComplete: () => {
            cameraRef.current.up.copy(worldUp);
            const dp = camPos.clone().sub(meshCenter);
            const dist = dp.length();
            controls.targetRotationX =
              dist > 0 ? Math.asin(Math.max(-1, Math.min(1, dp.y / dist))) : 0;
            controls.targetRotationY = Math.atan2(dp.x, dp.z);
            setRotationState(cameraRef.current.quaternion.clone());
          },
        };
      }
    }

    if (planeRef.current) planeRef.current.visible = false;
    // Note: we no longer hide every mesh here.  applyRenderMode (re-run
    // above when entering sketch mode) handles the transparency / sketch
    // plane visibility — keeping the 3D geometry visible behind the
    // active sketch plane.

    clearSketchGrid();
    const GRID_HALF = 25;
    const gridGroup = new THREE.Group();
    gridGroup.frustumCulled = false;

    // Minor grid (repositioned each frame to follow camera)
    const minorGridGroup = new THREE.Group();
    minorGridGroup.frustumCulled = false;
    const makeGridLine = (a, b) => {
      const l = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({
          color: 0x445566,
          transparent: true,
          opacity: 0.45,
          depthTest: false,
        }),
      );
      l.frustumCulled = false;
      l.renderOrder = 990;
      return l;
    };
    // Include i === 0: the minor grid is repositioned each frame to round(local)
    // (≈ screen centre), so skipping the centre line left the two centre-most
    // grid lines missing.  Where it coincides with the world axis (only near the
    // origin) the higher-renderOrder axis line draws on top, so no double-up.
    for (let i = -GRID_HALF; i <= GRID_HALF; i++) {
      minorGridGroup.add(
        makeGridLine(
          new THREE.Vector3(i, -GRID_HALF, 0),
          new THREE.Vector3(i, GRID_HALF, 0),
        ),
      );
      minorGridGroup.add(
        makeGridLine(
          new THREE.Vector3(-GRID_HALF, i, 0),
          new THREE.Vector3(GRID_HALF, i, 0),
        ),
      );
    }
    gridGroup.add(minorGridGroup);
    gridGroup.userData.minorGrid = minorGridGroup;

    // Axis lines — long enough to always cross the screen
    const AXIS_HALF = 500;
    const makeAxis = (a, b, col) => {
      const l = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({ color: col, depthTest: false }),
      );
      l.frustumCulled = false;
      l.renderOrder = 991;
      return l;
    };
    gridGroup.add(
      makeAxis(
        new THREE.Vector3(-AXIS_HALF, 0, 0),
        new THREE.Vector3(AXIS_HALF, 0, 0),
        0xff4444,
      ),
    );
    gridGroup.add(
      makeAxis(
        new THREE.Vector3(0, -AXIS_HALF, 0),
        new THREE.Vector3(0, AXIS_HALF, 0),
        0x4488ff,
      ),
    );

    gridGroup.position.copy(mesh.position);
    gridGroup.quaternion.copy(mesh.quaternion);
    scene.add(gridGroup);
    sketchGridGroupRef.current = gridGroup;

    // ── Flat projection of 3D geometry onto the sketch plane ──────────────
    // Each visible solid's feature edges, projected orthographically along the
    // plane normal, drawn as thin reference lines with zero depth (no
    // perspective).  applyRenderMode hides the real 3D solids in sketch mode,
    // so these projected outlines stand in for them.  A signature of the
    // solids' geometry + world transforms (plus the plane pose) gates rebuilds
    // so adding sketch shapes doesn't re-run EdgesGeometry on every change.
    const solidsForGhost = itemsRef.current.filter(
      (it) =>
        it.type !== "sketch" &&
        it.visible !== false &&
        objectsRef.current[it.id]?.geometry,
    );
    let ghostSig = `p:${mesh.position.toArray().join(",")}|${mesh.quaternion.toArray().join(",")}`;
    solidsForGhost.forEach((it) => {
      const solid = objectsRef.current[it.id];
      solid.updateMatrixWorld(true);
      ghostSig += `;${it.id}:${solid.geometry.uuid}:${solid.matrixWorld.elements.join(",")}`;
    });
    if (sketchGhostGroupRef.current?.userData.sig !== ghostSig) {
      if (sketchGhostGroupRef.current) {
        scene.remove(sketchGhostGroupRef.current);
        sketchGhostGroupRef.current.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        });
      }
      const ghostGroup = new THREE.Group();
      ghostGroup.userData.sig = ghostSig;
      const normal = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(mesh.quaternion)
        .normalize();
      const origin = mesh.position;
      solidsForGhost.forEach((it) => {
        const solid = objectsRef.current[it.id];
        const analytic = analyticSilhouetteGeometry(it.type);
        const geom = analytic || solid.geometry;
        const seg = buildSilhouetteSegments(
          geom,
          solid.matrixWorld,
          origin,
          normal,
        );
        if (analytic) analytic.dispose();
        if (!seg) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(seg, 3));
        const line = new THREE.LineSegments(
          g,
          new THREE.LineBasicMaterial({
            color: 0x8a93a6,
            transparent: true,
            opacity: 0.65,
            depthTest: false,
          }),
        );
        line.renderOrder = 994; // beneath sketch shapes (1001) and point dots
        ghostGroup.add(line);
      });
      scene.add(ghostGroup);
      sketchGhostGroupRef.current = ghostGroup;
    }
  }, [selectedId, items]); // eslint-disable-line react-hooks/exhaustive-deps
}
