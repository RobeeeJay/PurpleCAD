// Emboss tool commit + live preview.  Builds the stamp recipe from the selected
// sketch profiles + target face, stamps it onto the body (union for emboss, cut
// for deboss), and ghosts the result over the source body.  Mirrors hole.js.

import * as THREE from "three";
import { useStore } from "../../store";
import { activePrecision } from "../resolution.js";
import { withLivePolygons } from "../csgUtils.js";
import { buildEmbossStamp } from "../embossGeometry.js";
import { chamferResultTransform } from "./chamferCommit.js";
import { DEFAULT_MESH_COLOR, WIREFRAME_EDGE_COLOR } from "../theme.js";

const GHOST_OPACITY = 0.12;

// Source snapshot + baked stamp recipe for the active emboss tool, or null until
// at least one sketch profile and a face are picked.
export function buildEmbossRecipe(items, printPrecision) {
  const et = useStore.getState().embossTool;
  if (!et || !et.face || !et.profiles || et.profiles.length === 0) return null;
  const item = items.find((i) => i.id === et.itemId);
  if (!item) return null;
  // Editing replays the FROZEN pre-emboss source; a fresh emboss snapshots live.
  const source = et.source
    ? et.source
    : withLivePolygons({ ...item }, items, printPrecision);
  const stamp = buildEmbossStamp(
    et.profiles,
    et.face,
    et.params,
    items,
    printPrecision,
    et.faceSet,
  );
  if (!stamp) return null;
  return {
    item,
    source,
    stamp,
    profiles: et.profiles,
    face: et.face,
    faceSet: et.faceSet || null,
    params: { ...et.params },
  };
}

export async function commitEmboss({ items, printPrecision }) {
  const { embossItem } = await import("../occClient.js");
  const recipe = buildEmbossRecipe(items, printPrecision);
  if (!recipe) return false;
  const { item, source, stamp, profiles, face, faceSet, params } = recipe;
  let result;
  try {
    result = await embossItem({
      source,
      stamp,
      allItems: items,
      printPrecision,
    });
  } catch {
    result = null;
  }
  if (!result) return false;
  const { geometryData, centerOffset } = result;
  const { position } = chamferResultTransform(source, centerOffset);
  const store = useStore.getState();
  const editEntryId = store.embossTool?.editEntryId;
  store._cameraControls?.clearEmbossPreview?.();
  const regenerator = {
    kind: "emboss",
    source,
    profiles,
    face,
    faceSet,
    params,
    stamp,
    centerOffset,
    regeneratedAt: printPrecision,
  };
  if (editEntryId != null) {
    store.updateEmbossEntry(editEntryId, {
      regenerator,
      position,
      geometryData,
    });
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

  const clearEmbossPreview = () => {
    requestId++;
    removePreview();
    unghostSource();
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
    } catch {
      result = null;
    }
    if (myRequest !== requestId || !result) return;

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
