import * as THREE from "three";
import { buildItemGeometry, buildBrushTransform, performCsg } from "./csgUtils.js";
import { applyBevelToSubGeometry } from "./bevelUtils.js";

// Items that came from CSG / bevel operations store a `regenerator` field
// describing how to re-run the operation.  This lets us recompute their
// geometry whenever the user toggles the resolution setting — so primitives
// (sphere / cylinder / torus) baked into a boolean or bevel at preview
// resolution can be refreshed to print quality and back without redoing the
// edit.
//
// Shape of the regenerator field:
//   • Boolean op:  { kind: "boolean", op: "union"|..., inputIds: [a, b, …] }
//   • Bevel:       { kind: "bevel",   source: {...preBevelItem},
//                    subGeo, amount, segments }
//
// We also stamp `regeneratedAt` (a value matching printPrecision) on the
// regenerator so we can skip work when the setting hasn't actually changed.

// Bevel result → centred geometryData + world position, mirroring
// BevelSection.jsx so a regenerated bevel produces an identical item.
function regenerateBevel(regenerator, printPrecision) {
  const sourceGeo = buildItemGeometry(regenerator.source, { printPrecision });
  if (!sourceGeo) return null;
  const result = applyBevelToSubGeometry(
    sourceGeo,
    regenerator.subGeo,
    regenerator.amount,
    regenerator.segments,
  );
  if (!result) return null;
  const posAttr = result.getAttribute("position");
  const normAttr = result.getAttribute("normal");
  const idxAttr = result.index;

  const bbox = new THREE.Box3().setFromBufferAttribute(posAttr);
  const localCentre = new THREE.Vector3();
  bbox.getCenter(localCentre);
  for (let i = 0; i < posAttr.count; i++) {
    posAttr.setXYZ(
      i,
      posAttr.getX(i) - localCentre.x,
      posAttr.getY(i) - localCentre.y,
      posAttr.getZ(i) - localCentre.z,
    );
  }
  posAttr.needsUpdate = true;

  const brushPos = buildBrushTransform(regenerator.source).position;
  const rot = regenerator.source.rotation || { x: 0, y: 0, z: 0 };
  localCentre.applyEuler(new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0));

  return {
    position: {
      x: brushPos.x + localCentre.x,
      y: brushPos.y + localCentre.y,
      z: brushPos.z + localCentre.z,
    },
    geometryData: {
      positions: Array.from(posAttr.array),
      normals: normAttr ? Array.from(normAttr.array) : null,
      indices: idxAttr ? Array.from(idxAttr.array) : null,
    },
  };
}

function regenerateBoolean(regenerator, accumulatedItems, printPrecision) {
  // Inputs are looked up in the ALREADY-regenerated `accumulatedItems`, so a
  // boolean of two CSG inputs picks up their refreshed geometry too.
  const inputs = regenerator.inputIds
    .map((id) => accumulatedItems.find((i) => i.id === id))
    .filter(Boolean);
  if (inputs.length < 2) return null;
  return performCsg(inputs, regenerator.op, { printPrecision });
}

// Walks items in order (which is dependency-safe because new items reference
// only earlier ids in this codebase), regenerating any with a `regenerator`
// at the requested precision.  Items without a regenerator pass through
// untouched.  An item whose `regenerator.regeneratedAt === printPrecision` is
// skipped — its cached geometryData is already current.
//
// Returns the new items array (a fresh top-level reference if anything
// changed, the original array if nothing did).
export function regenerateItemsForResolution(items, printPrecision) {
  if (!items || items.length === 0) return items;
  const out = [];
  let changed = false;
  for (const item of items) {
    const r = item.regenerator;
    if (!r) {
      out.push(item);
      continue;
    }
    if (r.regeneratedAt === printPrecision && item.geometryData) {
      // Cache hit — geometry is already at the right resolution.
      out.push(item);
      continue;
    }
    let result = null;
    if (r.kind === "bevel") {
      result = regenerateBevel(r, printPrecision);
    } else if (r.kind === "boolean") {
      result = regenerateBoolean(r, out, printPrecision);
    }
    if (!result) {
      out.push(item);
      continue;
    }
    changed = true;
    out.push({
      ...item,
      position: result.position,
      geometryData: result.geometryData,
      regenerator: { ...r, regeneratedAt: printPrecision },
    });
  }
  return changed ? out : items;
}
