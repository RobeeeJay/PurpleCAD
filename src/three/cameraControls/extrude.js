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

  const buildExtrudePreviewMesh = (profile, depth) => {
    clearExtrudePreview();
    const poly = profile.polygon2D;
    if (!poly || poly.length < 3) return;
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y)));
    (profile.holes || []).forEach((h) => {
      if (h && h.length >= 3)
        shape.holes.push(
          new THREE.Path(h.map((p) => new THREE.Vector2(p.x, p.y))),
        );
    });
    // ExtrudeGeometry only accepts a positive depth.  For a negative
    // depth we extrude by the absolute value then translate the geometry
    // so the prism extends in the -Z (sketch-local) direction instead.
    const absDepth = Math.max(0.05, Math.abs(depth));
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: absDepth,
      bevelEnabled: false,
    });
    if (depth < 0) geo.translate(0, 0, -absDepth);
    // Cut-extrusions preview in red so the user can see at a glance that
    // their action will subtract material rather than add it.
    const cutMode = !!useStore.getState().extrudeDepthInput?.cut;
    const mat = new THREE.MeshBasicMaterial({
      color: cutMode ? 0xff4444 : 0x4488ff,
      transparent: true,
      opacity: cutMode ? 0.5 : 0.35,
      side: THREE.DoubleSide,
      depthTest: true,
    });
    extrudePreviewMesh = new THREE.Mesh(geo, mat);
    const rot = profile.rotation;
    extrudePreviewMesh.rotation.set(rot.x, rot.y, rot.z);
    const pos = profile.position;
    extrudePreviewMesh.position.set(pos.x, pos.y, pos.z);
    extrudePreviewMesh.renderOrder = 10;
    scene.add(extrudePreviewMesh);
  };

  const convexHull2D = (points) => {
    if (points.length <= 3) return points;
    let lo = 0;
    for (let i = 1; i < points.length; i++)
      if (points[i].x < points[lo].x) lo = i;
    const hull = [];
    let p = lo,
      safety = 0;
    do {
      hull.push(points[p]);
      let q = (p + 1) % points.length;
      for (let i = 0; i < points.length; i++) {
        const cross =
          (points[q].x - points[p].x) * (points[i].y - points[p].y) -
          (points[q].y - points[p].y) * (points[i].x - points[p].x);
        if (cross > 0) q = i;
      }
      p = q;
    } while (p !== lo && ++safety <= points.length + 2);
    return hull;
  };

  const extractFaceProfile = (hit) => {
    const hitMesh = hit.object;
    const localNormal = hit.face.normal.clone();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(
      hitMesh.matrixWorld,
    );
    const worldNormal = localNormal
      .clone()
      .applyMatrix3(normalMatrix)
      .normalize();

    const posAttr = hitMesh.geometry.getAttribute("position");
    const idxAttr = hitMesh.geometry.index;
    const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;
    const vA = new THREE.Vector3(),
      vB = new THREE.Vector3(),
      vC = new THREE.Vector3();
    const seen = new Map();
    for (let i = 0; i < triCount; i++) {
      let a, b, c;
      if (idxAttr) {
        a = idxAttr.getX(i * 3);
        b = idxAttr.getX(i * 3 + 1);
        c = idxAttr.getX(i * 3 + 2);
      } else {
        a = i * 3;
        b = i * 3 + 1;
        c = i * 3 + 2;
      }
      vA.set(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a));
      vB.set(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b));
      vC.set(posAttr.getX(c), posAttr.getY(c), posAttr.getZ(c));
      const triNorm = new THREE.Vector3()
        .crossVectors(
          new THREE.Vector3().subVectors(vB, vA),
          new THREE.Vector3().subVectors(vC, vA),
        )
        .normalize();
      if (triNorm.dot(localNormal) < 0.99) continue;
      for (const v of [vA, vB, vC]) {
        const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
        if (!seen.has(key))
          seen.set(key, v.clone().applyMatrix4(hitMesh.matrixWorld));
      }
    }
    if (seen.size < 3) return null;

    // Build face-local 2D coordinate system consistent with the rotation quaternion
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      worldNormal,
    );
    const euler = new THREE.Euler().setFromQuaternion(q);
    const xLocal = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const yLocal = new THREE.Vector3(0, 1, 0).applyQuaternion(q);

    const origin = hit.point.clone();
    const verts2D = [...seen.values()].map((v) => {
      const rel = v.clone().sub(origin);
      return { x: rel.dot(xLocal), y: rel.dot(yLocal) };
    });
    const polygon2D = convexHull2D(verts2D);
    if (polygon2D.length < 3) return null;

    return {
      type: "face",
      polygon2D,
      position: { x: origin.x, y: origin.y, z: origin.z },
      rotation: { x: euler.x, y: euler.y, z: euler.z },
      normalWorld: { x: worldNormal.x, y: worldNormal.y, z: worldNormal.z },
      // The solid the face came from — used as the natural target of a
      // cut-extrusion when one is requested via the depth-overlay toggle.
      sourceItemId: hitMesh.userData?.itemId ?? null,
    };
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
      if (profile) {
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
      }
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
      if (isCut) {
        // addItem auto-selects the prism, but a cut extrude exists for
        // only ~200ms before runCutExtrusion replaces it with a CSG
        // item at the TARGET's position.  Leaving the prism selected
        // attaches the transform-handle bbox to the prism's mesh
        // origin (item.position + R·polyCentroid) — visibly different
        // from the target's centre — so the handles jump in X / Z when
        // the cut lands.  Clearing the selection here keeps the gizmo
        // invisible until addItem(csg) reselects at the right spot.
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
    handleExtrudeDepthMove,
    finalizeExtrude,
    cancelExtrude,
    get extrudeProfileData() {
      return extrudeProfileData;
    },
  };
}
