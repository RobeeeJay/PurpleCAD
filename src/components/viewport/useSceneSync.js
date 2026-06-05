// All of Viewport's scene-synchronisation effects in one place: small toggles
// (axis/shadows/escape), sketch-placement planes, CSG/bevel regeneration, the
// scene-object rebuild + render mode, sub-geometry highlights, transform
// handles, the sketch-mode lifecycle, and the sketch/extrude overlay groups.
// Effect order here matches the original Viewport.jsx ordering exactly.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useStore } from "../../store";
import {
  buildSceneObjects,
  buildTransformHandles,
  buildSketchShapesGroup,
  buildAllSketchShapesGroup,
  buildExtrudeSelectGroup,
  applyRenderMode,
} from "../../three/sceneObjects.js";
import { updateEmissive } from "../../three/objectMaterials.js";
import { resolveItemDepth } from "../../three/geometryParams.js";
import { reconcileSelectionHighlight } from "../../three/selectionHighlights.js";
import { useSketchModeEffect } from "./useSketchModeEffect";

export function useSceneSync({
  sceneRef,
  cameraRef,
  rendererRef,
  cameraControlsRef,
  objectsRef,
  originalMaterialsRef,
  planeRef,
  shadowGroundRef,
  shadowLightRef,
  targetRef,
  axisGroupRef,
  composerRef,
  envTextureRef,
  sketchModeRef,
  sketchPlacementPlanesRef,
  subGeoHighlightGroupRef,
  handlesRef,
  handleDragRef,
  boundingBoxRef,
  sketchShapesGroupRef,
  allSketchGroupRef,
  sketchGhostGroupRef,
  sketchGridGroupRef,
  extrudeSelectGroupRef,
  preSketchProjectionRef,
  preExtrudeRenderModeRef,
  dimHintRef,
  savedCameraStateRef,
  cameraAnimRef,
  sketchDrawRef,
  itemsRef,
  selectedIdsRef,
  items,
  variables,
  renderMode,
  selectedId,
  selectedIds,
  selectedSubGeometry,
  constraintsVisible,
  dimensionsVisible,
  curveResolution,
  sketchMode,
  sketchPlacementMode,
  extrudeSelectMode,
  cutExtrudeInProgress,
  hoveredId,
  projectionMode,
  axisVisible,
  shadowsEnabled,
  curveSegments,
  printPrecision,
  setSketchMode,
  setSketchDrawPhase,
  setRotationState,
}) {
  useEffect(() => {
    if (axisGroupRef.current)
      axisGroupRef.current.visible = axisVisible && !sketchModeRef.current;
  }, [axisVisible]);

  // Toggle ground-plane shadows.  The directional light and the
  // ShadowMaterial receiver-plane are both gated by the same flag so
  // turning shadows off skips the shadow-map render and hides the
  // tinted plane.  shadowMap on the renderer stays enabled — flipping
  // that at runtime forces every material to recompile.
  useEffect(() => {
    if (shadowLightRef.current)
      shadowLightRef.current.castShadow = shadowsEnabled;
    if (shadowGroundRef.current)
      shadowGroundRef.current.visible = shadowsEnabled;
  }, [shadowsEnabled]);

  // Global Escape → cancel any in-progress extrude.  Captures the event
  // BEFORE the form input's own handler so the cancel fires even when
  // the depth-overlay FormulaInput has focus and its autocomplete
  // popup would otherwise swallow the Escape.
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== "Escape") return;
      if (!useStore.getState().extrudeSelectMode) return;
      cameraControlsRef.current?.cancelExtrude?.();
    };
    document.addEventListener("keydown", handler, true); // capture phase
    return () => document.removeEventListener("keydown", handler, true);
  }, []);

  // ── Sketch placement planes ───────────────────────────────────────────────

  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;
    const clearPlanes = () => {
      sketchPlacementPlanesRef.current.forEach(({ mesh }) => {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      });
      sketchPlacementPlanesRef.current = [];
    };
    clearPlanes();
    if (!sketchPlacementMode) return;
    const center = targetRef.current.clone();
    const SIZE = 4;
    [
      { name: "XZ", rx: -Math.PI / 2, ry: 0, rz: 0, color: 0x4488ff },
      { name: "XY", rx: 0, ry: 0, rz: 0, color: 0x44bb44 },
      { name: "YZ", rx: 0, ry: Math.PI / 2, rz: 0, color: 0xff4444 },
    ].forEach(({ name, rx, ry, rz, color }) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(SIZE, SIZE),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.18,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      mesh.position.copy(center);
      mesh.rotation.set(rx, ry, rz);
      scene.add(mesh);
      sketchPlacementPlanesRef.current.push({
        mesh,
        euler: { x: rx, y: ry, z: rz },
        name,
      });
    });
    return clearPlanes;
  }, [sketchPlacementMode]);

  // ── Regenerate CSG/bevel results at the current resolution ───────────────
  // CSG and bevel items store a `regenerator` describing how they were made.
  // When the user toggles preview/print, walk items and re-run any whose
  // baked geometryData was computed at the old precision.  This is what
  // makes the scene "recalculate to the current timeline position" — the
  // baked geometryData gets refreshed for the current setting before the
  // scene rebuild reads from items.
  const upstreamSigRef = useRef(null);
  const pendingRecalcRef = useRef(false);
  useEffect(() => {
    // Editing an EXISTING sketch / extrude-depth (or a variable) changes
    // geometry that later timeline steps were built from, so every subsequent
    // step has to be rebuilt — not just the items in the current view.  Run the
    // full per-step recalc only for such edits.  Crucially, ADDING a new item
    // (a fresh sketch plane, an extrusion) must NOT recalc — nothing existing
    // changed — so compare per-item signatures and trigger only when an id
    // present both before and after differs (plus variable changes).  Object
    // add/move and resolution toggles keep the cheap current-view regen.
    const itemSig = new Map();
    for (const i of items) {
      if (i.type === "sketch")
        itemSig.set(
          i.id,
          `s:${JSON.stringify(i.shapes)}:${JSON.stringify(i.constraints)}`,
        );
      else if (i.depth !== undefined) itemSig.set(i.id, `d:${i.depth}`);
    }
    const varsSig = JSON.stringify(variables);
    const prev = upstreamSigRef.current;
    const isFirst = prev === null;
    let upstreamChanged = false;
    if (!isFirst) {
      if (varsSig !== prev.varsSig) upstreamChanged = true;
      else
        for (const [id, s] of itemSig) {
          if (prev.map.has(id) && prev.map.get(id) !== s) {
            upstreamChanged = true;
            break;
          }
        }
    }
    upstreamSigRef.current = { map: itemSig, varsSig };

    // While a sketch is open, defer the full timeline recalc until it's closed
    // — recomputing every downstream step on each point drag is wasteful (and
    // the 3D solids are hidden behind the sketch anyway).  The deferred recalc
    // runs in the sketch-close effect below.
    if (upstreamChanged && sketchMode) {
      pendingRecalcRef.current = true;
      return;
    }

    // The orchestrator is a UI-only module that's never reachable from
    // the OCC worker's transitive imports, so it can route per-item regen
    // through occClient → worker without creating a bundling cycle.
    import("../../three/regenerateOrchestrator.js").then((m) => {
      if (upstreamChanged) {
        pendingRecalcRef.current = false;
        m.recalculateTimeline();
      } else {
        m.regenerateForResolution(printPrecision);
      }
    });
  }, [items, curveResolution, variables]); // eslint-disable-line react-hooks/exhaustive-deps

  // Run a sketch edit's deferred timeline recalc once the sketch is closed.
  useEffect(() => {
    if (sketchMode || !pendingRecalcRef.current) return;
    pendingRecalcRef.current = false;
    import("../../three/regenerateOrchestrator.js").then((m) =>
      m.recalculateTimeline(),
    );
  }, [sketchMode]);

  // ── Rebuild scene objects ─────────────────────────────────────────────────

  useEffect(() => {
    if (!sceneRef.current || !rendererRef.current) return;
    buildSceneObjects(
      items,
      sceneRef.current,
      objectsRef,
      originalMaterialsRef,
      curveSegments,
      printPrecision,
    );
    applyRenderMode(renderMode, {
      scene: sceneRef.current,
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
    // Variables drive extrude depth and dimension distances via formula
    // resolution; re-run when they change so geometry/labels reflect the
    // new values.
  }, [items, curveResolution, variables]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persistent sub-geometry selection highlights ─────────────────────────
  // Rebuild a darker-coloured overlay whenever the selected faces or edges
  // change, so the user can see what they have committed to selection
  // (distinct from the brighter hover highlight).

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const renderer = rendererRef.current;
    const resolution = renderer
      ? renderer.getSize(new THREE.Vector2())
      : undefined;
    subGeoHighlightGroupRef.current = reconcileSelectionHighlight(
      scene,
      subGeoHighlightGroupRef.current,
      selectedSubGeometry,
      objectsRef.current,
      items,
      { resolution },
    );
  }, [selectedSubGeometry, items]);

  // ── Transform handles + bounding box ─────────────────────────────────────

  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;

    handlesRef.current.forEach(({ mesh }) => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    handlesRef.current = [];
    handleDragRef.current = null;

    if (boundingBoxRef.current) {
      const { boxMesh, labelX, labelY, labelZ } = boundingBoxRef.current;
      scene.remove(boxMesh);
      scene.remove(labelX.sprite);
      scene.remove(labelY.sprite);
      scene.remove(labelZ.sprite);
      boxMesh.geometry.dispose();
      boxMesh.material.dispose();
      labelX.mat.map.dispose();
      labelX.mat.dispose();
      labelY.mat.map.dispose();
      labelY.mat.dispose();
      labelZ.mat.map.dispose();
      labelZ.mat.dispose();
      boundingBoxRef.current = null;
    }

    if (!selectedId) return;

    const result = buildTransformHandles(selectedId, items, objectsRef);
    if (!result) return;

    const { handles, boundingBox } = result;
    const isMultiSelect = selectedIdsRef.current.length > 1;
    const visibleHandles = isMultiSelect
      ? handles.filter(({ type }) => !type.startsWith("rot"))
      : handles;
    visibleHandles.forEach(({ mesh }) => scene.add(mesh));
    scene.add(boundingBox.boxMesh);
    scene.add(boundingBox.labelX.sprite);
    scene.add(boundingBox.labelY.sprite);
    scene.add(boundingBox.labelZ.sprite);
    handlesRef.current = visibleHandles;
    boundingBoxRef.current = boundingBox;

    return () => {
      handlesRef.current.forEach(({ mesh: hm }) => {
        if (sceneRef.current) sceneRef.current.remove(hm);
        hm.geometry.dispose();
        hm.material.dispose();
      });
      handlesRef.current = [];
      if (boundingBoxRef.current) {
        const {
          boxMesh,
          labelX: lx,
          labelY: ly,
          labelZ: lz,
        } = boundingBoxRef.current;
        if (sceneRef.current) {
          sceneRef.current.remove(boxMesh);
          sceneRef.current.remove(lx.sprite);
          sceneRef.current.remove(ly.sprite);
          sceneRef.current.remove(lz.sprite);
        }
        boxMesh.geometry.dispose();
        boxMesh.material.dispose();
        lx.mat.map.dispose();
        lx.mat.dispose();
        ly.mat.map.dispose();
        ly.mat.dispose();
        lz.mat.map.dispose();
        lz.mat.dispose();
        boundingBoxRef.current = null;
      }
    };
  }, [selectedId, selectedIds, items]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sketch mode (top-down view + grid) ───────────────────────────────────

  useSketchModeEffect({
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
  });

  // ── Sketch shape lines ────────────────────────────────────────────────────

  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;
    if (sketchShapesGroupRef.current) {
      scene.remove(sketchShapesGroupRef.current);
      sketchShapesGroupRef.current.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      sketchShapesGroupRef.current = null;
    }
    const group = buildSketchShapesGroup(
      selectedId,
      items,
      objectsRef,
      rendererRef.current,
      constraintsVisible,
      dimensionsVisible,
      curveSegments,
      printPrecision,
    );
    if (group) {
      if (renderMode === "smooth") group.visible = false;
      scene.add(group);
      sketchShapesGroupRef.current = group;
    }
  }, [
    selectedId,
    items,
    constraintsVisible,
    dimensionsVisible,
    curveResolution,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Object-view sketch construction lines ────────────────────────────────

  useEffect(() => {
    if (!sceneRef.current || !rendererRef.current) return;
    const scene = sceneRef.current;
    if (allSketchGroupRef.current) {
      scene.remove(allSketchGroupRef.current);
      allSketchGroupRef.current.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      allSketchGroupRef.current = null;
    }
    if (sketchMode) return;
    const group = buildAllSketchShapesGroup(
      items,
      objectsRef,
      rendererRef.current,
    );
    if (group) {
      if (renderMode === "smooth") group.visible = false;
      scene.add(group);
      allSketchGroupRef.current = group;
    }
  }, [items, sketchMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Extrude profile selection fills ──────────────────────────────────────

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    // The region fills are needed for the whole extrude flow, not just profile
    // selection: the "Start from…" offset picker raycasts them as candidate
    // sketch planes.  Keep the group alive through depth + start, building it
    // once on entry and disposing only when the extrude ends.
    const active = ["profile", "start"].includes(extrudeSelectMode);
    if (!active) {
      if (extrudeSelectGroupRef.current) {
        scene.remove(extrudeSelectGroupRef.current);
        extrudeSelectGroupRef.current.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        });
        extrudeSelectGroupRef.current = null;
      }
      return;
    }
    if (!extrudeSelectGroupRef.current) {
      const group = buildExtrudeSelectGroup(
        items,
        objectsRef,
        curveSegments,
        printPrecision,
      );
      if (group) {
        scene.add(group);
        extrudeSelectGroupRef.current = group;
      }
    }
  }, [extrudeSelectMode, items, curveResolution]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Extrude depth input init ──────────────────────────────────────────────
  // The distance overlay + Confirm button appear as soon as the unified
  // select-and-extrude phase begins, so seed the input here (the face-pick
  // shortcut sets it first; the guard avoids clobbering that).  A retarget
  // pre-fills from the extrude being re-pointed; a fresh extrude uses a 10 mm
  // default.
  useEffect(() => {
    if (extrudeSelectMode !== "profile") return;
    const st = useStore.getState();
    if (st.extrudeDepthInput) return;
    const retargetId = st.extrudeRetargetId;
    const retarget =
      retargetId != null ? items.find((i) => i.id === retargetId) : null;
    const depth = retarget ? resolveItemDepth(retarget) : 1.0;
    st.setExtrudeDepthInput({
      defaultDepth: depth,
      currentDepth: depth,
      cut: !!retarget?.isCut,
      startOffset: retarget?.startOffset ?? 0,
    });
  }, [extrudeSelectMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Transparent during extrude ────────────────────────────────────────────
  // While the user is choosing a profile, dragging the depth, OR the
  // async CSG cut is still running, force the render mode to
  // "transparent" so they can see through the source solid.  Stashes
  // the prior mode in a ref and restores it once both flags clear —
  // setExtrudeSelectMode(null) fires synchronously in finalizeExtrude,
  // but the actual CSG difference runs after a microtask, so without
  // the cutExtrudeInProgress flag the source solid would pop back to
  // opaque for a frame before the cut result lands.
  useEffect(() => {
    const inExtrude = extrudeSelectMode != null || cutExtrudeInProgress;
    if (inExtrude) {
      if (preExtrudeRenderModeRef.current == null) {
        preExtrudeRenderModeRef.current = renderMode;
      }
      if (renderMode !== "transparent") {
        useStore.getState().setRenderMode("transparent");
      }
    } else if (preExtrudeRenderModeRef.current != null) {
      const prev = preExtrudeRenderModeRef.current;
      preExtrudeRenderModeRef.current = null;
      if (prev !== renderMode) {
        useStore.getState().setRenderMode(prev);
      }
    }
  }, [extrudeSelectMode, cutExtrudeInProgress]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Emissive highlight ────────────────────────────────────────────────────

  useEffect(() => {
    updateEmissive(objectsRef, selectedId, selectedIds, hoveredId);
  }, [hoveredId, selectedId, selectedIds]);

  // ── Render mode ───────────────────────────────────────────────────────────
  // Also re-runs on curveResolution changes so the wireframe (and the
  // primitive shader vs. wireframe swap) picks up the new chord-deviation
  // precision and matches the smooth shader / CSG / bevel resolution.

  useEffect(() => {
    if (!sceneRef.current || !rendererRef.current) return;
    applyRenderMode(renderMode, {
      scene: sceneRef.current,
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
    const isSmooth = renderMode === "smooth";
    if (allSketchGroupRef.current)
      allSketchGroupRef.current.visible = !isSmooth;
    if (sketchShapesGroupRef.current)
      sketchShapesGroupRef.current.visible = !isSmooth;
  }, [renderMode, curveResolution]); // eslint-disable-line react-hooks/exhaustive-deps
}
