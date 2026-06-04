// Extrude profile selection + depth drag + commit pipeline.  The
// React layer kicks the flow off by setting extrudeSelectMode=
// "profile"; this module then handles the hover/click sequence:
//
//   profile → user clicks a sketch loop or solid face
//   depth   → user drags (or types in the FormulaInput) to set depth
//   commit  → finalizeExtrude writes the new extrude item to the store
//             (and, for cut mode, runs a CSG difference asynchronously)

import * as THREE from "three";
import { useStore } from "../../store";
import { resolveItemDepth, formatAsFormula } from "../geometryParams.js";
import { polyArea } from "../sceneObjects.js";
import {
  makeExtrudePreviewMesh,
  extractFaceProfile,
} from "./extrudeGeometry.js";

export function createExtrudeHelpers(
  { scene, renderer, cameraRef, objectsRef, itemsRef, extrudeSelectGroupRef },
  {
    clearFaceHighlight,
    applyFaceHighlight,
    screenToSketchLocal,
    pointInPolygon2D,
    makeRay,
  },
) {
  let extrudePreviewMesh = null;
  let extrudeProfileData = null;
  let extrudeDepthOriginV3 = null;
  let extrudeNormalV3 = null;

  const clearExtrudePreview = () => {
    if (extrudePreviewMesh) {
      scene.remove(extrudePreviewMesh);
      extrudePreviewMesh.geometry.dispose();
      extrudePreviewMesh.material.dispose();
      extrudePreviewMesh = null;
    }
  };

  // Rebuild the preview prism in the scene.  Geometry construction lives in
  // extrudeGeometry.js; this owns the scene add + the single-mesh state.
  const buildExtrudePreviewMesh = (profile, depth) => {
    clearExtrudePreview();
    const cutMode = !!useStore.getState().extrudeDepthInput?.cut;
    const mesh = makeExtrudePreviewMesh(profile, depth, cutMode);
    if (!mesh) return;
    extrudePreviewMesh = mesh;
    scene.add(extrudePreviewMesh);
  };

  const computeExtrudeDepth = (screenX, screenY) => {
    if (!extrudeDepthOriginV3 || !extrudeNormalV3) return 1.0;
    const ray = makeRay(screenX, screenY);
    const camDir = new THREE.Vector3();
    cameraRef.current.getWorldDirection(camDir);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      camDir,
      extrudeDepthOriginV3,
    );
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return 1.0;
    const depth = hit.sub(extrudeDepthOriginV3).dot(extrudeNormalV3);
    // Preserve sign so dragging the cursor to the back side of the
    // sketch plane produces a negative-direction extrusion.  Only the
    // magnitude is clamped to the 0.05 minimum (zero-depth extrusions
    // would be a degenerate face).
    const sign = depth < 0 ? -1 : 1;
    return sign * Math.max(0.05, Math.abs(depth));
  };

  const handleExtrudeHover = (screenX, screenY) => {
    const fills =
      extrudeSelectGroupRef && extrudeSelectGroupRef.current
        ? extrudeSelectGroupRef.current.children
        : [];
    fills.forEach((m) => {
      m.material.opacity = 0;
    });
    const ray = makeRay(screenX, screenY);
    // Check sketch fills first
    if (fills.length > 0) {
      const hits = ray.intersectObjects(fills, false);
      if (hits.length > 0) {
        hits[0].object.material.opacity = 0.3;
        renderer.domElement.style.cursor = "pointer";
        clearFaceHighlight();
        return;
      }
    }
    // Check solid object faces
    const solids = Object.values(objectsRef.current).filter((m) => {
      if (!m.visible) return false;
      const it = itemsRef.current.find((i) => i.id === m.userData.itemId);
      return it && it.type !== "sketch" && it.type !== "extrude";
    });
    const solidHits = ray.intersectObjects(solids, false);
    if (solidHits.length > 0) {
      applyFaceHighlight(solidHits[0], 0x4488ff);
      renderer.domElement.style.cursor = "pointer";
      return;
    }
    clearFaceHighlight();
    renderer.domElement.style.cursor = "crosshair";
  };

  // Enter the depth-drag phase for a captured face profile (shared by the
  // click-a-face path and the extrude-the-selected-face shortcut).
  const beginFaceDepthExtrude = (profile) => {
    extrudeProfileData = profile;
    extrudeDepthOriginV3 = new THREE.Vector3(
      profile.position.x,
      profile.position.y,
      profile.position.z,
    );
    extrudeNormalV3 = new THREE.Vector3(
      profile.normalWorld.x,
      profile.normalWorld.y,
      profile.normalWorld.z,
    );
    const retargetItem = itemsRef.current.find(
      (i) => i.id === useStore.getState().extrudeRetargetId,
    );
    const retargetDepth = retargetItem ? resolveItemDepth(retargetItem) : 1.0;
    const retargetIsCut = !!retargetItem?.isCut;
    buildExtrudePreviewMesh(profile, retargetDepth);
    useStore.getState().setExtrudeSelectMode("depth");
    useStore.getState().setExtrudeDepthInput({
      defaultDepth: retargetDepth,
      currentDepth: retargetDepth,
      cut: retargetIsCut,
    });
    renderer.domElement.style.cursor = "ns-resize";
  };

  // Extrude the currently-selected solid face along its normal — the
  // shortcut the React extrude button takes when a face is selected, so the
  // user doesn't have to re-click the face in profile-select mode.  Builds a
  // synthetic hit from the stored face normal + centroid so extractFaceProfile
  // can capture the face outline.  Returns true if it started a face extrude.
  const startFaceExtrudeFromSelection = () => {
    const sub = useStore.getState().selectedSubGeometry;
    const face = sub?.faces?.[0];
    if (!face || face.cx == null) return false;
    const mesh = objectsRef.current[sub.itemId];
    if (!mesh) return false;
    mesh.updateMatrixWorld(true);
    const hit = {
      object: mesh,
      face: { normal: new THREE.Vector3(face.nx, face.ny, face.nz) },
      point: mesh.localToWorld(new THREE.Vector3(face.cx, face.cy, face.cz)),
    };
    const profile = extractFaceProfile(hit);
    if (!profile) return false;
    useStore.getState().clearSelectedSubGeometry();
    beginFaceDepthExtrude(profile);
    return true;
  };

  const handleExtrudeProfileClick = (screenX, screenY) => {
    const fills = extrudeSelectGroupRef?.current?.children ?? [];
    if (fills.length > 0) {
      // Use 2D point-in-polygon detection instead of 3D raycasting so that the most
      // specific (smallest-area) region is always selected even when multiple fill meshes
      // are coplanar and raycasting would return an arbitrary first hit.
      let bestFill = null;
      let bestArea = Infinity;
      let bestLocalPt = null;
      for (const fill of fills) {
        const profile = fill.userData.extrudeProfile;
        if (!profile) continue;
        const sketchMesh = objectsRef.current[profile.sketchId];
        if (!sketchMesh) continue;
        const localPt = screenToSketchLocal(screenX, screenY, sketchMesh);
        if (!localPt) continue;
        const inOuter = pointInPolygon2D(localPt, profile.polygon2D);
        const inHole = (profile.holes || []).some((h) =>
          pointInPolygon2D(localPt, h),
        );
        if (inOuter && !inHole) {
          const area = polyArea(profile.polygon2D);
          if (area < bestArea) {
            bestFill = fill;
            bestArea = area;
            bestLocalPt = localPt;
          }
        }
      }
      if (bestFill) {
        const profile = bestFill.userData.extrudeProfile;
        // Use the actual click position as profileCentroid rather than the
        // pre-computed polyCentroid(polygon).  polyCentroid is the arithmetic
        // mean of polygon vertices, which is biased toward densely-sampled arc
        // boundaries and can fall inside a neighbouring smaller region.  The
        // click point is guaranteed to be inside the correct polygon (we just
        // verified inOuter && !inHole above), so it is a reliable anchor for
        // profile re-matching in buildSceneObjects.
        extrudeProfileData = { ...profile, profileCentroid: bestLocalPt };
        extrudeDepthOriginV3 = new THREE.Vector3(
          profile.position.x,
          profile.position.y,
          profile.position.z,
        );
        extrudeNormalV3 = new THREE.Vector3(
          profile.normalWorld.x,
          profile.normalWorld.y,
          profile.normalWorld.z,
        );
        const retargetItem = itemsRef.current.find(
          (i) => i.id === useStore.getState().extrudeRetargetId,
        );
        const retargetDepth = retargetItem
          ? resolveItemDepth(retargetItem)
          : 1.0;
        const retargetIsCut = !!retargetItem?.isCut;
        buildExtrudePreviewMesh(profile, retargetDepth);
        useStore.getState().setExtrudeSelectMode("depth");
        useStore.getState().setExtrudeDepthInput({
          defaultDepth: retargetDepth,
          currentDepth: retargetDepth,
          cut: retargetIsCut,
        });
        renderer.domElement.style.cursor = "ns-resize";
        return;
      }
    }
    const ray = makeRay(screenX, screenY);
    const solids = Object.values(objectsRef.current).filter((m) => {
      if (!m.visible) return false;
      const it = itemsRef.current.find((i) => i.id === m.userData.itemId);
      return it && it.type !== "sketch" && it.type !== "extrude";
    });
    const solidHits = ray.intersectObjects(solids, false);
    if (solidHits.length > 0) {
      const profile = extractFaceProfile(solidHits[0]);
      if (profile) beginFaceDepthExtrude(profile);
    }
  };

  const handleExtrudeDepthMove = (screenX, screenY) => {
    const depth = computeExtrudeDepth(screenX, screenY);
    if (!extrudeProfileData) return;
    buildExtrudePreviewMesh(extrudeProfileData, depth);
    // Keep the depth-input overlay in sync with the mouse-driven depth so
    // the user can see the current value (and edit / confirm with Enter).
    const store = useStore.getState();
    const current = store.extrudeDepthInput;
    if (current) {
      // computeExtrudeDepth already clamps |depth| to ≥ 0.05 with the
      // sign preserved — don't re-clamp to positive here or backward
      // drags can't update the overlay.  The sign of the stored depth
      // controls direction (positive = along face normal, negative =
      // opposite) for both cut and non-cut extrudes.
      const clamped = depth;
      // Mouse-drag wins: clear any user-typed formula so the input reverts
      // to showing the current numeric mm value.
      if (
        Math.abs((current.currentDepth ?? -1) - clamped) > 1e-5 ||
        current.formula != null
      ) {
        store.setExtrudeDepthInput({
          ...current,
          currentDepth: clamped,
          formula: null,
        });
      }
    }
  };

  // Run a cut-extrusion: subtract the new extrude shape from the target
  // solid (or every visible solid when no source was captured), then hide
  // both the original target(s) and the new extrude so only the boolean
  // result remains visible.  Uses the same performCsg flow as the
  // Combine toolbar — runs async through occClient → OCC worker.
  const runCutExtrusion = async (
    extrudeItemId,
    sourceItemId,
    /* profileSnapshot */ _profileSnapshot,
    initialStore,
  ) => {
    try {
      const { performCsg } = await import("../occClient.js");
      const freshStore = useStore.getState();
      const items = freshStore.items;
      const extrude = items.find((i) => i.id === extrudeItemId);
      if (!extrude) return;
      // Determine the targets to cut from.  In priority order:
      //   1. sourceItemId from the extrude profile (face-profile path —
      //      the user clicked a solid face directly).
      //   2. The sketch's hostSolidId (recorded when the sketch was
      //      placed on a solid's face).  Without this, cuts on a
      //      sketch-loop fall back to every visible solid in the scene,
      //      which silently turns unrelated primitives into CSG items —
      //      the visible appearance changes (analytic shader →
      //      tessellated mesh) and the user perceives this as the cut
      //      having a wrong origin.
      //   3. Every visible non-sketch non-extrude item (last resort for
      //      sketches placed on an axis plane with no specific host).
      let targets;
      if (sourceItemId != null) {
        const src = items.find(
          (i) => i.id === sourceItemId && i.type !== "sketch",
        );
        targets = src ? [src] : [];
      } else {
        const sketchId = extrude?.profile?.sketchId ?? null;
        const sketch =
          sketchId != null ? items.find((i) => i.id === sketchId) : null;
        const hostId = sketch?.hostSolidId ?? null;
        if (hostId != null) {
          const host = items.find(
            (i) => i.id === hostId && i.type !== "sketch",
          );
          targets = host ? [host] : [];
        } else {
          targets = items.filter(
            (i) =>
              i.type !== "sketch" &&
              i.type !== "extrude" &&
              i.id !== extrudeItemId &&
              i.visible !== false,
          );
        }
      }
      if (targets.length === 0) {
        // Nothing to cut from — fold the standalone extrude away.
        // consumeItems instead of setItemsHidden so the hidden state is
        // written back into the extrude's CREATE history entry; otherwise
        // the next timeline replay would resurrect the extrude.
        useStore.getState().consumeItems([extrudeItemId]);
        return;
      }
      void initialStore;
      // Run one difference per target.  Each call produces a single CSG
      // item that replaces the target.
      for (const target of targets) {
        const result = await performCsg({
          selectedItems: [target, extrude],
          operation: "difference",
          printPrecision: freshStore.curveResolution === "print" ? 0.01 : null,
          allItems: items,
        });
        if (!result) continue;
        const after = useStore.getState();
        let maxId = 0;
        after.history.forEach((e) => {
          if (e.instruction?.type === "create" && e.instruction.item.id > maxId)
            maxId = e.instruction.item.id;
        });
        const id = maxId + 1;
        useStore.getState().addItem({
          id,
          name: `Cut ${id}`,
          type: "csg",
          children: [],
          position: result.position,
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          geometryData: result.geometryData,
          regenerator: {
            kind: "boolean",
            op: "difference",
            inputIds: [target.id, extrudeItemId],
            originalCenter: result.position,
            regeneratedAt: freshStore.curveResolution === "print" ? 0.01 : null,
          },
        });
      }
      // Fold the source solids and the standalone extrude into the new
      // CSG cuts.  consumeItems rewrites each consumed item's CREATE
      // history entry to bake in `visible: false`, so a timeline replay
      // doesn't bring the original solids or the extrude back as
      // overlapping ghosts.
      useStore
        .getState()
        .consumeItems([extrudeItemId, ...targets.map((t) => t.id)]);
    } catch (err) {
      console.error("Cut extrusion failed:", err);
    }
  };

  // Boss extrusion from a solid face: union the freshly-created extrude with
  // the source solid, replacing both with a single CSG union (mirrors the cut
  // path, but adds material instead of subtracting).
  const runUnionExtrusion = async (extrudeItemId, sourceItemId) => {
    try {
      const { performCsg } = await import("../occClient.js");
      const freshStore = useStore.getState();
      const items = freshStore.items;
      const target = items.find(
        (i) => i.id === sourceItemId && i.type !== "sketch",
      );
      const extrude = items.find((i) => i.id === extrudeItemId);
      if (!target || !extrude) return;
      const precision = freshStore.curveResolution === "print" ? 0.01 : null;
      const result = await performCsg({
        selectedItems: [target, extrude],
        operation: "union",
        printPrecision: precision,
        allItems: items,
      });
      if (!result) return;
      let maxId = 0;
      useStore.getState().history.forEach((e) => {
        if (e.instruction?.type === "create" && e.instruction.item.id > maxId)
          maxId = e.instruction.item.id;
      });
      const id = maxId + 1;
      useStore.getState().addItem({
        id,
        name: `Union ${id}`,
        type: "csg",
        children: [],
        position: result.position,
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        geometryData: result.geometryData,
        regenerator: {
          kind: "boolean",
          op: "union",
          inputIds: [target.id, extrudeItemId],
          originalCenter: result.position,
          regeneratedAt: precision,
        },
      });
      useStore.getState().consumeItems([extrudeItemId, target.id]);
    } catch (err) {
      console.error("Union extrusion failed:", err);
    }
  };

  const finalizeExtrude = (
    screenX,
    screenY,
    depthOverride = null,
    formulaOverride = null,
  ) => {
    if (!extrudeProfileData) return;
    // Allow negative depths so the user can extrude backwards from the
    // sketch plane.  Only the *magnitude* is clamped to the 0.05 minimum
    // (zero-depth extrusions would just be a face, which OCC rejects).
    const rawDepth =
      depthOverride != null
        ? depthOverride
        : computeExtrudeDepth(screenX, screenY);
    const sign = rawDepth < 0 ? -1 : 1;
    const depth = sign * Math.max(0.05, Math.abs(rawDepth));
    clearExtrudePreview();
    const store = useStore.getState();
    const retargetId = store.extrudeRetargetId;
    const isCut = !!store.extrudeDepthInput?.cut;
    // Persist the depth signed — the sign controls direction (positive =
    // along face normal, negative = opposite) for both cut and non-cut
    // extrudes.  isCut flags the extrude for the "Extrude Cut" label
    // and the post-extrude difference boolean, but doesn't flip the
    // direction.
    const depthStored =
      typeof formulaOverride === "string" && formulaOverride.trim() !== ""
        ? formulaOverride.trim()
        : formatAsFormula(depth);
    const sourceItemId = extrudeProfileData?.sourceItemId ?? null;
    const profileSnapshot = extrudeProfileData;
    // Extruding a solid face (not a sketch) and not cutting → boss: union the
    // prism back into the source solid.
    const isFaceBoss =
      !isCut && profileSnapshot?.type === "face" && sourceItemId != null;
    let newExtrudeId = null;
    if (retargetId != null) {
      store.retargetExtrude(retargetId, extrudeProfileData, depthStored);
      store.setExtrudeRetargetId(null);
    } else {
      let maxId = 0;
      store.history.forEach((e) => {
        if (
          e.instruction &&
          e.instruction.type === "create" &&
          e.instruction.item.id > maxId
        )
          maxId = e.instruction.item.id;
      });
      newExtrudeId = maxId + 1;
      // Cut extrusions are consumed by the boolean immediately after
      // creation — distinguishing them in the object list ("Extrude
      // Cut" vs plain "Extrude") makes the timeline easier to read.
      const nameLabel = isCut ? "Extrude Cut" : "Extrude";
      store.addItem({
        id: newExtrudeId,
        name: `${nameLabel} ${newExtrudeId}`,
        type: "extrude",
        children: [],
        profile: extrudeProfileData,
        depth: depthStored,
        // `isCut` flips the prism direction in resolveItemDepth so the
        // OCC shape + rendered mesh extend INTO the source regardless
        // of the sign stored on `depth`.  Keeps `depth` displaying as
        // a positive mm value in the edit dialog.
        ...(isCut ? { isCut: true } : null),
        position: extrudeProfileData.position,
        rotation: extrudeProfileData.rotation,
        scale: { x: 1, y: 1, z: 1 },
      });
      if (isCut || isFaceBoss) {
        // addItem auto-selects the prism, but a cut/boss extrude exists for
        // only ~200ms before the boolean replaces it with a CSG item at the
        // result's position.  Leaving the prism selected attaches the
        // transform-handle bbox to the prism's mesh origin (item.position +
        // R·polyCentroid) — visibly different from the result's centre — so
        // the handles jump when the boolean lands.  Clearing the selection
        // here keeps the gizmo invisible until addItem(csg) reselects at the
        // right spot.
        store.selectItem(null);
      }
    }
    // Cut extrusion: subtract the freshly-created extrude from a target
    // solid via a difference boolean, then hide the now-redundant extrude
    // and the source solid (the cut result is a new CSG item that takes
    // their place visually).  Runs async via performCsg through occClient.
    // Set cutExtrudeInProgress so the Viewport's transparent-during-
    // extrude effect keeps the source solid see-through until the cut
    // actually lands, not just until the user confirms.
    if (isCut && newExtrudeId != null) {
      store.setCutExtrudeInProgress(true);
      void runCutExtrusion(
        newExtrudeId,
        sourceItemId,
        profileSnapshot,
        store,
      ).finally(() => {
        useStore.getState().setCutExtrudeInProgress(false);
      });
    } else if (isFaceBoss && newExtrudeId != null) {
      // Keep the source solid see-through until the union lands (same
      // rationale as the cut path).
      store.setCutExtrudeInProgress(true);
      void runUnionExtrusion(newExtrudeId, sourceItemId).finally(() => {
        useStore.getState().setCutExtrudeInProgress(false);
      });
    }
    extrudeProfileData = null;
    extrudeDepthOriginV3 = null;
    extrudeNormalV3 = null;
    store.setExtrudeSelectMode(null);
    store.setExtrudeDepthInput(null);
    renderer.domElement.style.cursor = "";
  };

  const cancelExtrude = () => {
    clearExtrudePreview();
    extrudeProfileData = null;
    extrudeDepthOriginV3 = null;
    extrudeNormalV3 = null;
    const fills =
      extrudeSelectGroupRef && extrudeSelectGroupRef.current
        ? extrudeSelectGroupRef.current.children
        : [];
    fills.forEach((m) => {
      m.material.opacity = 0;
    });
    clearFaceHighlight();
    renderer.domElement.style.cursor = "";
    const store = useStore.getState();
    store.setExtrudeSelectMode(null);
    store.setExtrudeRetargetId(null);
    store.setExtrudeDepthInput(null);
    store.setCutExtrudeInProgress(false);
  };

  return {
    clearExtrudePreview,
    buildExtrudePreviewMesh,
    handleExtrudeHover,
    handleExtrudeProfileClick,
    startFaceExtrudeFromSelection,
    handleExtrudeDepthMove,
    finalizeExtrude,
    cancelExtrude,
    get extrudeProfileData() {
      return extrudeProfileData;
    },
  };
}
