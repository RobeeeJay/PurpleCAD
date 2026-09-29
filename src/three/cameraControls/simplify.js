// Simplify commit and live preview.  Simplify replaces a mesh body's triangles
// with fewer, held to a measured deviation or cut to a count, natively
// (occClient.simplifyMesh).  The body keeps its place -- the simplified mesh is
// in its own local frame -- and becomes a `csg` with a "simplify" recipe, so a
// timeline Edit re-runs it on the same source.

import * as THREE from "three";
import { useStore } from "../../store";
import { buildBrushTransform } from "../csgUtils.js";
import { simplifySource } from "../regenerators/modify.js";
import { pruneNestedSourceGeometry } from "../textureDisplace.js";
import { DEFAULT_MESH_COLOR, WIREFRAME_EDGE_COLOR } from "../theme.js";
import { createGhost } from "./ghostSource.js";

// Only a body whose shape IS its mesh can be simplified: an import, the pieces
// of a split, or any OCC result.  Primitives and extrudes are rebuilt from
// their recipe and have no mesh to reduce.
export const canSimplify = (item) =>
  item?.type === "csg" && item.geometryData?.positions?.length >= 9;

// The last result, so Confirm takes the preview's run instead of measuring
// for another second.  Keyed on the source mesh itself and the parameters.
let last = null;
async function simplifyCached(source, params) {
  const key = `${params.mode}:${params.toleranceMm}:${params.targetTriangles}`;
  if (last && last.geometry === source.geometryData && last.key === key)
    return last.result;
  const result = await simplifySource(source, params);
  if (result) last = { geometry: source.geometryData, key, result };
  return result;
}

// A cancelled op (a newer preview superseded it) is not a failure to report.
const reason = (err) =>
  /cancel/i.test(err?.message ?? "") ? null : `Simplify failed: ${err.message}`;

export async function commitSimplify({ item, params, printPrecision }) {
  const { withCommitGuard } = await import("../occClient.js");
  const store = useStore.getState();
  const source = { ...item };
  let result;
  try {
    result = await withCommitGuard(() => simplifyCached(source, params));
  } catch (err) {
    store.setToolError(reason(err));
    return false;
  }
  if (!result) return false;
  store.modifyItem(
    item.id,
    {
      type: "csg",
      geometryData: result.geometryData,
      regenerator: {
        kind: "simplify",
        mode: params.mode,
        toleranceMm: params.toleranceMm,
        targetTriangles: params.targetTriangles,
        stats: result.stats,
        // The source's own mesh is the rebuild base; anything nested deeper is
        // dead weight in every later step's snapshot.
        source: pruneNestedSourceGeometry(source),
        basePosition: buildBrushTransform(source).position,
        regeneratedAt: printPrecision,
      },
    },
    "Simplified",
  );
  return true;
}

// Live preview: ghost the body and draw the simplified mesh over it as a
// wireframe, so what changed -- how many triangles, and where -- is visible.
export function createSimplifyPreviewHelpers({ scene, itemsRef, objectsRef }) {
  let previewGroup = null;
  let requestId = 0;
  const { ghost, unghost } = createGhost(objectsRef);

  const removePreview = () => {
    if (!previewGroup) return;
    scene.remove(previewGroup);
    previewGroup.traverse((obj) => {
      obj.geometry?.dispose();
      obj.material?.dispose();
    });
    previewGroup = null;
  };

  const clearSimplifyPreview = () => {
    requestId++;
    removePreview();
    unghost();
  };

  // Resolves to the result's stats, or null when superseded or failed (the
  // failure goes to the tool error line).  `regenerator` (edit mode) supplies
  // the frozen source; otherwise the live body is the source.
  const updateSimplifyPreview = async ({ itemId, regenerator, params }) => {
    const myRequest = ++requestId;
    const source =
      regenerator?.kind === "simplify"
        ? regenerator.source
        : itemsRef.current.find((i) => i.id === itemId);
    if (!canSimplify(source)) {
      clearSimplifyPreview();
      return null;
    }
    let result;
    try {
      result = await simplifyCached(source, params);
    } catch (err) {
      if (myRequest === requestId) {
        const msg = reason(err);
        if (msg) {
          removePreview();
          useStore.getState().setToolError(msg);
        }
      }
      return null;
    }
    if (myRequest !== requestId || !result) return null;
    useStore.getState().setToolError(null);

    const { positions, indices } = result.geometryData;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(positions), 3),
    );
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    geometry.computeVertexNormals();

    const shown = objectsRef.current[itemId];
    ghost(itemId);
    removePreview();
    const group = new THREE.Group();
    const fill = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: DEFAULT_MESH_COLOR,
        roughness: 0.55,
        metalness: 0.0,
        transparent: true,
        opacity: 0.45,
        flatShading: true,
        depthWrite: false,
      }),
    );
    fill.renderOrder = 990;
    group.add(fill);
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: WIREFRAME_EDGE_COLOR,
        transparent: true,
        opacity: 0.6,
      }),
    );
    wire.renderOrder = 999;
    group.add(wire);
    // The result is in the body's own frame: place it exactly as the body is.
    if (shown) {
      shown.updateMatrixWorld();
      group.matrixAutoUpdate = false;
      group.matrix.copy(shown.matrixWorld);
    }
    scene.add(group);
    previewGroup = group;
    return result.stats;
  };

  return { updateSimplifyPreview, clearSimplifyPreview };
}
