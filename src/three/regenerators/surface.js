// Surface regenerators: emboss and texture — the two mesh-dense ops that
// stamp or displace geometry over a body's faces.  Both carry authored-frame
// anchors that have to be shifted when a relink changes the source's frame
// (shiftEmbossFrame), and both can revive a developable wall fit.  Split out
// of regenerateItems.js.

import { withLivePolygons } from "../csgUtils.js";
import { embossItem } from "../occClient.js";
import { buildEmbossStamp } from "../embossGeometry.js";
import { MM_PER_UNIT } from "../sceneObjects.js";
import { resolveChainedPosition } from "./shared.js";

// Find the underlying extrude (through csg sources) whose profile is the wall's
// cross-section.
const wallExtrude = (item) => {
  let it = item;
  while (it && !it.profile?.polygon2D && it.regenerator?.source)
    it = it.regenerator.source;
  return it?.profile?.polygon2D ? it : null;
};

export function reviveDevelopable(faceSet, liveSource /*, frozenSource */) {
  const dev = faceSet?.developable;
  if (
    !dev ||
    !Array.isArray(dev.curve) ||
    !Array.isArray(dev.e1) ||
    !Array.isArray(dev.e2)
  )
    return faceSet;
  // REBUILD the wrap curve from the LIVE wall cross-section (its outer profile
  // in the developable's e1/e2 frame), so the relief follows the current size.
  // buildDevelopableConformMesh anchors the text at the curve point NEAREST the
  // face — not by index — so a freshly-sampled curve needs no alignment; the
  // text just re-centres on the resized wall.  norms are the radial-normalised
  // curve; arc is cumulative length (matching extractDevelopableProfile).
  const ext = wallExtrude(liveSource);
  const poly = ext?.profile?.polygon2D;
  if (!Array.isArray(poly) || poly.length < 3) return faceSet;
  const pc = ext.profile.profileCentroid || { x: 0, y: 0 };
  const [e1x, e1y] = dev.e1; // z-component is 0 for a profile-plane wall
  const [e2x, e2y] = dev.e2;
  const curve = poly.map((p) => {
    const x = p.x - pc.x,
      y = p.y - pc.y;
    return { u: x * e1x + y * e1y, v: x * e2x + y * e2y };
  });
  const norms = curve.map(({ u, v }) => {
    const r = Math.hypot(u, v) || 1;
    return { u: u / r, v: v / r };
  });
  const arc = [0];
  for (let i = 1; i < curve.length; i++)
    arc.push(
      arc[i - 1] +
        Math.hypot(curve[i].u - curve[i - 1].u, curve[i].v - curve[i - 1].v),
    );
  return { ...faceSet, developable: { ...dev, curve, arc, norms } };
}

// The emboss face/faceSet anchors are absolute coordinates in the frame the
// emboss was AUTHORED in.  A relink (reorder / delete of an upstream step) can
// swap the source kind — an extrude delivers its raw local frame, a csg is
// bbox-centred by its centerOffset — so translate the anchors by
// (authoredOffset - currentOffset) to express them in the CURRENT source's
// frame.  The wrap curve itself is centroid-relative (reviveDevelopable), so
// only the absolute pieces move: the face point, the developable's axial extent
// (aMin/aMax along the axis), and the cylinder/sphere fit centres.
export function shiftEmbossFrame(face, faceSet, regenerator, source) {
  const auth = regenerator.sourceCenterOffset;
  if (!auth) return { face, faceSet }; // legacy recipe — keep today's behaviour
  const cur = source?.regenerator?.centerOffset ?? { cx: 0, cy: 0, cz: 0 };
  const dx = auth.cx - cur.cx,
    dy = auth.cy - cur.cy,
    dz = auth.cz - cur.cz;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9 && Math.abs(dz) < 1e-9)
    return { face, faceSet };
  const shiftPt = (p) =>
    p && p.cx != null
      ? { ...p, cx: p.cx + dx, cy: p.cy + dy, cz: p.cz + dz }
      : p;
  const out = { face: shiftPt(face), faceSet };
  if (faceSet) {
    const fs = { ...faceSet };
    if (fs.developable) {
      const dev = fs.developable;
      const along = dev.axis
        ? dx * dev.axis[0] + dy * dev.axis[1] + dz * dev.axis[2]
        : 0;
      fs.developable = {
        ...dev,
        ...(Number.isFinite(dev.aMin) ? { aMin: dev.aMin + along } : null),
        ...(Number.isFinite(dev.aMax) ? { aMax: dev.aMax + along } : null),
      };
    }
    if (fs.cylinder) fs.cylinder = shiftPt(fs.cylinder);
    if (fs.sphere) fs.sphere = shiftPt(fs.sphere);
    out.faceSet = fs;
  }
  return out;
}

// Rebuild an emboss/deboss relief from its live source + sketch geometry.  The
// stamp is recomputed from the (possibly edited) sketch profiles each pass.
export async function regenerateEmboss(
  regenerator,
  accumulatedItems,
  printPrecision,
  currentPosition,
  solidOpts = null,
) {
  const liveItems = accumulatedItems.map((i) =>
    withLivePolygons(i, accumulatedItems, printPrecision),
  );
  const source = withLivePolygons(
    regenerator.source,
    liveItems,
    printPrecision,
  );
  // Express the authored anchors in the CURRENT source's frame (a relink may
  // have swapped the source kind — see shiftEmbossFrame).
  const { face: frameFace, faceSet: frameFaceSet } = shiftEmbossFrame(
    regenerator.face,
    regenerator.faceSet,
    regenerator,
    source,
  );
  // Re-derive the wrap curve from the live wall so the relief follows a resized
  // profile instead of wrapping the baked (old-radius) developable.
  const liveFaceSet = reviveDevelopable(
    frameFaceSet,
    source,
    regenerator.source,
  );
  const stamp =
    buildEmbossStamp(
      regenerator.profiles,
      frameFace,
      regenerator.params,
      liveItems,
      printPrecision,
      liveFaceSet,
      source?.scale?.x ?? 1,
    ) || regenerator.stamp;
  let result;
  try {
    result = await embossItem({
      source,
      stamp,
      allItems: liveItems,
      printPrecision,
      ...(solidOpts || {}),
    });
  } catch (err) {
    console.warn(`Emboss regen failed (${err.message}); keeping geometry.`);
    return null;
  }
  if (!result) return null;
  const { position, base: basePosition } = resolveChainedPosition(
    source,
    result.centerOffset,
    currentPosition,
    regenerator.basePosition,
  );
  return {
    position,
    basePosition,
    geometryData: result.geometryData,
    centerOffset: result.centerOffset,
    shapeId: result.shapeId,
    stamp,
  };
}

// Rebuild a texture (bump-map displacement) from its live source: base mesh →
// displace by the stored heightfield params → bbox-centred result.  Pure JS
// displacement (textureDisplace.js); only the base tessellation touches OCC.
export async function regenerateTexture(
  regenerator,
  accumulatedItems,
  printPrecision,
  currentPosition,
) {
  const { displaceMeshAsync } = await import("../textureWorkerClient.js");
  const { assertTriBudget } = await import("../textureDisplace.js");
  const { decodeHeightfield } = await import("../textureImage.js");
  const liveItems = accumulatedItems.map((i) =>
    withLivePolygons(i, accumulatedItems, printPrecision),
  );
  const source = withLivePolygons(
    regenerator.source,
    liveItems,
    printPrecision,
  );
  const { face: frameFace, faceSet: frameFaceSet } = shiftEmbossFrame(
    regenerator.face,
    regenerator.faceSet,
    regenerator,
    source,
  );
  let result = null;
  try {
    let mesh = source.geometryData;
    if (!mesh?.positions?.length) {
      const { tessellateItem } = await import("../occClient.js");
      const tess = await tessellateItem({
        source,
        allItems: liveItems,
        printPrecision,
      });
      mesh = tess?.geometryData;
    }
    const heightfield = await decodeHeightfield(regenerator.params.png);
    if (mesh && heightfield) {
      const p = regenerator.params;
      const sc = source?.scale?.x ?? 1;
      const mm = (v) => v / MM_PER_UNIT / sc;
      assertTriBudget(
        regenerator.faceTris,
        frameFaceSet,
        source.dimensions,
        Math.max(mm(p.resolutionMm ?? 1), 1e-4),
        p.resolutionMm,
      );
      result = await displaceMeshAsync({
        mesh,
        face: frameFace,
        faceSet: frameFaceSet,
        faceTris: regenerator.faceTris,
        heightfield,
        params: {
          projection: p.projection,
          sizeU: Math.max(mm(p.sizeMm ?? 10), 1e-6),
          depth: mm(p.depthMm ?? 1),
          offsetU: mm(p.offsetHMm ?? 0),
          offsetV: mm(p.offsetVMm ?? 0),
          rotationRad: ((p.rotationDeg ?? 0) * Math.PI) / 180,
          wrap: !!p.wrap,
          resolution: Math.max(mm(p.resolutionMm ?? 1), 1e-4),
        },
      });
    }
  } catch (err) {
    console.warn(`Texture regen failed (${err.message}); keeping geometry.`);
    return null;
  }
  if (!result) return null;
  // Bbox-centre (the csg convention) and re-anchor like every chained op.
  const pos = result.positions;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[i + k]);
      max[k] = Math.max(max[k], pos[i + k]);
    }
  const centerOffset = {
    cx: (min[0] + max[0]) / 2,
    cy: (min[1] + max[1]) / 2,
    cz: (min[2] + max[2]) / 2,
  };
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] -= centerOffset.cx;
    pos[i + 1] -= centerOffset.cy;
    pos[i + 2] -= centerOffset.cz;
  }
  const { position, base: basePosition } = resolveChainedPosition(
    source,
    centerOffset,
    currentPosition,
    regenerator.basePosition,
  );
  return { position, basePosition, geometryData: result, centerOffset };
}
