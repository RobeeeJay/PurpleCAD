// Extrude profile selection + commit pipeline.  The React layer kicks the
// flow off by setting extrudeSelectMode="profile"; from then on it's a single
// phase:
//
//   profile → user clicks sketch regions / faces to toggle them in or out of
//             the selection (live preview), types a distance in the overlay,
//             and presses Confirm/Enter.  The mouse never sets the distance.
//   start   → optional sub-mode to pick a face/plane the extrude starts from.
//   commit  → finalizeExtrude writes the extrude item(s) to the store (and,
//             for cut/boss/multi-area, runs a CSG boolean asynchronously).

import * as THREE from "three";
import { useStore } from "../../store";
import { resolveItemDepth, formatAsFormula } from "../geometryParams.js";
import { polyArea } from "../sceneObjects.js";
import {
  makeExtrudePreviewMesh,
  extractFaceProfile,
} from "./extrudeGeometry.js";
import { runCutExtrusion, runUnionExtrudes } from "./extrudeBoolean.js";

export function createExtrudeHelpers(
  { scene, renderer, objectsRef, itemsRef, extrudeSelectGroupRef },
  {
    clearFaceHighlight,
    applyFaceHighlight,
    screenToSketchLocal,
    pointInPolygon2D,
    makeRay,
  },
) {
  let extrudePreviewMeshes = [];
  // The profiles being extruded together (click toggles membership).  The first
  // entry is the "primary" whose plane the start-offset picker measures from;
  // every profile is extruded at the same depth + start offset.  Each entry is
  // the raw profile object plus a transient `_fill` mesh ref (region picks only)
  // for the persistent highlight; `selectedFills` mirrors those refs.
  let extrudeProfileList = [];
  const selectedFills = new Set();
  // The solid the user picked via "Start from" (if any) — a strong union target
  // so the new body merges into whatever it was started from.
  let extrudeStartSolidId = null;

  const clearExtrudePreview = () => {
    for (const mesh of extrudePreviewMeshes) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    extrudePreviewMeshes = [];
  };

  const getStartOffset = () =>
    useStore.getState().extrudeDepthInput?.startOffset ?? 0;

  // Rebuild the preview prism(s) in the scene — one per selected profile.
  // Geometry construction lives in extrudeGeometry.js; this owns the scene add
  // + the mesh-list state.
  const rebuildPreviews = (depth) => {
    clearExtrudePreview();
    const cutMode = !!useStore.getState().extrudeDepthInput?.cut;
    const startOffset = getStartOffset();
    for (const profile of extrudeProfileList) {
      const mesh = makeExtrudePreviewMesh(profile, depth, cutMode, startOffset);
      if (!mesh) continue;
      extrudePreviewMeshes.push(mesh);
      scene.add(mesh);
    }
  };

  // Default prism length (scene units; 1 unit = 10 mm) shown before the user
  // types a distance.  Depth is now set only through the input field — never
  // by dragging the mouse.
  const DEFAULT_DEPTH = 1.0;
  const currentDepthValue = () =>
    useStore.getState().extrudeDepthInput?.currentDepth ?? DEFAULT_DEPTH;

  // The solid a non-cut extrude should union into: a face profile's source
  // solid, or the solid the sketch was placed on (its hostSolidId).  Null when
  // the sketch sits on a bare axis plane with nothing to merge into.
  const hostSolidIdFor = (profile, items) => {
    if (profile?.type === "face" && profile.sourceItemId != null)
      return profile.sourceItemId;
    const sketch =
      profile?.sketchId != null
        ? items.find((i) => i.id === profile.sketchId)
        : null;
    return sketch?.hostSolidId ?? null;
  };

  // Collect the existing solids a fresh batch of prisms should fuse with: the
  // start-from solid plus each profile's host.
  const unionTargetIdsFor = (profiles, items) => {
    const targets = new Set();
    if (extrudeStartSolidId != null) targets.add(extrudeStartSolidId);
    for (const p of profiles) {
      const h = hostSolidIdFor(p, items);
      if (h != null) targets.add(h);
    }
    return [...targets];
  };

  // World normal of a raycast face hit (used to gauge coplanarity on hover
  // without the cost of a full profile extraction).
  const worldFaceNormal = (hit) => {
    const m = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    return hit.face.normal.clone().applyMatrix3(m).normalize();
  };

  // True when a candidate face (given its world normal + a point on it) lies on
  // the same plane as the first selected face.  When the selection isn't a
  // face, there's no plane constraint, so everything passes.
  const samePlaneAsFirst = (normal, point) => {
    const first = extrudeProfileList[0];
    if (!first || first.type !== "face") return true;
    const na = first.normalWorld;
    if (normal.x * na.x + normal.y * na.y + normal.z * na.z < 0.999)
      return false;
    const d =
      (point.x - first.position.x) * na.x +
      (point.y - first.position.y) * na.y +
      (point.z - first.position.z) * na.z;
    return Math.abs(d) < 1e-2;
  };

  // Two captured face profiles are the same face (for toggle de-dup): aligned
  // normals and near-coincident anchor points.
  const sameFace = (a, b) => {
    if (a.type !== "face" || b.type !== "face") return false;
    const na = a.normalWorld,
      nb = b.normalWorld;
    if (na.x * nb.x + na.y * nb.y + na.z * nb.z < 0.999) return false;
    return (
      Math.hypot(
        a.position.x - b.position.x,
        a.position.y - b.position.y,
        a.position.z - b.position.z,
      ) < 1e-2
    );
  };

  const handleExtrudeHover = (screenX, screenY) => {
    const fills =
      extrudeSelectGroupRef && extrudeSelectGroupRef.current
        ? extrudeSelectGroupRef.current.children
        : [];
    fills.forEach((m) => {
      // Keep already-selected fills lit so a multi-select stays visible.
      m.material.opacity = selectedFills.has(m) ? 0.45 : 0;
    });
    const ray = makeRay(screenX, screenY);
    // Check sketch fills first
    if (fills.length > 0) {
      const hits = ray.intersectObjects(fills, false);
      if (hits.length > 0) {
        hits[0].object.material.opacity = selectedFills.has(hits[0].object)
          ? 0.55
          : 0.3;
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
      // Once a face is selected, only coplanar faces can join the set — don't
      // highlight the ones the click would reject.
      const ok = samePlaneAsFirst(
        worldFaceNormal(solidHits[0]),
        solidHits[0].point,
      );
      if (ok) {
        applyFaceHighlight(solidHits[0], 0x4488ff);
        renderer.domElement.style.cursor = "pointer";
      } else {
        clearFaceHighlight();
        renderer.domElement.style.cursor = "not-allowed";
      }
      return;
    }
    clearFaceHighlight();
    renderer.domElement.style.cursor = "crosshair";
  };

  // Seed the unified select+depth phase with a face profile (the "extrude the
  // selected face" shortcut).  The depth input + Confirm button then appear and
  // the user can add coplanar faces or change the distance before confirming.
  const beginFaceDepthExtrude = (profile) => {
    extrudeProfileList = [{ ...profile, _fill: null }];
    const retargetItem = itemsRef.current.find(
      (i) => i.id === useStore.getState().extrudeRetargetId,
    );
    const depth = retargetItem ? resolveItemDepth(retargetItem) : DEFAULT_DEPTH;
    const isCut = !!retargetItem?.isCut;
    useStore.getState().setExtrudeSelectMode("profile");
    useStore.getState().setExtrudeDepthInput({
      defaultDepth: depth,
      currentDepth: depth,
      cut: isCut,
      startOffset: 0,
    });
    rebuildPreviews(depth);
    renderer.domElement.style.cursor = "crosshair";
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

  // Find the extrude profile under the cursor: the most specific (smallest-area)
  // sketch region first, then a solid face.  Returns { profile, fill } or null.
  // `fill` is the region's fill mesh (for persistent highlight) or null for a
  // face pick.
  const findProfileAt = (screenX, screenY) => {
    const fills = extrudeSelectGroupRef?.current?.children ?? [];
    if (fills.length > 0) {
      // 2D point-in-polygon (not raycast) so the smallest enclosing region wins
      // even when several fills are coplanar and raycast order is arbitrary.
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
        // Use the actual click position as profileCentroid rather than the
        // pre-computed polyCentroid(polygon) — the latter is biased toward
        // densely-sampled arc boundaries and can fall inside a neighbouring
        // smaller region.  The click point is guaranteed inside this polygon.
        const profile = {
          ...bestFill.userData.extrudeProfile,
          profileCentroid: bestLocalPt,
        };
        return { profile, fill: bestFill };
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
      if (profile) return { profile, fill: null };
    }
    return null;
  };

  // Click toggles a profile in/out of the selection and refreshes the live
  // preview.  Distance is never set by the click — only via the input field.
  // The selection is homogeneous: once a sketch region is picked only regions
  // can be added; once a face is picked only coplanar faces can be added.
  const handleExtrudeProfileClick = (screenX, screenY) => {
    const found = findProfileAt(screenX, screenY);
    if (!found) return;
    const kind = extrudeProfileList[0]?.type;
    if (kind && found.profile.type !== kind) return;
    if (
      found.profile.type === "face" &&
      !samePlaneAsFirst(
        new THREE.Vector3(
          found.profile.normalWorld.x,
          found.profile.normalWorld.y,
          found.profile.normalWorld.z,
        ),
        found.profile.position,
      )
    ) {
      useStore
        .getState()
        .showNotification?.("Faces must be on the same plane as the first");
      return;
    }
    if (found.fill) {
      // Region pick: identity is the fill mesh.
      if (selectedFills.has(found.fill)) {
        selectedFills.delete(found.fill);
        extrudeProfileList = extrudeProfileList.filter(
          (p) => p._fill !== found.fill,
        );
      } else {
        selectedFills.add(found.fill);
        extrudeProfileList.push({ ...found.profile, _fill: found.fill });
      }
    } else {
      // Face pick: de-dup by plane + anchor.
      const idx = extrudeProfileList.findIndex((p) =>
        sameFace(p, found.profile),
      );
      if (idx >= 0) extrudeProfileList.splice(idx, 1);
      else extrudeProfileList.push({ ...found.profile, _fill: null });
    }
    rebuildPreviews(currentDepthValue());
  };

  // Create one extrude item from a profile (shared depth/startOffset).  Cut
  // extrudes run their per-target difference here; non-cut extrudes defer to a
  // single batch union in finalizeExtrude (`willUnion` just suppresses the
  // transient selection so the gizmo doesn't flash before the boolean lands).
  const createOneExtrude = (
    store,
    profile,
    depthStored,
    isCut,
    startOffset,
    newExtrudeId,
    willUnion = false,
  ) => {
    const sourceItemId = profile?.sourceItemId ?? null;
    const nameLabel = isCut ? "Extrude Cut" : "Extrude";
    store.addItem({
      id: newExtrudeId,
      name: `${nameLabel} ${newExtrudeId}`,
      type: "extrude",
      children: [],
      profile,
      depth: depthStored,
      // Slides the prism's base along the profile normal so the extrude can
      // begin from a picked face/plane instead of the sketch plane.  Omit
      // when zero to keep item diffs clean.
      ...(startOffset ? { startOffset } : null),
      // `isCut` flips the prism direction in resolveItemDepth so the OCC
      // shape + rendered mesh extend INTO the source regardless of the sign
      // stored on `depth`.  Keeps `depth` displaying as a positive mm value.
      ...(isCut ? { isCut: true } : null),
      position: profile.position,
      rotation: profile.rotation,
      scale: { x: 1, y: 1, z: 1 },
    });
    if (isCut || willUnion) {
      // addItem auto-selects the prism, but it exists only briefly before a
      // boolean replaces it.  Leaving it selected would jump the transform
      // gizmo when the boolean lands.
      store.selectItem(null);
    }
    if (isCut) {
      store.setCutExtrudeInProgress(true);
      void runCutExtrusion(newExtrudeId, sourceItemId).finally(() =>
        useStore.getState().setCutExtrudeInProgress(false),
      );
    }
  };

  const finalizeExtrude = (depthOverride = null, formulaOverride = null) => {
    if (!extrudeProfileList.length) return;
    // Allow negative depths so the user can extrude backwards from the
    // sketch plane.  Only the *magnitude* is clamped to the 0.05 minimum
    // (zero-depth extrusions would just be a face, which OCC rejects).  Depth
    // comes from the input field (override) or the current typed value.
    const rawDepth =
      depthOverride != null ? depthOverride : currentDepthValue();
    const sign = rawDepth < 0 ? -1 : 1;
    const depth = sign * Math.max(0.05, Math.abs(rawDepth));
    clearExtrudePreview();
    const store = useStore.getState();
    const retargetId = store.extrudeRetargetId;
    const isCut = !!store.extrudeDepthInput?.cut;
    const startOffset = store.extrudeDepthInput?.startOffset ?? 0;
    // Persist the depth signed — the sign controls direction (positive =
    // along face normal, negative = opposite) for both cut and non-cut
    // extrudes.
    const depthStored =
      typeof formulaOverride === "string" && formulaOverride.trim() !== ""
        ? formulaOverride.trim()
        : formatAsFormula(depth);
    // The transient `_fill` mesh ref must never land in the serialized item.
    const profiles = extrudeProfileList.map(({ _fill, ...p }) => p);

    if (retargetId != null) {
      // Retarget is a single-profile edit (the "change profile" flow); the
      // multi-select path never sets a retarget id.
      store.retargetExtrude(retargetId, profiles[0], depthStored, startOffset);
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
      // A non-cut extrude fuses into the body it's attached to: union all the
      // new prisms with each other AND with their host solid(s) — the source
      // of a face boss, the solid the sketch sits on, or the solid "Start from"
      // was picked on.  Union when there's more than one prism OR at least one
      // host to merge with; otherwise the lone prism stands alone (nothing to
      // fuse).  Cut keeps its per-target difference (unioning subtractions
      // makes no sense).
      const unionTargets = isCut
        ? []
        : unionTargetIdsFor(profiles, store.items);
      const willUnion =
        !isCut && (profiles.length > 1 || unionTargets.length > 0);
      const newIds = profiles.map((profile, i) => {
        const id = maxId + 1 + i;
        createOneExtrude(
          store,
          profile,
          depthStored,
          isCut,
          startOffset,
          id,
          willUnion,
        );
        return id;
      });
      if (willUnion) {
        store.setCutExtrudeInProgress(true);
        void runUnionExtrudes(newIds, unionTargets).finally(() =>
          useStore.getState().setCutExtrudeInProgress(false),
        );
      }
    }
    extrudeProfileList = [];
    selectedFills.clear();
    extrudeStartSolidId = null;
    store.setExtrudeSelectMode(null);
    store.setExtrudeDepthInput(null);
    renderer.domElement.style.cursor = "";
  };

  // --- Offset start-point picking ----------------------------------------
  // The user taps "Set start" in the depth overlay, then clicks a solid face
  // or sketch plane; the prism's base slides along the extrude normal to sit
  // at that surface.  The offset is the signed projection of the picked point
  // onto the normal, measured from the primary profile's base.

  // Solid faces are the meaningful offset targets.  They're tested BEFORE the
  // sketch-region fills because those fills are invisible (opacity 0) yet still
  // raycastable, and they sit right on the sketch plane — when you sketch on an
  // object's face the fill is coincident with that face and would otherwise
  // intercept every ray, so the face under the cursor never lights up.
  // Mirror the Alt/Option face-pick target set (onViewHover faceMode): every
  // visible non-sketch mesh.  Crucially this INCLUDES extrude / csg solids —
  // those are exactly the bodies you want to start an offset from, and
  // excluding them was why their faces couldn't be picked.
  const solidStartTargets = () =>
    Object.values(objectsRef.current).filter((m) => {
      if (m.visible === false) return false;
      const it = itemsRef.current.find((i) => i.id === m.userData.itemId);
      return it && it.type !== "sketch";
    });

  // The picked point + whether it was a face (vs a sketch-plane fill).  Faces
  // win; a fill is only used when no solid face is under the cursor.
  const startPickHit = (ray) => {
    const solidHits = ray.intersectObjects(solidStartTargets(), false);
    if (solidHits.length > 0) return { hit: solidHits[0], isFace: true };
    const fills = extrudeSelectGroupRef?.current?.children ?? [];
    const fillHits = fills.length ? ray.intersectObjects(fills, false) : [];
    if (fillHits.length > 0) return { hit: fillHits[0], isFace: false };
    return null;
  };

  const beginExtrudeStartPick = () => {
    // The start offset is measured from the selected profile's plane, so a
    // profile must exist first — otherwise there's nothing to offset and face
    // clicks would no-op (origin/normal still null).
    if (!extrudeProfileList.length) {
      useStore
        .getState()
        .showNotification?.("Select geometry to extrude first");
      return;
    }
    useStore.getState().setExtrudeSelectMode("start");
    renderer.domElement.style.cursor = "crosshair";
  };

  // Clear any transient start-pick highlight (fill opacity + face overlay).
  const clearStartHighlight = () => {
    const fills = extrudeSelectGroupRef?.current?.children ?? [];
    fills.forEach((m) => {
      m.material.opacity = 0;
    });
    clearFaceHighlight();
  };

  const handleExtrudeStartHover = (screenX, screenY) => {
    clearStartHighlight();
    const picked = startPickHit(makeRay(screenX, screenY));
    if (!picked) {
      renderer.domElement.style.cursor = "crosshair";
      return;
    }
    // Light up the surface under the cursor so the user sees what the extrude
    // will start from: the face-overlay highlight for a solid face, a
    // translucent fill for a sketch plane.
    if (picked.isFace) applyFaceHighlight(picked.hit, 0x44ddff);
    else picked.hit.object.material.opacity = 0.3;
    renderer.domElement.style.cursor = "pointer";
  };

  const handleExtrudeStartClick = (screenX, screenY) => {
    // Measure the offset from the (live) first profile's plane, so it's correct
    // even if the cached origin/normal lag the selection.
    const primary = extrudeProfileList[0];
    if (!primary) return;
    const picked = startPickHit(makeRay(screenX, screenY));
    if (!picked) return;
    clearStartHighlight();
    const origin = new THREE.Vector3(
      primary.position.x,
      primary.position.y,
      primary.position.z,
    );
    const normal = new THREE.Vector3(
      primary.normalWorld.x,
      primary.normalWorld.y,
      primary.normalWorld.z,
    );
    const offset = picked.hit.point.clone().sub(origin).dot(normal);
    // Remember the solid the start was taken from so the extrude fuses into it.
    extrudeStartSolidId = picked.isFace
      ? (picked.hit.object.userData.itemId ?? null)
      : null;
    const store = useStore.getState();
    const current = store.extrudeDepthInput || {};
    store.setExtrudeDepthInput({ ...current, startOffset: offset });
    store.setExtrudeSelectMode("profile");
    rebuildPreviews(
      current.currentDepth ?? current.defaultDepth ?? DEFAULT_DEPTH,
    );
    renderer.domElement.style.cursor = "crosshair";
  };

  const cancelExtrude = () => {
    clearExtrudePreview();
    extrudeProfileList = [];
    selectedFills.clear();
    extrudeStartSolidId = null;
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
    rebuildPreviews,
    handleExtrudeHover,
    handleExtrudeProfileClick,
    startFaceExtrudeFromSelection,
    beginExtrudeStartPick,
    handleExtrudeStartHover,
    handleExtrudeStartClick,
    clearStartHighlight,
    finalizeExtrude,
    cancelExtrude,
    get hasProfiles() {
      return extrudeProfileList.length > 0;
    },
  };
}
