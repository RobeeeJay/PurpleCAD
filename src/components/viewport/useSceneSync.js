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
import {
  updateEmissive,
  finalizeVisibility,
  updateSketchPlaneVisibility,
} from "../../three/objectMaterials.js";
import { resolveItemDepth } from "../../three/geometryParams.js";
import { reconcileSelectionHighlight } from "../../three/selectionHighlights.js";
import {
  CROSS_SECTION_PLANE,
  updateCrossSectionPlane,
} from "../../three/crossSection.js";
import {
  ensureCaps,
  rebuildCaps,
  setCapsEnabled,
} from "../../three/crossSectionCaps.js";
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
  sweepSelectMode,
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
  sketchMode,
  sketchPlacementMode,
  extrudeSelectMode,
  cutExtrudeInProgress,
  hoveredId,
  projectionMode,
  axisVisible,
  shadowsEnabled,
  crossSectionView,
  pathTraceView,
  curveSegments,
  printPrecision,
  activeSketchTool,
  setSketchMode,
  setSketchDrawPhase,
  setRotationState,
}) {
  const defaultMaterial = useStore((s) => s.defaultMaterial);
  const materialDialogTarget = useStore((s) => s.materialDialogTarget);
  const soloItemId = useStore((s) => s.soloItemId);
  const booleanTool = useStore((s) => s.booleanTool);
  const booleanCutIds = useStore((s) => s.booleanCutIds);
  const pattern3dTool = useStore((s) => s.pattern3dTool);
  const mirror3dTool = useStore((s) => s.mirror3dTool);
  // The Emboss tool reuses the extrude-select fills to pick sketch geometry.
  const embossGeomPicking = useStore(
    (s) => s.embossTool?.picking === "geometry",
  );
  // Tracks whether the path tracer was ever started, so unmount can tear down
  // its render loop without loading the (lazy) module when it was never used.
  const pathTraceUsedRef = useRef(false);

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
    // (a fresh sketch plane, an extrusion, a primitive) must NOT recalc — nothing
    // existing changed — so compare per-item signatures and trigger only when an
    // id present both before and after differs (plus variable changes).  A plain
    // add / delete / move with nothing stale does NO regen at all.
    // Capture a boolean's inputIds (and those nested in a chamfer/fillet's
    // source snapshot, recursively) so a RETARGET — which re-points a union, and
    // any chamfer fused onto it, at a different prism set — counts as an upstream
    // change and takes the full recalc.  That path recomputes a chamfer-on-union
    // anchor; the cheap regen keeps the stale (old-region-count) position, so the
    // body's geometry would follow but its position would jump.
    const regenSig = (r) => {
      if (!r) return "";
      let base;
      if (r.kind === "boolean") base = `b${JSON.stringify(r.inputIds || [])}`;
      // Include a chamfer/fillet's params so editing them takes the full recalc
      // (writes history) — needed so a failed step's bad flag clears once the
      // edit makes it rebuild, not just in the cheap items-only pass.
      else if (r.kind === "chamfer")
        base = `c${r.amount ?? ""}:${r.angleRad ?? ""}:${r.segments ?? ""}`;
      // Likewise include the push/pull distance: it bbox-centres its result, so
      // editing the distance must take the full recalc to recompute the
      // position — the cheap items-only pass keeps the stale anchor and the
      // body's origin slides along the push/pull direction.
      else if (r.kind === "pushpull") base = `p${r.distance ?? ""}`;
      else base = r.kind;
      return r.source?.regenerator
        ? `${base}>${regenSig(r.source.regenerator)}`
        : base;
    };
    const itemSig = new Map();
    for (const i of items) {
      if (i.type === "sketch")
        itemSig.set(
          i.id,
          `s:${JSON.stringify(i.shapes)}:${JSON.stringify(i.constraints)}`,
        );
      else if (i.regenerator)
        itemSig.set(i.id, `r:${regenSig(i.regenerator)}:${i.depth ?? ""}`);
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
    const precisionChanged = !isFirst && printPrecision !== prev?.precision;
    // Some item's cached geometry is stale for the current precision (a freshly
    // loaded / dirtied csg).  A plain add / delete / move at the same precision
    // (e.g. dropping in a primitive) leaves every cache current — nothing stale.
    const hasStale = items.some((i) => {
      const r = i.regenerator;
      return r && !(r.regeneratedAt === printPrecision && i.geometryData);
    });
    upstreamSigRef.current = {
      map: itemSig,
      varsSig,
      precision: printPrecision,
    };

    // An upstream edit, a precision change, or a stale cache on first load takes
    // the full per-step recalc: it stamps the fresh tessellation back into HISTORY,
    // so a subsequent add doesn't keep re-deriving the csg as "stale".
    // (regenerateForResolution only updates the live items, not the history they're
    // replayed from — which is exactly why a precision change / load used to make
    // every later add re-run the csg.)
    const fullRecalc =
      upstreamChanged || precisionChanged || (isFirst && hasStale);

    // Anything to do?  Either an upstream/precision change, or the viewed step
    // has a stale/uncomputed cache (e.g. navigating to a step we haven't built
    // yet).  Nothing stale and no change — e.g. adding a primitive — skips the
    // regen pass entirely (no busy flash).
    const needsRecalc = fullRecalc || hasStale;
    if (!needsRecalc) return;

    // While a sketch is open, defer the recalc until it's closed — recomputing
    // every downstream step on each point drag is wasteful (and the 3D solids
    // are hidden behind the sketch anyway).  Runs in the sketch-close effect.
    if (sketchMode) {
      pendingRecalcRef.current = true;
      return;
    }

    // The orchestrator is a UI-only module that's never reachable from the OCC
    // worker's transitive imports, so it can route per-item regen through
    // occClient → worker without creating a bundling cycle.  recalculateTimeline
    // is now incremental (JIT) — it rebuilds only stale/dirty steps up to the
    // viewed one and stamps the result back into history, so navigating to an
    // already-built step is free and a first visit caches the step.
    import("../../three/regenerateOrchestrator.js").then((m) => {
      pendingRecalcRef.current = false;
      m.recalculateTimeline();
    });
  }, [items, printPrecision, variables]); // eslint-disable-line react-hooks/exhaustive-deps

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
      defaultMaterial,
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
    finalizeVisibility(
      objectsRef,
      itemsRef,
      selectedIdsRef.current,
      useStore.getState().soloItemId,
    );
    // Variables drive extrude depth and dimension distances via formula
    // resolution; re-run when they change so geometry/labels reflect the
    // new values.  soloItemId is here (not in the render-mode effect) because
    // toggling solo needs the FULL rebuild: fresh meshes restore visible=true,
    // applyRenderMode reapplies materials, then finalizeVisibility applies or
    // releases the solo override.
  }, [items, printPrecision, variables, defaultMaterial, soloItemId]); // eslint-disable-line react-hooks/exhaustive-deps

  // End solo if the soloed item is gone (deleted, or the timeline moved past
  // it), restoring the saved view so the user isn't left staring at a blank
  // scene with no button to toggle off.
  useEffect(() => {
    if (soloItemId == null) return;
    if (items.some((i) => i.id === soloItemId)) return;
    const st = useStore.getState();
    if (st.soloView) st._cameraControls?.restoreView?.(st.soloView);
    st.clearItemSolo();
  }, [items, soloItemId]);

  // Keep the sketch selection overlays glued to the committed geometry after an
  // external shapes change (e.g. undoing a move), so they don't linger at the
  // old positions until the user reselects.
  useEffect(() => {
    if (sketchModeRef.current)
      cameraControlsRef.current?.refreshSketchSelectionOverlays?.();
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Object-picking tools (boolean, 3D pattern, mirror) gather whole objects
    // as their source; the transform gizmo has no meaning there (and its
    // bounding box jumps around as the picked object changes), so suppress it
    // entirely while one of those dialogs is open.
    if (!selectedId || booleanTool || pattern3dTool || mirror3dTool) return;

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
  }, [
    selectedId,
    selectedIds,
    items,
    booleanTool,
    pattern3dTool,
    mirror3dTool,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

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
      group.userData.isSketchOverlay = true;
      scene.add(group);
      sketchShapesGroupRef.current = group;
    }
  }, [
    selectedId,
    items,
    constraintsVisible,
    dimensionsVisible,
    printPrecision,
    // Entering / leaving a mirror-or-pattern edit (double-click) toggles which
    // copies are hidden, so the in-sketch group must rebuild on tool change.
    activeSketchTool,
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
      group.userData.isSketchOverlay = true;
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
    // The same loop fills are reused by the sweep tools (Revolve/Pipe/Loft) to
    // pick a profile — build them while a sweep tool is awaiting a profile.
    // Loft picks two regions, so keep them while its second profile is pending.
    const sweepPicking =
      !!sweepSelectMode &&
      (!sweepSelectMode.profile ||
        (sweepSelectMode.kind === "loft" && !sweepSelectMode.secondProfile));
    const active =
      ["profile", "start"].includes(extrudeSelectMode) ||
      sweepPicking ||
      embossGeomPicking;
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
        // Retargeting an extrude: now that the region fills exist, start the
        // selection on the extrude's original profile so the user begins from
        // the existing geometry rather than an empty selection.
        if (useStore.getState().extrudeRetargetId != null) {
          cameraControlsRef.current?.preselectRetargetProfile?.();
        }
      }
    }
  }, [
    extrudeSelectMode,
    sweepSelectMode,
    embossGeomPicking,
    items,
    printPrecision,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // While the Material dialog is open, suppress all selection/hover tinting
  // so the live preview shows the material's true color.

  useEffect(() => {
    if (materialDialogTarget != null) {
      updateEmissive(objectsRef, null, [], null);
    } else {
      // In a boolean pick every gathered object is an equal input, so tint them
      // all with the single-selection colour rather than the primary/secondary
      // (multi-select) split.
      updateEmissive(
        objectsRef,
        selectedId,
        selectedIds,
        hoveredId,
        !!booleanTool,
        booleanCutIds,
      );
    }
    // Reveal a sketch's reference plane while it's hovered in the objects list.
    updateSketchPlaneVisibility(
      objectsRef,
      itemsRef,
      materialDialogTarget != null ? null : hoveredId,
      sketchModeRef.current,
      selectedId,
    );
    finalizeVisibility(
      objectsRef,
      itemsRef,
      selectedIds,
      useStore.getState().soloItemId,
    );
  }, [
    hoveredId,
    selectedId,
    selectedIds,
    materialDialogTarget,
    booleanTool,
    booleanCutIds,
  ]);

  // ── Render mode ───────────────────────────────────────────────────────────
  // Also re-runs on printPrecision changes so the wireframe (and the
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
    finalizeVisibility(
      objectsRef,
      itemsRef,
      selectedIdsRef.current,
      useStore.getState().soloItemId,
    );
    const isSmooth = renderMode === "smooth";
    if (allSketchGroupRef.current)
      allSketchGroupRef.current.visible = !isSmooth;
    if (sketchShapesGroupRef.current)
      sketchShapesGroupRef.current.visible = !isSmooth;
  }, [renderMode, printPrecision]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cross-section view ────────────────────────────────────────────────────
  // Clip the object meshes (only — helpers, grid, and the origin axis gizmo
  // stay whole) against the camera-locked section plane (updated per frame in
  // the animate loop).  Re-applies on every trigger that rebuilds or swaps
  // object materials (render mode, resolution, items, variables, default
  // material), since those discard the clip assignment.
  // Placed last so it runs after the build / render-mode effects on shared
  // deps.  (Analytic-shader primitives — sphere/cylinder/torus — use a custom
  // GLSL material without clipping support and are not sectioned.)
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.localClippingEnabled = true;
    // Seed the plane for the live camera so the cut is correct on this frame;
    // the animate loop keeps it tracking the camera thereafter.
    if (crossSectionView && cameraRef.current)
      updateCrossSectionPlane(cameraRef.current.quaternion, targetRef.current);
    const planes = crossSectionView ? [CROSS_SECTION_PLANE] : null;
    Object.values(objectsRef.current).forEach((mesh) => {
      // The sketch plane square is a reference surface, not solid — never clip
      // or cap it.
      const item = items.find((i) => i.id === mesh.userData.itemId);
      if (item?.type === "sketch") return;
      // Analytic primitives (sphere/cylinder/torus) clip via their own shader
      // uniform; the live view-space plane is pushed each frame by the animate
      // loop.  Toggle just the enable flag here.
      const sm = mesh.userData.shaderMat;
      if (sm?.uniforms?.uClipEnabled)
        sm.uniforms.uClipEnabled.value = crossSectionView ? 1 : 0;
      mesh.traverse((o) => {
        const mats = Array.isArray(o.material)
          ? o.material
          : o.material
            ? [o.material]
            : [];
        mats.forEach((m) => {
          // Analytic shader handled above; other custom shaders can't clip.
          if (m.uniforms?.uClipEnabled) return;
          if (m.isShaderMaterial && !m.isMeshPhysicalMaterial) return;
          if (m.clippingPlanes !== planes) {
            m.clippingPlanes = planes;
            m.needsUpdate = true;
          }
        });
      });
    });
    // Hatched caps across the cut faces (stencil-masked).  Only tessellated
    // solids are capped — skip the sketch plane and the analytic primitives
    // (their real surface isn't a triangle mesh the stencil pass could use).
    if (sceneRef.current) {
      ensureCaps(sceneRef.current);
      if (crossSectionView) {
        const capMeshes = Object.values(objectsRef.current).filter((mesh) => {
          const item = items.find((i) => i.id === mesh.userData.itemId);
          return item && item.type !== "sketch" && !mesh.userData.shaderMat;
        });
        rebuildCaps(capMeshes, CROSS_SECTION_PLANE);
        setCapsEnabled(true);
      } else {
        setCapsEnabled(false);
      }
    }
  }, [
    crossSectionView,
    renderMode,
    printPrecision,
    items,
    variables,
    defaultMaterial,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Path-traced render (prototype) ────────────────────────────────────────
  // Lazily loads three-gpu-pathtracer only when first enabled, then builds a
  // render scene (real geometry + PBR materials) and lets the tracer drive its
  // own accumulation loop.  Rebuilds on object/material changes while active.
  useEffect(() => {
    if (!rendererRef.current || !cameraRef.current) return;
    let cancelled = false;
    import("../../three/pathTrace.js")
      .then((pt) => {
        if (cancelled) return;
        if (pathTraceView && useStore.getState().pathTraceView) {
          pathTraceUsedRef.current = true;
          pt.enablePathTracer(rendererRef.current, cameraRef.current, {
            objectsRef,
            itemsRef,
          });
        } else {
          pt.disablePathTracer();
        }
      })
      .catch((err) => {
        console.error("Failed to load the path tracer module:", err);
        useStore.setState({ pathTraceView: false, pathTracerActive: false });
      });
    return () => {
      cancelled = true;
    };
  }, [pathTraceView, items, variables, defaultMaterial, soloItemId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop the path tracer's render loop if the viewport unmounts mid-render.
  useEffect(
    () => () => {
      if (pathTraceUsedRef.current)
        import("../../three/pathTrace.js").then((pt) => pt.disablePathTracer());
    },
    [],
  );
}
