// Extrude profile selection + commit pipeline.  The React layer kicks the
// flow off by setting extrudeSelectMode="profile"; from then on it's a single
// phase:
//
//   profile → user clicks sketch regions / faces to toggle them in or out of
//             the selection (live preview), types a distance in the overlay,
//             and presses Confirm/Enter.  The mouse never sets the distance.
//   start   → optional sub-mode to pick a face/plane the extrude starts from.
//   to      → optional sub-mode to pick a face the extrude should reach; it
//             fills in the distance (extrudeFacePick.js).
//   commit  → finalizeExtrude writes the extrude item(s) to the store (and,
//             for cut/boss/multi-area, runs a CSG boolean asynchronously).

import * as THREE from "three";
import { useStore } from "../../store";
import { resolveItemDepth, formatAsFormula } from "../geometryParams.js";
import { polyArea, polyCentroid, polyContainsPoint } from "../sceneObjects.js";
import {
  makeExtrudePreviewMesh,
  extractFaceProfile,
} from "./extrudeGeometry.js";
import {
  runCutExtrusion,
  runCutExtrudes,
  runUnionExtrudes,
  runExtrudeUnion,
} from "./extrudeBoolean.js";
import { EXTRUDE_FACE_HIGHLIGHT } from "../theme.js";
import { createExtrudeFacePick } from "./extrudeFacePick.js";

// Which candidate region profile is the one an extrude was built from?
//
// Matches on the stored profile's POLYGON — relative area, centroid, and hole
// count — rather than "the smallest region containing the stored centroid".
// A ring-shaped profile's centroid sits inside its own hole, so a containment
// test skips the real region and matches a nested one instead, which made
// editing an extrude start on the wrong geometry.  Returns the index of the
// best candidate in `candidates`, or -1 when nothing matches the sketch.
export function bestProfileMatchIndex(sp, candidates) {
  if (!sp?.polygon2D) return -1;
  const spArea = polyArea(sp.polygon2D);
  const spC = polyCentroid(sp.polygon2D);
  const spHoles = (sp.holes || []).length;
  let bestIdx = -1;
  let bestErr = Infinity;
  candidates.forEach((fp, i) => {
    if (!fp?.polygon2D || fp.sketchId !== sp.sketchId) return;
    const fC = polyCentroid(fp.polygon2D);
    // Relative area error tolerates a curve tessellated at a different
    // resolution; the centroid term separates same-area regions; a hole-count
    // mismatch is a strong (but not fatal) penalty.
    const err =
      Math.abs(polyArea(fp.polygon2D) - spArea) / Math.max(spArea, 1e-9) +
      Math.hypot(fC.x - spC.x, fC.y - spC.y) * 0.1 +
      ((fp.holes || []).length === spHoles ? 0 : 0.5);
    if (err < bestErr) {
      bestErr = err;
      bestIdx = i;
    }
  });
  return bestIdx;
}

// The extrude item a profile commits to.  Module-level and exported because
// the agent API commits extrudes too, and has to write exactly the item this
// tool writes -- two hand-kept copies of this shape would drift.
export const buildExtrudeDef = (
  profile,
  depthStored,
  isCut,
  startOffset,
  id,
) => ({
  id,
  name: `${isCut ? "Extrude Cut" : "Extrude"} ${id}`,
  type: "extrude",
  children: [],
  profile,
  depth: depthStored,
  // Slides the prism's base along the profile normal so the extrude can begin
  // from a picked face/plane instead of the sketch plane.  Omit when zero to
  // keep item diffs clean.
  ...(startOffset ? { startOffset } : null),
  // `isCut` flips the prism direction in resolveItemDepth so the OCC shape +
  // rendered mesh extend INTO the source regardless of the sign on `depth`.
  ...(isCut ? { isCut: true } : null),
  position: profile.position,
  rotation: profile.rotation,
  scale: { x: 1, y: 1, z: 1 },
});

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
  // True right after a single-extrude retarget preselects the original region:
  // the next pick of a DIFFERENT region/face should REPLACE that preselection
  // (re-point the extrude) rather than add a second profile — otherwise the
  // original stays put and the new pick spawns an extra extrude, which reads as
  // "a new one is created instead of editing the existing one".
  let retargetSelectionUntouched = false;
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
  // start-from solid plus each profile's host.  A HIDDEN solid is never a union
  // target — the user hid it deliberately, so a boss must not silently fuse it
  // into a CSG result and make it reappear (the same rule resolveCutTargets
  // applies to cuts; the sign of the extrude depth is irrelevant to it).
  const unionTargetIdsFor = (profiles, items) => {
    const visibleSolid = (id) => {
      const it = items.find((i) => i.id === id);
      return it && it.type !== "sketch" && it.visible !== false;
    };
    const targets = new Set();
    if (extrudeStartSolidId != null && visibleSolid(extrudeStartSolidId))
      targets.add(extrudeStartSolidId);
    for (const p of profiles) {
      const h = hostSolidIdFor(p, items);
      if (h != null && visibleSolid(h)) targets.add(h);
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

  const handleExtrudeHover = (screenX, screenY, shift = false) => {
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
        // Preview the whole word a click would take, unless Shift restricts the
        // pick to the single hovered glyph.
        const group = shift ? [hits[0].object] : textGroupFills(hits[0].object);
        group.forEach((m) => {
          m.material.opacity = selectedFills.has(m) ? 0.55 : 0.3;
        });
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
        applyFaceHighlight(solidHits[0], EXTRUDE_FACE_HIGHLIGHT);
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

  // When retargeting an extrude, start the selection on the region the extrude
  // was originally built from (match the live fill whose loop contains the
  // stored profile centroid) so the user begins from the existing geometry.
  const preselectRetargetProfile = () => {
    const st = useStore.getState();
    const groupIds = st.extrudeRetargetGroup;
    const retargetId = st.extrudeRetargetId;
    const fusedId = st.extrudeRetargetFusedId;
    // A fused extrude (extrudeUnion / extrudeCut) keeps its prism recipes in
    // regenerator.extrudeDefs, not as store items — preselect from those, each
    // an object with a `.profile` just like an extrude item.
    const fusedItem =
      fusedId != null ? itemsRef.current.find((i) => i.id === fusedId) : null;
    // Preselect every prism of the group / fused body, or just the single
    // extrude.
    const sourceItems = fusedItem
      ? fusedItem.regenerator?.extrudeDefs || []
      : groupIds
        ? groupIds
            .map((id) => itemsRef.current.find((i) => i.id === id))
            .filter(Boolean)
        : retargetId != null
          ? [itemsRef.current.find((i) => i.id === retargetId)].filter(Boolean)
          : [];
    if (!sourceItems.length) return;
    const fills = extrudeSelectGroupRef?.current?.children ?? [];
    const picked = [];
    for (const item of sourceItems) {
      const sp = item?.profile;
      if (!sp?.polygon2D || sp.sketchId == null) continue;
      const i = bestProfileMatchIndex(
        sp,
        fills.map((f) => f.userData.extrudeProfile),
      );
      const best = i >= 0 ? fills[i] : null;
      // Keep the original click anchor only while it still lies inside the
      // matched region.  Carrying a stale one forward is how an edited extrude
      // ends up anchored on empty sketch space, which a shape drawn there
      // later then captures.
      const live = best?.userData.extrudeProfile;
      const keep =
        sp.profileCentroid &&
        live &&
        polyContainsPoint(live.polygon2D, sp.profileCentroid);
      if (best && !picked.some((p) => p.fill === best))
        picked.push({
          fill: best,
          pc: keep ? sp.profileCentroid : live.profileCentroid,
        });
    }
    if (!picked.length) return;
    extrudeProfileList = picked.map(({ fill, pc }) => ({
      ...fill.userData.extrudeProfile,
      profileCentroid: pc,
      _fill: fill,
    }));
    selectedFills.clear();
    picked.forEach(({ fill }) => selectedFills.add(fill));
    // Only single-extrude retargets replace-on-first-pick; a group retarget is
    // edited as a set, so its preselection accumulates as before.
    retargetSelectionUntouched = !groupIds && retargetId != null;
    rebuildPreviews(resolveItemDepth(sourceItems[0]));
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
  // A glyph fill's text group: every fill from the same text shape (one word).
  // Selecting one letter selects them all, since text is extruded as a unit.
  const textGroupKey = (profile) =>
    profile && profile.type === "sketchLoop" && profile.textShapeIdx != null
      ? `${profile.sketchId}:${profile.textShapeIdx}`
      : null;
  const textGroupFills = (fill) => {
    const key = textGroupKey(fill.userData.extrudeProfile);
    if (!key) return [fill];
    const fills = extrudeSelectGroupRef?.current?.children ?? [];
    return fills.filter((f) => textGroupKey(f.userData.extrudeProfile) === key);
  };
  // Add or remove a single region fill from the selection (no rebuild).
  const setFillSelected = (fill, selected) => {
    if (selected && !selectedFills.has(fill)) {
      selectedFills.add(fill);
      extrudeProfileList.push({ ...fill.userData.extrudeProfile, _fill: fill });
    } else if (!selected && selectedFills.has(fill)) {
      selectedFills.delete(fill);
      extrudeProfileList = extrudeProfileList.filter((p) => p._fill !== fill);
    }
  };

  const handleExtrudeProfileClick = (screenX, screenY, shift = false) => {
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
      // Region pick: identity is the fill mesh.  A text glyph toggles the whole
      // word (all its letters) as one unit; Shift restricts it to this glyph so
      // a single letter can be extruded on its own.
      const selecting = !selectedFills.has(found.fill);
      // Retarget: the first pick of a new region drops the preselected original
      // so profiles[0] becomes the new target (re-point, not add-a-duplicate).
      if (retargetSelectionUntouched && selecting) {
        selectedFills.clear();
        extrudeProfileList = [];
      }
      retargetSelectionUntouched = false;
      const group = shift ? [found.fill] : textGroupFills(found.fill);
      group.forEach((f) => setFillSelected(f, selecting));
    } else {
      // Face pick: de-dup by plane + anchor.
      const idx = extrudeProfileList.findIndex((p) =>
        sameFace(p, found.profile),
      );
      // Same retarget replace-on-first-new-pick as the region branch above.
      if (retargetSelectionUntouched && idx < 0) {
        selectedFills.clear();
        extrudeProfileList = [];
      }
      retargetSelectionUntouched = false;
      const dedup = extrudeProfileList.findIndex((p) =>
        sameFace(p, found.profile),
      );
      if (dedup >= 0) extrudeProfileList.splice(dedup, 1);
      else extrudeProfileList.push({ ...found.profile, _fill: null });
    }
    rebuildPreviews(currentDepthValue());
  };

  // ── Drag-select marquee (sketch-region profiles) ──────────────────────────
  let marqueeEl = null;
  const showExtrudeMarquee = (x1, y1, x2, y2) => {
    if (!marqueeEl) {
      marqueeEl = document.createElement("div");
      marqueeEl.style.cssText =
        "position:fixed;border:1px solid #5b8de8;background:rgba(91,141,232,0.15);" +
        "pointer-events:none;z-index:50;";
      document.body.appendChild(marqueeEl);
    }
    marqueeEl.style.left = `${Math.min(x1, x2)}px`;
    marqueeEl.style.top = `${Math.min(y1, y2)}px`;
    marqueeEl.style.width = `${Math.abs(x2 - x1)}px`;
    marqueeEl.style.height = `${Math.abs(y2 - y1)}px`;
    marqueeEl.style.display = "block";
  };
  const clearExtrudeMarquee = () => {
    if (marqueeEl) marqueeEl.style.display = "none";
  };

  // Drag-select: add (or, when `remove`, take away) every sketch-region profile
  // whose centre falls inside the screen box.  Faces aren't box-selectable.
  const handleExtrudeProfileBox = (x1, y1, x2, y2, remove, shift = false) => {
    clearExtrudeMarquee();
    // A box-select during retarget is a deliberate multi-region pick — keep it
    // additive, but consume the replace-on-first-pick arming so a later single
    // click doesn't unexpectedly wipe the box selection.
    retargetSelectionUntouched = false;
    const fills = extrudeSelectGroupRef?.current?.children ?? [];
    if (fills.length === 0) return;
    if (extrudeProfileList[0] && extrudeProfileList[0].type !== "sketchLoop")
      return; // can't mix a face selection with region box-select
    const minX = Math.min(x1, x2),
      maxX = Math.max(x1, x2),
      minY = Math.min(y1, y2),
      maxY = Math.max(y1, y2);
    const rect = renderer.domElement.getBoundingClientRect();
    const cam = makeRay(0, 0).camera;
    let changed = false;
    for (const fill of fills) {
      const profile = fill.userData.extrudeProfile;
      if (!profile || profile.type !== "sketchLoop") continue;
      const c = profile.profileCentroid;
      const ndc = new THREE.Vector3(c.x, c.y, 0)
        .applyQuaternion(fill.quaternion)
        .add(fill.position)
        .project(cam);
      const sx = ((ndc.x + 1) / 2) * rect.width + rect.left;
      const sy = ((-ndc.y + 1) / 2) * rect.height + rect.top;
      if (sx < minX || sx > maxX || sy < minY || sy > maxY) continue;
      const selected = selectedFills.has(fill);
      // A glyph dragged over pulls in (or releases) its whole word, unless Shift
      // restricts the box to the individual glyphs it covers.
      const group = shift ? [fill] : textGroupFills(fill);
      if (remove && selected) {
        group.forEach((f) => setFillSelected(f, false));
        changed = true;
      } else if (!remove && !selected) {
        group.forEach((f) => setFillSelected(f, true));
        changed = true;
      }
    }
    if (changed) rebuildPreviews(currentDepthValue());
  };

  // The extrude item definition for a profile.  Used both for items added to the
  // store and as the EMBEDDED prism recipes inside a multi-area union (so the
  // whole multi-area extrude is one timeline entry, not N prisms + a union).
  // Create one extrude item from a profile and, for a cut, run its per-target
  // difference.  (Multi-area non-cut prisms are created together via addItems
  // and fused by a separate union; this path handles cuts and lone extrudes.)
  const createOneExtrude = (
    store,
    profile,
    depthStored,
    isCut,
    startOffset,
    newExtrudeId,
  ) => {
    const sourceItemId = profile?.sourceItemId ?? null;
    store.addItem(
      buildExtrudeDef(profile, depthStored, isCut, startOffset, newExtrudeId),
    );
    if (isCut) {
      // addItem auto-selects the prism, but it exists only briefly before the
      // cut CSG replaces it.  Leaving it selected would jump the gizmo.
      store.selectItem(null);
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
    // "Always extrude as single object" (default on): multiple disjoint
    // profiles fuse into one body.  When off, pure-sketch multi-profile
    // extrudes stay separate; a boss still merges into its host.
    const combineSingle = store.alwaysExtrudeSingleObject !== false;
    // Persist the depth signed — the sign controls direction (positive =
    // along face normal, negative = opposite) for both cut and non-cut
    // extrudes.
    const depthStored =
      typeof formulaOverride === "string" && formulaOverride.trim() !== ""
        ? formulaOverride.trim()
        : formatAsFormula(depth);
    // The transient `_fill` mesh ref must never land in the serialized item.
    const profiles = extrudeProfileList.map(({ _fill, ...p }) => p);

    const retargetGroup = store.extrudeRetargetGroup;
    const fusedId = store.extrudeRetargetFusedId;
    if (fusedId != null) {
      // Edit a fused extrude (extrudeUnion / extrudeCut) in place: rebuild its
      // embedded prism recipes from the new selection + depth, no new entry.
      store.retargetFusedExtrude(fusedId, profiles, depthStored, startOffset);
      store.setExtrudeRetargetFusedId(null);
    } else if (retargetGroup) {
      // Retarget a whole multi-area group: rebuild its prisms from the new
      // selection and re-point the union — the group is edited as one unit.
      store.retargetGroup(retargetGroup, profiles, depthStored, startOffset);
      store.setExtrudeRetargetId(null);
      store.setExtrudeRetargetGroup(null);
    } else if (retargetId != null) {
      // Retarget the original extrude to the first selected profile.
      store.retargetExtrude(retargetId, profiles[0], depthStored, startOffset);
      store.setExtrudeRetargetId(null);
      // Extra regions picked during retarget aren't dropped: each becomes a new
      // extrude, and (non-cut) the whole set — the retargeted original, the new
      // prisms, and any host solids — fuses into one body, like the multi-area
      // extrude flow.  Cut keeps its per-region difference.
      if (profiles.length > 1) {
        let maxId = 0;
        useStore.getState().history.forEach((e) => {
          if (
            e.instruction &&
            e.instruction.type === "create" &&
            e.instruction.item.id > maxId
          )
            maxId = e.instruction.item.id;
        });
        if (!isCut && combineSingle) {
          // The extra regions become new prisms in ONE timeline step; a separate
          // Union step then fuses them with the retargeted original (by id) and
          // any hosts.  So the extras stay one entry, not N separate ones.
          const defs = profiles
            .slice(1)
            .map((profile, i) =>
              buildExtrudeDef(
                profile,
                depthStored,
                false,
                startOffset,
                maxId + 1 + i,
              ),
            );
          if (defs.length > 1) store.addItems(defs, "Extruded");
          else store.addItem(defs[0]);
          store.selectItem(null);
          const unionTargets = unionTargetIdsFor(
            profiles,
            useStore.getState().items,
          );
          store.setCutExtrudeInProgress(true);
          void runUnionExtrudes(
            [retargetId, ...defs.map((d) => d.id)],
            unionTargets,
            maxId + defs.length + 1,
          ).finally(() => useStore.getState().setCutExtrudeInProgress(false));
        } else {
          // Cut differences each extra region against its target; with the
          // single-object setting off, non-cut extras become separate solids.
          profiles.slice(1).forEach((profile, i) => {
            createOneExtrude(
              store,
              profile,
              depthStored,
              isCut,
              startOffset,
              maxId + 1 + i,
            );
          });
        }
      }
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
      // prisms with each other AND with their host solid(s) — the source of a
      // face boss, the solid the sketch sits on, or the "Start from" solid.
      // Union when there's more than one prism OR a host to merge with;
      // otherwise the lone prism stands alone.  Cut keeps its per-target
      // difference (unioning subtractions makes no sense).
      const unionTargets = isCut
        ? []
        : unionTargetIdsFor(profiles, store.items);
      const willUnion =
        !isCut &&
        (unionTargets.length > 0 || (profiles.length > 1 && combineSingle));
      if (willUnion) {
        // Fuse into ONE self-contained object in ONE timeline entry: the prism
        // recipes are embedded in the result's regenerator (no separate prism
        // items + Union step), and any host solids are merged in.
        const defs = profiles.map((profile, i) =>
          buildExtrudeDef(
            profile,
            depthStored,
            false,
            startOffset,
            maxId + 2 + i,
          ),
        );
        store.setCutExtrudeInProgress(true);
        void runExtrudeUnion(defs, unionTargets, maxId + 1).finally(() =>
          useStore.getState().setCutExtrudeInProgress(false),
        );
      } else if (!isCut && profiles.length > 1) {
        // "Single object" off: N separate prisms, but committed as ONE timeline
        // entry (a createGroup), not N.
        const defs = profiles.map((profile, i) =>
          buildExtrudeDef(
            profile,
            depthStored,
            false,
            startOffset,
            maxId + 1 + i,
          ),
        );
        store.addItems(defs, "Extruded");
        store.selectItem(null);
      } else if (isCut && profiles.length > 1) {
        // A multi-area cut (e.g. several holes) is ONE difference in ONE
        // timeline entry: the prism recipes ride in the result's regenerator.
        // Creating a prism + cut per profile instead raced N concurrent
        // differences against the same original target, so only one hole
        // survived.
        const defs = profiles.map((profile, i) =>
          buildExtrudeDef(
            profile,
            depthStored,
            true,
            startOffset,
            maxId + 2 + i,
          ),
        );
        store.setCutExtrudeInProgress(true);
        void runCutExtrudes(
          defs,
          profiles[0]?.sourceItemId ?? null,
          maxId + 1,
        ).finally(() => useStore.getState().setCutExtrudeInProgress(false));
      } else {
        // Cut prisms each difference their target; a lone non-cut prism is a
        // standalone extrude.
        profiles.forEach((profile, i) => {
          createOneExtrude(
            store,
            profile,
            depthStored,
            isCut,
            startOffset,
            maxId + 1 + i,
          );
        });
      }
    }
    extrudeProfileList = [];
    selectedFills.clear();
    retargetSelectionUntouched = false;
    extrudeStartSolidId = null;
    store.setExtrudeRetargetFusedId(null);
    store.setExtrudeSelectMode(null);
    store.setExtrudeDepthInput(null);
    renderer.domElement.style.cursor = "";
  };

  // Picking a face for the extrude to start from, or to reach
  // (extrudeFacePick.js).
  const {
    beginExtrudeStartPick,
    beginExtrudeToPick,
    clearStartHighlight,
    handleExtrudeStartHover,
    handleExtrudeStartClick,
  } = createExtrudeFacePick({
    renderer,
    objectsRef,
    itemsRef,
    extrudeSelectGroupRef,
    makeRay,
    applyFaceHighlight,
    clearFaceHighlight,
    getProfiles: () => extrudeProfileList,
    setStartSolidId: (id) => {
      extrudeStartSolidId = id;
    },
    rebuildPreviews,
    defaultDepth: DEFAULT_DEPTH,
  });

  const cancelExtrude = () => {
    clearExtrudePreview();
    extrudeProfileList = [];
    selectedFills.clear();
    retargetSelectionUntouched = false;
    extrudeStartSolidId = null;
    const fills =
      extrudeSelectGroupRef && extrudeSelectGroupRef.current
        ? extrudeSelectGroupRef.current.children
        : [];
    fills.forEach((m) => {
      m.material.opacity = 0;
    });
    clearFaceHighlight();
    clearExtrudeMarquee();
    renderer.domElement.style.cursor = "";
    const store = useStore.getState();
    store.setExtrudeSelectMode(null);
    store.setExtrudeRetargetId(null);
    store.setExtrudeRetargetGroup(null);
    store.setExtrudeRetargetFusedId(null);
    store.setExtrudeDepthInput(null);
    store.setCutExtrudeInProgress(false);
  };

  return {
    clearExtrudePreview,
    rebuildPreviews,
    handleExtrudeHover,
    handleExtrudeProfileClick,
    handleExtrudeProfileBox,
    showExtrudeMarquee,
    clearExtrudeMarquee,
    startFaceExtrudeFromSelection,
    preselectRetargetProfile,
    beginExtrudeStartPick,
    beginExtrudeToPick,
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
