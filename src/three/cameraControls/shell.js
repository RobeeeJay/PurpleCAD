// Shell (hollow) commit.  Unlike chamfer/push-pull there's no face-pick phase:
// the whole selected body is hollowed to a wall of the dialog's thickness.
// Mirrors commitPushPull's structure — snapshot the live source, run the
// shellItem op, and modify the body into a `csg` item with a "shell" recipe so
// it rebuilds from its source on regen and chains into further ops.

import * as THREE from "three";
import { useStore } from "../../store";
import { MM_PER_UNIT } from "../sceneObjects.js";
import { activePrecision } from "../resolution.js";
import { withLivePolygons } from "../csgUtils.js";
import { chamferResultTransform } from "./chamferCommit.js";
import { DEFAULT_MESH_COLOR, WIREFRAME_EDGE_COLOR } from "../theme.js";

const GHOST_OPACITY = 0.12;

export async function commitShell({
  item,
  items,
  thicknessMm,
  printPrecision,
}) {
  const { shellItem } = await import("../occClient.js");
  const store = useStore.getState();
  const thickness = thicknessMm / MM_PER_UNIT;
  if (!(thickness > 0)) return false;

  // Freeze the live source (re-derives an extrude's polygon, etc.) so a sketch
  // edit before confirming is baked in and the recipe can rebuild later.
  const source = withLivePolygons({ ...item }, items, printPrecision);

  const result = await shellItem({
    source,
    thickness,
    allItems: items,
    printPrecision,
  });
  if (!result) return false;

  const { geometryData, centerOffset } = result;
  const { position, basePos } = chamferResultTransform(source, centerOffset);
  const patches = {
    type: "csg",
    position,
    regenerator: {
      kind: "shell",
      thickness,
      source,
      centerOffset,
      basePosition: basePos,
      regeneratedAt: printPrecision,
    },
    geometryData,
  };
  store.modifyItem(item.id, patches, "Shelled");
  return true;
}

// Live preview for the Shell dialog.  Mirrors createPushPullPreviewHelpers:
// ghost the source body and overlay the hollowed result.  A closed shell looks
// the same as the solid from outside, so the result is rendered translucent
// (double-sided, no depth write) — that lets the inner cavity wall read through,
// which is the whole point of the operation.
export function createShellPreviewHelpers({ scene, itemsRef, objectsRef }) {
  let previewGroup = null;
  let ghosted = null;
  let requestId = 0;

  const removePreview = () => {
    if (!previewGroup) return;
    scene.remove(previewGroup);
    previewGroup.traverse((obj) => {
      obj.geometry?.dispose();
      obj.material?.dispose();
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
    mesh.children.forEach((c) => {
      c.visible = false;
    });
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
    edges.forEach(({ child, visible }) => {
      child.visible = visible;
    });
    ghosted = null;
  };

  const clearShellPreview = () => {
    requestId++; // invalidate any in-flight request
    removePreview();
    unghostSource();
  };

  const runAndShow = async ({
    myRequest,
    source,
    thickness,
    items,
    printPrecision,
    ghostItemId,
  }) => {
    let result;
    try {
      const { shellItem } = await import("../occClient.js");
      result = await shellItem({
        source,
        thickness,
        allItems: items,
        printPrecision,
      });
    } catch {
      result = null;
    }
    // A newer request superseded this one, or the thickness was unworkable —
    // leave the current preview rather than flickering it away.
    if (myRequest !== requestId || !result) return;

    const { positions, normals, indices } = result.geometryData;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(positions), 3),
    );
    if (normals)
      geometry.setAttribute(
        "normal",
        new THREE.BufferAttribute(new Float32Array(normals), 3),
      );
    if (indices)
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    if (!normals) geometry.computeVertexNormals();

    const { position, rotation } = chamferResultTransform(
      source,
      result.centerOffset,
    );

    ghostSource(ghostItemId);
    removePreview();
    const group = new THREE.Group();

    const fill = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: DEFAULT_MESH_COLOR,
        roughness: 0.55,
        metalness: 0.0,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthWrite: false,
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

  // Recompute and swap in the preview for the typed thickness.  `regenerator`
  // (edit mode) supplies the frozen source; otherwise the live selected body is
  // snapshotted.  Safe to call per keystroke — stale async results are dropped.
  const updateShellPreview = async ({ itemId, regenerator, thicknessMm }) => {
    const myRequest = ++requestId;
    const thickness = thicknessMm / MM_PER_UNIT;
    if (!(thickness > 0)) {
      clearShellPreview();
      return;
    }
    const items = itemsRef.current;
    const printPrecision = activePrecision();
    let source;
    if (regenerator?.kind === "shell" && regenerator.source) {
      source = regenerator.source;
    } else {
      const item = items.find((i) => i.id === itemId);
      if (!item) {
        clearShellPreview();
        return;
      }
      source = withLivePolygons({ ...item }, items, printPrecision);
    }
    await runAndShow({
      myRequest,
      source,
      thickness,
      items,
      printPrecision,
      ghostItemId: itemId,
    });
  };

  return { updateShellPreview, clearShellPreview };
}
