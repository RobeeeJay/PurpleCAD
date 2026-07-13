// Texture tool commit + live preview: displace the source body's mesh by a
// PNG heightfield on the picked face region.  Mirrors emboss.js — ghost the
// source, show the displaced result, commit a csg item whose geometryData IS
// the displaced mesh (no boolean; downstream consumers sew it on demand).

import * as THREE from "three";
import { useStore } from "../../store";
import { activePrecision } from "../resolution.js";
import { withLivePolygons } from "../csgUtils.js";
import { MM_PER_UNIT } from "../sceneObjects.js";
import { displaceMeshAsync } from "../textureWorkerClient.js";
import { decodeHeightfield } from "../textureImage.js";
import { chamferResultTransform } from "./chamferCommit.js";
import { releaseSolid } from "../solidCache.js";
import { DEFAULT_MESH_COLOR, WIREFRAME_EDGE_COLOR } from "../theme.js";

const GHOST_OPACITY = 0.12;

// Displacement params in scene units.  Like the emboss stamp, the mesh is
// built UNSCALED (the item's mesh.scale re-applies on top), so mm values are
// also divided by the source's uniform scale.
const sceneParams = (params, source) => {
  const s = source?.scale?.x ?? 1;
  const mm = (v) => v / MM_PER_UNIT / s;
  return {
    projection: params.projection,
    sizeU: Math.max(mm(params.sizeMm ?? 10), 1e-6),
    depth: mm(params.depthMm ?? 1),
    offsetU: mm(params.offsetHMm ?? 0),
    offsetV: mm(params.offsetVMm ?? 0),
    rotationRad: ((params.rotationDeg ?? 0) * Math.PI) / 180,
    wrap: !!params.wrap,
    resolution: Math.max(mm(params.resolutionMm ?? 1), 1e-4),
  };
};

// Base mesh to displace, in the source's LOCAL frame: the baked display mesh
// when it exists (display truth for csg results), else the rebuilt solid's
// tessellation.
async function baseMesh(source, items, printPrecision) {
  if (source.geometryData?.positions?.length >= 9) return source.geometryData;
  const { tessellateItem } = await import("../occClient.js");
  const res = await tessellateItem({
    source,
    allItems: items,
    printPrecision,
  });
  return res?.geometryData ?? null;
}

// Snapshot + displace for the CURRENT tool state; shared by preview and
// commit so both run the exact same recipe.  minResolutionMm floors the
// subdivision for the debounced preview.
export async function buildTextureResult(
  items,
  printPrecision,
  minResolutionMm,
) {
  const tt = useStore.getState().textureTool;
  if (!tt || !tt.face || !tt.facesValid || !tt.params.png) return null;
  const item = items.find((i) => i.id === tt.itemId);
  if (!item) return null;
  const source = withLivePolygons(
    tt.source ? { ...tt.source } : { ...item },
    items,
    printPrecision,
  );
  const mesh = await baseMesh(source, items, printPrecision);
  if (!mesh) return null;
  const heightfield = await decodeHeightfield(tt.params.png);
  const params = sceneParams(
    minResolutionMm
      ? {
          ...tt.params,
          resolutionMm: Math.max(tt.params.resolutionMm, minResolutionMm),
        }
      : tt.params,
    source,
  );
  // Off-thread in the app (worker) so the UI stays live; the busy counter is
  // owned by the callers (preview / commit) around this whole build.
  const displaced = await displaceMeshAsync({
    mesh,
    face: tt.face,
    faceSet: tt.faceSet,
    faceTris: tt.faceTris,
    heightfield,
    params,
  });
  if (!displaced) return null;

  // Bbox-centre the result (the csg convention every downstream path expects).
  const p = displaced.positions;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[i + k]);
      max[k] = Math.max(max[k], p[i + k]);
    }
  const centerOffset = {
    cx: (min[0] + max[0]) / 2,
    cy: (min[1] + max[1]) / 2,
    cz: (min[2] + max[2]) / 2,
  };
  for (let i = 0; i < p.length; i += 3) {
    p[i] -= centerOffset.cx;
    p[i + 1] -= centerOffset.cy;
    p[i + 2] -= centerOffset.cz;
  }
  return {
    item,
    source,
    geometryData: displaced,
    centerOffset,
    face: tt.face,
    faceSet: tt.faceSet,
    faceTris: tt.faceTris,
    faceCount: tt.faceCount ?? 0,
    params: { ...tt.params },
  };
}

export async function commitTexture({ items, printPrecision }) {
  // The busy indicator (with its Cancel button) attaches for the whole build;
  // Cancel bumps the epoch, kills the displacement worker, and the result —
  // even one that still lands — is discarded.
  const epoch = useStore.getState().cancelEpoch;
  useStore.getState().beginOperation();
  let result;
  try {
    result = await buildTextureResult(items, printPrecision, null);
  } catch (e) {
    if (useStore.getState().cancelEpoch === epoch)
      useStore.getState().setToolError(e?.message || "Texture failed.");
    return false;
  } finally {
    useStore.getState().endOperation();
  }
  if (!result || useStore.getState().cancelEpoch !== epoch) return false;
  const store = useStore.getState();
  const { item, source, geometryData, centerOffset } = result;
  const { position, basePos } = chamferResultTransform(source, centerOffset);
  const editEntryId = store.textureTool?.editEntryId;
  store._cameraControls?.clearTexturePreview?.();
  store._cameraControls?.clearEmbossSelectedFaces?.();
  const regenerator = {
    kind: "texture",
    source,
    face: result.face,
    faceSet: result.faceSet,
    faceTris: result.faceTris,
    faceCount: result.faceCount,
    params: result.params,
    centerOffset,
    basePosition: basePos,
    // Authored-frame record, same trap as emboss: the face/faceTris anchors
    // don't survive a relink that swaps the source kind (see shiftEmbossFrame).
    sourceCenterOffset: source?.regenerator?.centerOffset ?? {
      cx: 0,
      cy: 0,
      cz: 0,
    },
    regeneratedAt: printPrecision,
  };
  const patches = { type: "csg", position, regenerator, geometryData };
  if (editEntryId != null) {
    store.updateTextureEntry(editEntryId, patches);
    // Fresh committed geometry — the entry's old cached solid is stale.
    releaseSolid(editEntryId);
  } else {
    store.modifyItem(item.id, patches, "Texture");
  }
  store.cancelTextureTool();
  return true;
}

export function createTexturePreviewHelpers({ scene, itemsRef, objectsRef }) {
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

  const clearTexturePreview = () => {
    requestId++;
    removePreview();
    unghostSource();
    useStore.getState().setToolError(null);
  };

  const updateTexturePreview = async () => {
    const myRequest = ++requestId;
    const items = itemsRef.current;
    const printPrecision = activePrecision();
    const epoch = useStore.getState().cancelEpoch;
    let result;
    useStore.getState().beginOperation();
    try {
      // Floor the preview's subdivision at 0.5 mm so typing stays responsive;
      // Confirm runs the full requested resolution.
      result = await buildTextureResult(items, printPrecision, 0.5);
    } catch (e) {
      if (myRequest === requestId && useStore.getState().cancelEpoch === epoch)
        useStore.getState().setToolError(e?.message || "Texture failed.");
      return;
    } finally {
      useStore.getState().endOperation();
    }
    if (myRequest !== requestId) return;
    if (useStore.getState().cancelEpoch !== epoch) {
      removePreview();
      unghostSource();
      return;
    }
    if (!result) {
      removePreview();
      unghostSource();
      return;
    }
    useStore.getState().setToolError(null);

    const { positions, indices, normals } = result.geometryData;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(positions), 3),
    );
    if (indices)
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    if (normals)
      geometry.setAttribute(
        "normal",
        new THREE.BufferAttribute(new Float32Array(normals), 3),
      );
    else geometry.computeVertexNormals();
    const { position, rotation } = chamferResultTransform(
      result.source,
      result.centerOffset,
    );

    ghostSource(result.item.id);
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
        transparent: true,
        opacity: 0.25,
      }),
    );
    lines.renderOrder = 999;
    group.add(lines);
    group.position.set(position.x, position.y, position.z);
    group.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
    // Unscaled result mesh + the body's scale re-applied, same as emboss.
    const s = result.source?.scale?.x ?? 1;
    group.scale.setScalar(s);
    scene.add(group);
    previewGroup = group;
  };

  return { updateTexturePreview, clearTexturePreview };
}
