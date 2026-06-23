// Draft tool commit + live preview.  Tapers the selected faces about the neutral
// (main) face's plane, ghosting the result over the source body.  Mirrors hole.js
// / emboss.js.

import * as THREE from "three";
import { useStore } from "../../store";
import { activePrecision } from "../resolution.js";
import { withLivePolygons } from "../csgUtils.js";
import { chamferResultTransform } from "./chamferCommit.js";
import { DEFAULT_MESH_COLOR, WIREFRAME_EDGE_COLOR } from "../theme.js";

const GHOST_OPACITY = 0.12;

// Source snapshot + draft params for the active draft tool, or null until a
// neutral face and at least one face to taper are picked.
export function buildDraftRecipe(items, printPrecision) {
  const dt = useStore.getState().draftTool;
  if (!dt || !dt.neutral || !dt.faces || dt.faces.length === 0) return null;
  const item = items.find((i) => i.id === dt.itemId);
  if (!item) return null;
  const source = dt.source
    ? dt.source
    : withLivePolygons({ ...item }, items, printPrecision);
  return {
    item,
    source,
    neutral: dt.neutral,
    faces: dt.faces,
    angleDeg: dt.angleDeg,
    flip: !!dt.flip,
  };
}

export async function commitDraft({ items, printPrecision }) {
  const { draftItem } = await import("../occClient.js");
  const recipe = buildDraftRecipe(items, printPrecision);
  if (!recipe) return false;
  const { item, source, neutral, faces, angleDeg, flip } = recipe;
  let result;
  try {
    result = await draftItem({
      source,
      neutral,
      faces,
      angleDeg,
      flip,
      allItems: items,
      printPrecision,
    });
  } catch (e) {
    useStore.getState().setToolError(e?.message || "Draft failed.");
    return false;
  }
  if (!result) return false;
  const { geometryData, centerOffset } = result;
  const { position } = chamferResultTransform(source, centerOffset);
  const store = useStore.getState();
  const editEntryId = store.draftTool?.editEntryId;
  store._cameraControls?.clearDraftPreview?.();
  const regenerator = {
    kind: "draft",
    source,
    neutral,
    faces,
    angleDeg,
    flip,
    centerOffset,
    regeneratedAt: printPrecision,
  };
  if (editEntryId != null) {
    store.updateDraftEntry(editEntryId, {
      regenerator,
      position,
      geometryData,
    });
  } else {
    store.modifyItem(
      item.id,
      { type: "csg", position, regenerator, geometryData },
      "Draft",
    );
  }
  store.cancelDraftTool();
  return true;
}

export function createDraftPreviewHelpers({ scene, itemsRef, objectsRef }) {
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
    ghosted = null;
  };

  const clearDraftPreview = () => {
    requestId++;
    removePreview();
    unghostSource();
    useStore.getState().setToolError(null);
  };

  const updateDraftPreview = async () => {
    const myRequest = ++requestId;
    const items = itemsRef.current;
    const printPrecision = activePrecision();
    const recipe = buildDraftRecipe(items, printPrecision);
    if (!recipe) {
      clearDraftPreview();
      return;
    }
    let result;
    try {
      const { draftItem } = await import("../occClient.js");
      result = await draftItem({
        source: recipe.source,
        neutral: recipe.neutral,
        faces: recipe.faces,
        angleDeg: recipe.angleDeg,
        flip: recipe.flip,
        allItems: items,
        printPrecision,
      });
    } catch (e) {
      if (myRequest === requestId)
        useStore.getState().setToolError(e?.message || "Draft failed.");
      return;
    }
    if (myRequest !== requestId || !result) return;
    useStore.getState().setToolError(null);

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
    const s = recipe.source?.scale?.x ?? 1;
    group.scale.setScalar(s);
    scene.add(group);
    previewGroup = group;
  };

  return { updateDraftPreview, clearDraftPreview };
}
