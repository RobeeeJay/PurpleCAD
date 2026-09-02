// Emboss tool commit + live preview.  Builds the stamp recipe from the selected
// sketch profiles + target face, stamps it onto the body (union for emboss, cut
// for deboss), and ghosts the result over the source body.  Mirrors hole.js.

import * as THREE from "three";
import { useStore } from "../../store";
import { activePrecision } from "../resolution.js";
import { withLivePolygons } from "../csgUtils.js";
import { buildEmbossStamp } from "../embossGeometry.js";
import { reviveDevelopable } from "../regenerateItems.js";
import { chamferResultTransform } from "./chamferCommit.js";
import { DEFAULT_MESH_COLOR, WIREFRAME_EDGE_COLOR } from "../theme.js";
import { releaseSolid } from "../solidCache.js";

const GHOST_OPACITY = 0.12;

// The live preview already ran embossItem for the exact recipe the user is about
// to confirm; cache its result so Confirm reuses it instead of recomputing the
// same OCC boolean.  Keyed by a cheap signature of the stamp + source transform
// (what the result depends on); a mismatch (or no preview) falls back to a fresh
// build.  Consumed on commit.
let previewCache = null;
const embossKey = (recipe) => {
  const s = recipe.stamp || {};
  const pos = s.mesh?.positions || s.positions || [];
  const n = pos.length;
  const h = n ? pos[0] + pos[n >> 1] + pos[n - 1] : 0;
  return JSON.stringify({
    n,
    h,
    d: !!recipe.params?.deboss,
    p: recipe.source?.position,
    r: recipe.source?.rotation,
    sc: recipe.source?.scale,
  });
};

// Source snapshot + baked stamp recipe for the active emboss tool, or null until
// at least one sketch profile and a face are picked.
export function buildEmbossRecipe(items, printPrecision) {
  const et = useStore.getState().embossTool;
  if (!et || !et.face || !et.profiles || et.profiles.length === 0) return null;
  const item = items.find((i) => i.id === et.itemId);
  if (!item) return null;
  // Re-derive the source's profiles from the LIVE sketch — for a fresh emboss
  // (snapshot the current body) AND when editing (the stored pre-emboss source
  // is frozen at emboss-create time; using it raw rebuilds the edit on the OLD
  // size, reverting a since-resized body).  withLivePolygons keeps the source's
  // structure but refreshes its extrude polygons to the current sketch.
  const source = withLivePolygons(
    et.source || { ...item },
    items,
    printPrecision,
  );
  // Scale the wrap curve to the live wall radius so an edit after a resize wraps
  // the current wall, not the baked (old) radius.  No-op for a fresh emboss.
  const liveFaceSet = reviveDevelopable(et.faceSet, source, et.source || item);
  const stamp = buildEmbossStamp(
    et.profiles,
    et.face,
    et.params,
    items,
    printPrecision,
    liveFaceSet,
    source?.scale?.x ?? 1,
  );
  if (!stamp) return null;
  return {
    item,
    source,
    stamp,
    profiles: et.profiles,
    face: et.face,
    // Store the wrap curve re-baselined to the CURRENT wall (with the live
    // source), so a later resize scales from this size rather than a stale one.
    faceSet: liveFaceSet || null,
    params: { ...et.params },
  };
}

export async function commitEmboss({ items, printPrecision }) {
  const { embossItem, withCommitGuard } = await import("../occClient.js");
  const recipe = buildEmbossRecipe(items, printPrecision);
  if (!recipe) return false;
  const { item, source, stamp, profiles, face, faceSet, params } = recipe;
  let result;
  const cached =
    previewCache && previewCache.key === embossKey(recipe)
      ? previewCache
      : null;
  previewCache = null; // consume regardless
  if (cached) {
    // Reuse the preview's already-computed geometry — no OCC work on Confirm.
    result = {
      geometryData: cached.geometryData,
      centerOffset: cached.centerOffset,
    };
  } else {
    try {
      result = await withCommitGuard(() =>
        embossItem({
          source,
          stamp,
          allItems: items,
          printPrecision,
        }),
      );
    } catch (e) {
      useStore.getState().setToolError(e?.message || "Emboss failed.");
      return false;
    }
  }
  if (!result) return false;
  const { geometryData, centerOffset } = result;
  const { position, basePos } = chamferResultTransform(source, centerOffset);
  const store = useStore.getState();
  const editEntryId = store.embossTool?.editEntryId;
  store._cameraControls?.clearEmbossPreview?.();
  // Drop the picked-face highlight too, or it lingers on the body after Confirm
  // (cancel already clears it; the dialog's unmount cleanup never fires because
  // the component stays mounted and just renders null when the tool closes).
  store._cameraControls?.clearEmbossSelectedFaces?.();
  const regenerator = {
    kind: "emboss",
    source,
    profiles,
    face,
    faceSet,
    params,
    stamp,
    centerOffset,
    basePosition: basePos,
    // The frame the face/faceSet anchors were AUTHORED in: an extrude source is
    // its raw local frame (offset 0), a csg source is bbox-centred by its own
    // centerOffset.  If a relink later swaps the source kind (reorder/delete of
    // an upstream step), regenerateEmboss translates the anchors by
    // (authored - current) so the relief stays put instead of jumping by the
    // frame delta (half the body height for an extrude→chamfer swap).
    sourceCenterOffset: source?.regenerator?.centerOffset ?? {
      cx: 0,
      cy: 0,
      cz: 0,
    },
    regeneratedAt: printPrecision,
  };
  if (editEntryId != null) {
    store.updateEmbossEntry(editEntryId, {
      regenerator,
      position,
      geometryData,
    });
    // The entry keeps this freshly-committed geometry (no recompute), so its
    // OLD cached solid is stale — release it so a downstream consumer rebuilds
    // from the new baked mesh / recipe instead of the outdated B-rep.
    releaseSolid(editEntryId);
  } else {
    store.modifyItem(
      item.id,
      { type: "csg", position, regenerator, geometryData },
      "Emboss",
    );
  }
  store.cancelEmbossTool();
  return true;
}

export function createEmbossPreviewHelpers({ scene, itemsRef, objectsRef }) {
  let previewGroup = null;
  let ghosted = null;
  let requestId = 0;

  const removePreview = () => {
    if (!previewGroup) return;
    scene.remove(previewGroup);
    previewGroup.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    previewGroup = null;
  };

  const ghostSource = (itemId) => {
    const mesh = objectsRef.current[itemId];
    if (!mesh || (ghosted && ghosted.mesh === mesh)) return;
    unghostSource();
    const mat = mesh.material;
    ghosted = {
      mesh,
      opacity: mat.opacity,
      transparent: mat.transparent,
      depthWrite: mat.depthWrite,
      uOpacity: mat.uniforms?.uOpacity ? mat.uniforms.uOpacity.value : null,
      edges: mesh.children.map((c) => ({ child: c, visible: c.visible })),
    };
    mat.transparent = true;
    mat.depthWrite = false;
    if (mat.uniforms?.uOpacity) mat.uniforms.uOpacity.value = GHOST_OPACITY;
    else mat.opacity = GHOST_OPACITY;
    mat.needsUpdate = true;
    mesh.children.forEach((c) => (c.visible = false));
    mesh.userData.ghosted = true;
  };

  const unghostSource = () => {
    if (!ghosted) return;
    const { mesh, opacity, transparent, depthWrite, uOpacity, edges } = ghosted;
    const mat = mesh.material;
    if (mat) {
      mat.transparent = transparent;
      mat.depthWrite = depthWrite;
      if (uOpacity != null && mat.uniforms?.uOpacity)
        mat.uniforms.uOpacity.value = uOpacity;
      else mat.opacity = opacity;
      mat.needsUpdate = true;
    }
    edges.forEach(({ child, visible }) => (child.visible = visible));
    delete mesh.userData.ghosted;
    ghosted = null;
  };

  const clearEmbossPreview = () => {
    requestId++;
    removePreview();
    unghostSource();
    useStore.getState().setToolError(null);
  };

  const updateEmbossPreview = async () => {
    const myRequest = ++requestId;
    const items = itemsRef.current;
    const printPrecision = activePrecision();
    const recipe = buildEmbossRecipe(items, printPrecision);
    if (!recipe) {
      clearEmbossPreview();
      return;
    }
    let result;
    try {
      const { embossItem } = await import("../occClient.js");
      result = await embossItem({
        source: recipe.source,
        stamp: recipe.stamp,
        allItems: items,
        printPrecision,
      });
    } catch (e) {
      if (myRequest === requestId)
        useStore.getState().setToolError(e?.message || "Emboss failed.");
      return;
    }
    if (myRequest !== requestId || !result) return;
    useStore.getState().setToolError(null);
    // Stash for Confirm to reuse (see commitEmboss) — this is the exact result
    // the user is looking at.
    previewCache = {
      key: embossKey(recipe),
      geometryData: result.geometryData,
      centerOffset: result.centerOffset,
    };

    const { positions, indices } = result.geometryData;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(positions), 3),
    );
    if (indices)
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    geometry.computeVertexNormals();
    const { position, rotation } = chamferResultTransform(
      recipe.source,
      result.centerOffset,
    );

    ghostSource(recipe.item.id);
    removePreview();
    const group = new THREE.Group();
    const fill = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: DEFAULT_MESH_COLOR,
        roughness: 0.55,
        metalness: 0,
        transparent: true,
        opacity: 0.92,
      }),
    );
    fill.renderOrder = 990;
    group.add(fill);
    const lines = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: WIREFRAME_EDGE_COLOR,
        depthTest: false,
      }),
    );
    lines.renderOrder = 999;
    group.add(lines);
    group.position.set(position.x, position.y, position.z);
    group.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
    // The result geometry is built UNSCALED (buildItemShapeLocal doesn't apply
    // item.scale — the mesh does); the committed csg keeps the body's scale, so
    // the preview must too or a scaled body previews at its base size.
    const s = recipe.source?.scale?.x ?? 1;
    group.scale.setScalar(s);
    scene.add(group);
    previewGroup = group;
  };

  return { updateEmbossPreview, clearEmbossPreview };
}
