// Hole tool commit + live preview.  Once a face and point are picked, the
// dialog drives the length / diameter / metric thread / tolerance; this turns
// the picked face+point (in the target's local frame) into a hole recipe, cuts
// it, and ghosts the result over the source body.  Mirrors shell.js.

import * as THREE from "three";
import { useStore } from "../../store";
import { activePrecision } from "../resolution.js";
import { withLivePolygons } from "../csgUtils.js";
import { chamferResultTransform } from "./chamferCommit.js";
import { DEFAULT_MESH_COLOR, WIREFRAME_EDGE_COLOR } from "../theme.js";
import { releaseSolid } from "../solidCache.js";

const GHOST_OPACITY = 0.12;

// Source snapshot + hole recipe (local frame, mm sizes) for the active hole
// tool, or null until both a face and point are picked.
export function buildHoleRecipe(items, printPrecision) {
  const ht = useStore.getState().holeTool;
  if (!ht || !ht.face || !ht.point) return null;
  const item = items.find((i) => i.id === ht.itemId);
  if (!item) return null;
  // Editing replays the FROZEN pre-hole source so changing params re-cuts the
  // original body; a fresh hole snapshots the live item.
  const source = ht.source
    ? ht.source
    : withLivePolygons({ ...item }, items, printPrecision);
  const n = ht.face.normal,
    fp = ht.face.point,
    cp = ht.point;
  // Project the chosen point onto the face plane → the hole entry; the axis runs
  // into the part along -normal.
  const dot = (cp.x - fp.x) * n.x + (cp.y - fp.y) * n.y + (cp.z - fp.z) * n.z;
  const entry = {
    x: cp.x - dot * n.x,
    y: cp.y - dot * n.y,
    z: cp.z - dot * n.z,
  };
  const p = ht.params;
  const hole = {
    point: entry,
    dir: { x: -n.x, y: -n.y, z: -n.z },
    length: p.lengthMm,
    diameter: p.diameterMm,
    pitch: p.threaded ? p.pitchMm : 0,
    tolerance: p.toleranceMm,
    threaded: !!p.threaded,
    threadType: p.threadType,
  };
  return { item, source, hole };
}

export async function commitHole({ items, printPrecision }) {
  const { holeItem } = await import("../occClient.js");
  const recipe = buildHoleRecipe(items, printPrecision);
  if (!recipe) return false;
  const { item, source, hole } = recipe;
  let result;
  try {
    result = await holeItem({ source, hole, allItems: items, printPrecision });
  } catch {
    result = null;
  }
  if (!result) return false;
  const { geometryData, centerOffset } = result;
  const { position, basePos } = chamferResultTransform(source, centerOffset);
  const store = useStore.getState();
  const editEntryId = store.holeTool?.editEntryId;
  store._cameraControls?.clearHolePreview?.();
  if (editEntryId != null) {
    // Editing a committed hole: update the existing step in place.
    store.updateHoleEntry(editEntryId, {
      hole,
      position,
      centerOffset,
      basePosition: basePos,
      geometryData,
      regeneratedAt: printPrecision,
    });
    // Fresh committed geometry stays (no recompute) — drop the stale cached solid.
    releaseSolid(editEntryId);
  } else {
    store.modifyItem(
      item.id,
      {
        type: "csg",
        position,
        regenerator: {
          kind: "hole",
          hole,
          source,
          centerOffset,
          basePosition: basePos,
          regeneratedAt: printPrecision,
        },
        geometryData,
      },
      "Hole",
    );
  }
  store.cancelHoleTool();
  return true;
}

export function createHolePreviewHelpers({ scene, itemsRef, objectsRef }) {
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

  const clearHolePreview = () => {
    requestId++;
    removePreview();
    unghostSource();
  };

  const updateHolePreview = async () => {
    const myRequest = ++requestId;
    const items = itemsRef.current;
    const printPrecision = activePrecision();
    const recipe = buildHoleRecipe(items, printPrecision);
    if (!recipe) {
      clearHolePreview();
      return;
    }
    let result;
    try {
      const { holeItem } = await import("../occClient.js");
      result = await holeItem({
        source: recipe.source,
        hole: recipe.hole,
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
    scene.add(group);
    previewGroup = group;
  };

  return { updateHolePreview, clearHolePreview };
}
