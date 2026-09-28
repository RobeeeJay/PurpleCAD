// The async CSG runners for cut / boss extrudes.  Split out of extrude.js so
// that file stays focused on the hover/click/depth pipeline.  Both run through
// the same performCsg flow as the Combine toolbar (occClient → OCC worker) and
// replace their inputs with a single CSG item.

import { useStore } from "../../store";
import { activePrecision } from "../resolution.js";
import { hostFaceExtentAlongNormal } from "../csgUtils.js";
import { openMeshNotice } from "../importWeld.js";

// Once a cut or fuse is committed, warn if a body it went into was an open
// mesh: the result may have holes where that surface was open.
async function warnIfOpen(bodies) {
  const notice = await openMeshNotice(bodies);
  if (notice) useStore.getState().showNotification(notice);
}

// Determine the solids a cut-extrusion subtracts from.  In priority order:
//   1. sourceItemId from the extrude profile (face-profile path — the user
//      clicked a solid face directly).
//   2. The sketch's hostSolidId (recorded when the sketch was placed on a
//      solid's face).  Without this, cuts on a sketch-loop fall back to every
//      visible solid in the scene, which silently turns unrelated primitives
//      into CSG items.
//   3. Every visible non-sketch non-extrude item (last resort for sketches
//      placed on an axis plane with no specific host).
// A HIDDEN solid is never a cut target — the user hid it deliberately, so it
// must not silently turn into a CSG result and reappear.  This applies to the
// explicit source/host too, not just the scan.
function resolveCutTargets(items, profile, sourceItemId, excludeIds = []) {
  const cuttable = (i) => i && i.type !== "sketch" && i.visible !== false;
  if (sourceItemId != null) {
    const src = items.find((i) => i.id === sourceItemId);
    return cuttable(src) ? [src] : [];
  }
  const sketchId = profile?.sketchId ?? null;
  const sketch = sketchId != null ? items.find((i) => i.id === sketchId) : null;
  const hostId = sketch?.hostSolidId ?? null;
  if (hostId != null) {
    const host = items.find((i) => i.id === hostId);
    return cuttable(host) ? [host] : [];
  }
  return items.filter(
    (i) => cuttable(i) && i.type !== "extrude" && !excludeIds.includes(i.id),
  );
}

// Run a cut-extrusion: subtract the new extrude shape from the target solid
// (or every visible solid when no source was captured), then hide both the
// original target(s) and the new extrude so only the boolean result remains.
export async function runCutExtrusion(extrudeItemId, sourceItemId) {
  try {
    const { performCsg } = await import("../occClient.js");
    const freshStore = useStore.getState();
    const items = freshStore.items;
    const extrude = items.find((i) => i.id === extrudeItemId);
    if (!extrude) return;
    const targets = resolveCutTargets(items, extrude?.profile, sourceItemId, [
      extrudeItemId,
    ]);
    if (targets.length === 0) {
      // Nothing to cut from — fold the standalone extrude away.  consumeItems
      // bakes `visible: false` into its CREATE entry so a replay won't
      // resurrect it.
      useStore.getState().consumeItems([extrudeItemId]);
      return;
    }
    // Run one difference per target.  Each call produces a single CSG item that
    // replaces the target.
    for (const target of targets) {
      const result = await performCsg({
        selectedItems: [target, extrude],
        operation: "difference",
        printPrecision: activePrecision(freshStore),
        allItems: items,
      });
      if (!result) continue;
      let maxId = 0;
      useStore.getState().history.forEach((e) => {
        if (e.instruction?.type === "create" && e.instruction.item.id > maxId)
          maxId = e.instruction.item.id;
      });
      const id = maxId + 1;
      useStore.getState().addItem({
        id,
        name: `Cut ${id}`,
        type: "csg",
        children: [],
        position: result.position,
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        geometryData: result.geometryData,
        // A cut replaces the target, so inherit the target's material.
        ...(target.material && { material: target.material }),
        regenerator: {
          kind: "boolean",
          op: "difference",
          inputIds: [target.id, extrudeItemId],
          originalCenter: result.position,
          regeneratedAt: activePrecision(freshStore),
        },
      });
    }
    // Fold the source solids and the standalone extrude into the new CSG cuts.
    useStore
      .getState()
      .consumeItems([extrudeItemId, ...targets.map((t) => t.id)]);
    await warnIfOpen(targets);
  } catch (err) {
    console.error("Cut extrusion failed:", err);
    useStore
      .getState()
      .showNotification(`The cut couldn't be made: ${err.message}`);
  }
}

// Subtract a whole multi-area cut in ONE timeline entry.  Unlike
// runCutExtrusion the prisms are NOT created as store items — their recipes
// (`extrudeDefs`) are embedded in the result's `extrudeCut` regenerator, so N
// holes are one "Cut" step.  Running them as ONE difference also fixes the
// result: N concurrent runCutExtrusion calls each read the store and each
// subtract a single prism from the SAME original target, so the last write won
// and only one hole survived (as N overlapping bodies).  `cutId` is
// pre-allocated by the caller.
export async function runCutExtrudes(extrudeDefs, sourceItemId, cutId) {
  try {
    const { performCsg } = await import("../occClient.js");
    const store = useStore.getState();
    const items = store.items;
    if (!extrudeDefs.length) return;
    const targets = resolveCutTargets(
      items,
      extrudeDefs[0]?.profile,
      sourceItemId,
    );
    if (targets.length === 0) return;
    const precision = activePrecision(store);
    // Record how far the cut's start sits BELOW the host's face along the cut
    // normal (0 when it starts exactly at that face).  regenerateExtrudeUnion
    // re-anchors the cut to the host's live face + this inset each regen, so a
    // variable that resizes the body keeps the cut on the face it was started
    // from.  Measured against the pre-cut target.
    const ref = extrudeDefs.find((d) => (d.startOffset || 0) !== 0)?.profile;
    let id = cutId;
    for (const target of targets) {
      const cutStartInset =
        ref?.normalWorld && ref.position
          ? (() => {
              const top = hostFaceExtentAlongNormal(
                [target],
                ref.normalWorld,
                ref.position,
              );
              return top == null
                ? 0
                : (extrudeDefs.find((d) => (d.startOffset || 0) !== 0)
                    ?.startOffset || 0) - top;
            })()
          : 0;
      // One difference with every prism as a tool — BooleanOp takes the first
      // input as the argument and the rest as tools.
      const result = await performCsg({
        selectedItems: [target, ...extrudeDefs],
        operation: "difference",
        printPrecision: precision,
        allItems: items,
      });
      if (!result) continue;
      useStore.getState().addItem({
        id,
        name: `Cut ${id}`,
        type: "csg",
        children: [],
        position: result.position,
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        geometryData: result.geometryData,
        // A cut replaces the target, so inherit the target's material.
        ...(target.material && { material: target.material }),
        regenerator: {
          kind: "extrudeCut",
          extrudeDefs,
          inputIds: [target.id],
          cutStartInset,
          originalCenter: result.position,
          regeneratedAt: precision,
        },
      });
      id += 1;
    }
    useStore.getState().consumeItems(targets.map((t) => t.id));
    await warnIfOpen(targets);
  } catch (err) {
    console.error("Cut extrusion failed:", err);
    useStore
      .getState()
      .showNotification(`The cut couldn't be made: ${err.message}`);
  }
}

// Fuse a batch of fresh extrude prisms into ONE solid.  The prisms already
// exist as store items (created together in a single "createGroup" timeline
// step) and are passed by id in `extrudeIds`; this union is its own next
// timeline entry.  Any existing solids to merge with (a face boss's source, the
// sketch host, the "Start from" solid, or a retargeted extrude) come in by id in
// `solidIds`.  All inputs are consumed.  `unionId` is pre-allocated by the
// caller so it can't collide with the just-created prisms (whose createGroup
// step the local max-id scans here don't see).  No-op if the boolean can't
// produce a result (< 2 valid inputs).
// Fuse a fresh multi-area extrude into ONE self-contained object in ONE timeline
// step.  Unlike runUnionExtrudes, the prisms are NOT created as separate store
// items — their recipes (`extrudeDefs`) are embedded in the result's
// `extrudeUnion` regenerator, so the whole extrude is a single "Extruded" entry.
// `hostIds` are existing solids (a boss) fused in and consumed.  Falls back to
// adding the prisms as separate items if the union can't be produced.
export async function runExtrudeUnion(extrudeDefs, hostIds = [], unionId) {
  // The prisms exist ONLY inside the union's recipe until it is committed, so a
  // failed fuse must add them separately or the extrude produces nothing.
  let committed = false;
  const keepSeparately = (reason) => {
    useStore.getState().addItems(extrudeDefs, "Extruded");
    useStore
      .getState()
      .showNotification(
        `The extrusion couldn't be merged with the body it starts on, so it was added as a separate body.${reason ? ` ${reason}` : ""}`,
      );
  };
  try {
    const { performCsg } = await import("../occClient.js");
    const store = useStore.getState();
    const items = store.items;
    // A hidden host is never fused (the user hid it deliberately — fusing would
    // resurrect it as a CSG result).  Mirrors resolveCutTargets' visibility
    // guard and unionTargetIdsFor's.
    const hosts = hostIds
      .map((id) =>
        items.find(
          (i) => i.id === id && i.type !== "sketch" && i.visible !== false,
        ),
      )
      .filter(Boolean);
    const inputs = [...extrudeDefs, ...hosts];
    if (inputs.length < 1) return;
    const precision = activePrecision(store);
    const result = await performCsg({
      selectedItems: inputs,
      operation: "union",
      printPrecision: precision,
      allItems: items,
    });
    if (!result) {
      // Couldn't fuse — keep the geometry by adding the prisms separately.
      committed = true;
      keepSeparately();
      return;
    }
    const material = (hosts[0] ?? extrudeDefs[0])?.material;
    committed = true;
    useStore.getState().addItem({
      id: unionId,
      name: `Extruded ${unionId}`,
      type: "csg",
      children: [],
      position: result.position,
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      geometryData: result.geometryData,
      ...(material && { material }),
      regenerator: {
        kind: "extrudeUnion",
        extrudeDefs,
        inputIds: hosts.map((h) => h.id),
        originalCenter: result.position,
        regeneratedAt: precision,
      },
    });
    if (hosts.length) useStore.getState().consumeItems(hosts.map((h) => h.id));
    await warnIfOpen(hosts);
  } catch (err) {
    // The fuse can THROW, not only come back empty -- OCC refuses a host it
    // can't boolean, such as an imported mesh too dense to turn into a solid.
    // That used to skip the fallback above and only log: a backward extrude
    // into an imported STL produced no body and no message at all.
    console.error("Extrude union failed:", err);
    if (!committed) keepSeparately(err.message);
  }
}

export async function runUnionExtrudes(extrudeIds, solidIds = [], unionId) {
  try {
    const { performCsg } = await import("../occClient.js");
    const freshStore = useStore.getState();
    const items = freshStore.items;
    const extrudes = extrudeIds
      .map((id) => items.find((i) => i.id === id))
      .filter(Boolean);
    const solids = solidIds
      .map((id) =>
        items.find(
          (i) => i.id === id && i.type !== "sketch" && i.visible !== false,
        ),
      )
      .filter(Boolean);
    const inputs = [...extrudes, ...solids];
    if (inputs.length < 2) return;
    // A boss adds to an existing solid, so prefer that solid's material; for a
    // pure multi-extrude union fall back to the first extrude's.
    const unionMaterial = (solids[0] ?? extrudes[0])?.material;
    const precision = activePrecision(freshStore);
    const result = await performCsg({
      selectedItems: inputs,
      operation: "union",
      printPrecision: precision,
      allItems: items,
    });
    if (!result) return;
    useStore.getState().addItem({
      id: unionId,
      name: `Union ${unionId}`,
      type: "csg",
      children: [],
      position: result.position,
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      geometryData: result.geometryData,
      ...(unionMaterial && { material: unionMaterial }),
      regenerator: {
        kind: "boolean",
        op: "union",
        inputIds: inputs.map((i) => i.id),
        originalCenter: result.position,
        regeneratedAt: precision,
      },
    });
    useStore.getState().consumeItems(inputs.map((i) => i.id));
    await warnIfOpen(solids);
  } catch (err) {
    console.error("Union extrude batch failed:", err);
    useStore
      .getState()
      .showNotification(`The extrusions couldn't be merged: ${err.message}`);
  }
}
