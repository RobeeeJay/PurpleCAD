// Convert to Surfaces: commit and live preview.  A mesh body is rebuilt as
// exact faces -- each region recognised as a plane, cylinder, cone, sphere,
// torus or oval wall becomes one face on it, the rest stay triangles
// (docs/exact-imports-plan.md).  The body keeps its place (the result is in
// its own frame) and becomes a `csg` with a "meshToSurfaces" recipe, whose
// BREP later ops build from; a timeline Edit re-runs it on the same source.
// The preview only RECOGNISES (fast), colouring each region by what it was
// found to be; Confirm runs the rebuild, which can refuse, and then the body
// stays the mesh it was.

import * as THREE from "three";
import { useStore } from "../../store";
import { buildBrushTransform } from "../csgUtils.js";
import { convertSource } from "../regenerators/modify.js";
import { pruneNestedSourceGeometry } from "../textureDisplace.js";
import { MM_PER_UNIT } from "../sceneObjects.js";
import { createGhost } from "./ghostSource.js";

// A body whose shape is only its mesh: an import, or a simplified one.
// Everything modelled in PurpleCAD (and an imported STEP body) already has
// exact faces.
export const canConvert = (item) =>
  item?.type === "csg" &&
  (!item.regenerator || item.regenerator.kind === "simplify") &&
  item.geometryData?.positions?.length >= 9;

// What each kind of surface is drawn as in the preview.
export const SURFACE_COLORS = {
  plane: 0x8fb3d9,
  cylinder: 0x6c3fd4,
  cone: 0xd98f3f,
  sphere: 0x3fae7a,
  torus: 0xd94f7a,
  ellipticCylinder: 0xc9b23a,
  mesh: 0x9a9a9a,
};

// The last recognition, so the preview doesn't re-run it for the same mesh
// and tolerance.  Keyed on the source mesh itself.
let last = null;
async function recognise(source, toleranceMm) {
  if (last && last.geometry === source.geometryData && last.tol === toleranceMm)
    return last.result;
  const { recognizeSurfaces } = await import("../occClient.js");
  const g = source.geometryData;
  const result = await recognizeSurfaces({
    positions: g.positions,
    indices: g.indices,
    tolerance: toleranceMm / MM_PER_UNIT,
  });
  if (result) last = { geometry: g, tol: toleranceMm, result };
  return result;
}

// A cancelled op (a newer preview superseded it) is not a failure to report.
const reason = (err) =>
  /cancel/i.test(err?.message ?? "")
    ? null
    : `Kept as a mesh: ${String(err.message).replace(/^rebuildSurfaces: /, "")}`;

export async function commitConvert({ item, params, printPrecision }) {
  const { withCommitGuard } = await import("../occClient.js");
  const store = useStore.getState();
  const source = { ...item };
  let result;
  try {
    result = await withCommitGuard(() =>
      convertSource(source, params, printPrecision),
    );
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
        kind: "meshToSurfaces",
        toleranceMm: params.toleranceMm,
        stats: result.stats,
        brep: result.brep,
        // The source's own mesh is the rebuild base; anything nested deeper is
        // dead weight in every later step's snapshot.
        source: pruneNestedSourceGeometry(source),
        basePosition: buildBrushTransform(source).position,
        regeneratedAt: printPrecision,
      },
    },
    "Converted to surfaces",
  );
  return true;
}

// Live preview: ghost the body and draw its triangles coloured by the kind of
// surface their region was recognised as.  Resolves to the recognition's
// counts ({ regions, counts, triangleCounts, triangles }), or null.
export function createConvertPreviewHelpers({ scene, itemsRef, objectsRef }) {
  let previewMesh = null;
  let requestId = 0;
  const { ghost, unghost } = createGhost(objectsRef);

  const removePreview = () => {
    if (!previewMesh) return;
    scene.remove(previewMesh);
    previewMesh.geometry.dispose();
    previewMesh.material.dispose();
    previewMesh = null;
  };

  const clearConvertPreview = () => {
    requestId++;
    removePreview();
    unghost();
  };

  const updateConvertPreview = async ({ itemId, regenerator, params }) => {
    const myRequest = ++requestId;
    const source =
      regenerator?.kind === "meshToSurfaces"
        ? regenerator.source
        : itemsRef.current.find((i) => i.id === itemId);
    if (!canConvert(source)) {
      clearConvertPreview();
      return null;
    }
    let result;
    try {
      result = await recognise(source, params.toleranceMm);
    } catch (err) {
      if (myRequest === requestId) {
        const msg = /cancel/i.test(err?.message ?? "") ? null : err.message;
        if (msg) {
          removePreview();
          useStore.getState().setToolError(msg);
        }
      }
      return null;
    }
    if (myRequest !== requestId || !result) return null;
    useStore.getState().setToolError(null);

    // One colour per triangle, so the triangles are drawn unshared.
    const { positions, indices } = source.geometryData;
    const T = result.triangleRegion.length;
    const pos = new Float32Array(T * 9);
    const col = new Float32Array(T * 9);
    const c = new THREE.Color();
    for (let t = 0; t < T; t++) {
      c.setHex(SURFACE_COLORS[result.regions[result.triangleRegion[t]].type]);
      for (let k = 0; k < 3; k++) {
        const v = indices?.length ? indices[3 * t + k] : 3 * t + k;
        pos.set(positions.slice(3 * v, 3 * v + 3), 9 * t + 3 * k);
        col.set([c.r, c.g, c.b], 9 * t + 3 * k);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geometry.computeVertexNormals();

    const shown = objectsRef.current[itemId];
    ghost(itemId);
    removePreview();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.6,
        metalness: 0,
        flatShading: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    mesh.renderOrder = 990;
    // The source mesh is in the body's own frame: place it as the body is.
    if (shown) {
      shown.updateMatrixWorld();
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(shown.matrixWorld);
    }
    scene.add(mesh);
    previewMesh = mesh;
    return result;
  };

  return { updateConvertPreview, clearConvertPreview };
}
