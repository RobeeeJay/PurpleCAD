// The async CSG runners for cut / boss extrudes.  Split out of extrude.js so
// that file stays focused on the hover/click/depth pipeline.  Both run through
// the same performCsg flow as the Combine toolbar (occClient → OCC worker) and
// replace their inputs with a single CSG item.

import { useStore } from "../../store";

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
    // Determine the targets to cut from.  In priority order:
    //   1. sourceItemId from the extrude profile (face-profile path — the user
    //      clicked a solid face directly).
    //   2. The sketch's hostSolidId (recorded when the sketch was placed on a
    //      solid's face).  Without this, cuts on a sketch-loop fall back to
    //      every visible solid in the scene, which silently turns unrelated
    //      primitives into CSG items.
    //   3. Every visible non-sketch non-extrude item (last resort for sketches
    //      placed on an axis plane with no specific host).
    let targets;
    if (sourceItemId != null) {
      const src = items.find(
        (i) => i.id === sourceItemId && i.type !== "sketch",
      );
      targets = src ? [src] : [];
    } else {
      const sketchId = extrude?.profile?.sketchId ?? null;
      const sketch =
        sketchId != null ? items.find((i) => i.id === sketchId) : null;
      const hostId = sketch?.hostSolidId ?? null;
      if (hostId != null) {
        const host = items.find((i) => i.id === hostId && i.type !== "sketch");
        targets = host ? [host] : [];
      } else {
        targets = items.filter(
          (i) =>
            i.type !== "sketch" &&
            i.type !== "extrude" &&
            i.id !== extrudeItemId &&
            i.visible !== false,
        );
      }
    }
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
        printPrecision: freshStore.curveResolution === "print" ? 0.01 : null,
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
        regenerator: {
          kind: "boolean",
          op: "difference",
          inputIds: [target.id, extrudeItemId],
          originalCenter: result.position,
          regeneratedAt: freshStore.curveResolution === "print" ? 0.01 : null,
        },
      });
    }
    // Fold the source solids and the standalone extrude into the new CSG cuts.
    useStore
      .getState()
      .consumeItems([extrudeItemId, ...targets.map((t) => t.id)]);
  } catch (err) {
    console.error("Cut extrusion failed:", err);
  }
}

// Union the freshly-created extrude prisms into one solid, optionally fusing
// them with existing host solids (`solidIds` — a face boss's source, the sketch
// host, or the "Start from" solid).  Falls back to leaving the prisms separate
// if the boolean can't produce a result (e.g. fewer than two valid inputs).
export async function runUnionExtrudes(extrudeIds, solidIds = []) {
  try {
    const { performCsg } = await import("../occClient.js");
    const freshStore = useStore.getState();
    const items = freshStore.items;
    const inputIds = [...extrudeIds, ...solidIds];
    const inputs = inputIds
      .map((id) => items.find((i) => i.id === id && i.type !== "sketch"))
      .filter(Boolean);
    if (inputs.length < 2) return;
    const precision = freshStore.curveResolution === "print" ? 0.01 : null;
    const result = await performCsg({
      selectedItems: inputs,
      operation: "union",
      printPrecision: precision,
      allItems: items,
    });
    if (!result) return;
    let maxId = 0;
    useStore.getState().history.forEach((e) => {
      if (e.instruction?.type === "create" && e.instruction.item.id > maxId)
        maxId = e.instruction.item.id;
    });
    const id = maxId + 1;
    useStore.getState().addItem({
      id,
      name: `Union ${id}`,
      type: "csg",
      children: [],
      position: result.position,
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      geometryData: result.geometryData,
      regenerator: {
        kind: "boolean",
        op: "union",
        inputIds: inputs.map((i) => i.id),
        originalCenter: result.position,
        regeneratedAt: precision,
      },
    });
    useStore.getState().consumeItems(inputs.map((i) => i.id));
  } catch (err) {
    console.error("Union extrude batch failed:", err);
  }
}
