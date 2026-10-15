import { openMeshNotice } from "../../three/importWeld.js";
import { useStore } from "../../store";
import { maxItemId } from "../../store/internals.js";
import { buildExtrudeDef } from "../../three/cameraControls/extrude.js";
import { performCsg, withCommitGuard } from "../../three/occClient.js";
import {
  canSimplify,
  commitSimplify,
} from "../../three/cameraControls/simplify.js";
import { activePrecision } from "../../three/resolution.js";
import { bodySummary, NON_BODY_TYPES } from "../bodies.js";
import { extrudeProfile, sketchRegions } from "../profiles.js";
import { ApiError, defineCommand } from "../registry.js";
import { waitForSettled } from "../settle.js";

const itemOrThrow = (id) => {
  const it = useStore.getState().items.find((i) => i.id === id);
  if (!it) throw new ApiError("NOT_FOUND", `There is no item ${id}.`);
  return it;
};

defineCommand({
  name: "feature.extrude",
  description:
    'Extrude one closed region of a sketch into a new solid body, along the sketch plane\'s normal. depth is in mm, or a formula over the document variables such as "Thick" or "Height - 2"; a negative depth extrudes the other way. region picks the sketch\'s outer closed region (default 0); holes inside it are cut through. Returns the new body with its bounding box and volume.',
  input: {
    properties: {
      sketchId: { type: "integer" },
      depth: { type: ["number", "string"] },
      region: { type: "integer", minimum: 0 },
    },
    required: ["sketchId", "depth"],
  },
  run: async ({ sketchId, depth, region = 0 }) => {
    const sketch = itemOrThrow(sketchId);
    if (sketch.type !== "sketch")
      throw new ApiError(
        "BAD_ARGS",
        `Item ${sketchId} is a ${sketch.type}, not a sketch.`,
      );
    if (depth === 0 || (typeof depth === "string" && !depth.trim()))
      throw new ApiError("BAD_ARGS", "depth must be non-zero.");
    const regions = sketchRegions(sketch);
    if (!regions.length)
      throw new ApiError(
        "NO_PROFILE",
        `Sketch ${sketchId} has no closed region to extrude.`,
        {
          hint: "Its lines and curves have to meet end to end and enclose an area.",
        },
      );
    if (region >= regions.length)
      throw new ApiError(
        "BAD_ARGS",
        `Sketch ${sketchId} has ${regions.length} closed region(s), numbered from 0; there is no region ${region}.`,
      );

    const id = maxItemId(useStore.getState().history) + 1;
    useStore
      .getState()
      .addItem(
        buildExtrudeDef(
          extrudeProfile(sketch, regions[region]),
          typeof depth === "number" ? String(depth) : depth,
          false,
          0,
          id,
        ),
      );
    await waitForSettled();
    return bodySummary(id);
  },
});

const OP_LABEL = { union: "Union", difference: "Cut" };

defineCommand({
  name: "feature.boolean",
  description:
    "Combine solid bodies into a new one. union fuses target with every tool; difference cuts every tool out of target. The inputs are consumed -- hidden from this step on, as with the Boolean tool -- and the result is a new body, returned with its bounding box and volume. Bodies that only touch must share a face to fuse. When an input is an imported mesh that isn't closed, the result carries a `warning`: it may have holes where that surface was open.",
  input: {
    properties: {
      operation: { type: "string", enum: ["union", "difference"] },
      target: { type: "integer" },
      tools: { type: "array", items: { type: "integer" } },
    },
    required: ["operation", "target", "tools"],
  },
  run: async ({ operation, target, tools }) => {
    if (!tools.length)
      throw new ApiError(
        "BAD_ARGS",
        "feature.boolean needs at least one tool.",
      );
    if (tools.includes(target))
      throw new ApiError(
        "BAD_ARGS",
        `Item ${target} is both the target and a tool.`,
      );
    // The target first: for a difference it is the body being cut from, and
    // the result takes its material.
    const ordered = [target, ...tools].map((id) => {
      const it = itemOrThrow(id);
      if (NON_BODY_TYPES.has(it.type))
        throw new ApiError(
          "BAD_ARGS",
          `Item ${id} is a ${it.type}; booleans take solid bodies.`,
        );
      return it;
    });

    await waitForSettled();
    // An open imported mesh is booleaned anyway, with a warning, as in the UI.
    const warning = await openMeshNotice(ordered);
    const printPrecision = activePrecision();
    let result;
    try {
      // Guarded like the Boolean dialog's commit: a cancel landing mid-op would
      // otherwise abort it and hand back an empty mesh with no error.
      result = await withCommitGuard(() =>
        performCsg({
          selectedItems: ordered,
          operation,
          printPrecision,
          allItems: useStore.getState().items,
        }),
      );
    } catch (err) {
      throw new ApiError(
        "GEOMETRY_REJECTED",
        `The ${operation} failed: ${err.message}`,
      );
    }
    if (!result?.geometryData?.positions?.length)
      throw new ApiError("EMPTY_RESULT", `The ${operation} produced nothing.`, {
        hint:
          operation === "union"
            ? "The bodies may not touch or overlap."
            : "The tools may have removed the whole target.",
      });

    const s = useStore.getState();
    const id = maxItemId(s.history) + 1;
    const material = ordered[0].material;
    s.addItem({
      id,
      name: `${OP_LABEL[operation]} ${id}`,
      type: "csg",
      children: [],
      position: result.position,
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      geometryData: result.geometryData,
      ...(material ? { material } : {}),
      regenerator: {
        kind: "boolean",
        op: operation,
        inputIds: ordered.map((i) => i.id),
        originalCenter: result.position,
        regeneratedAt: printPrecision,
      },
    });
    useStore.getState().consumeItems(ordered.map((i) => i.id));
    await waitForSettled();
    return warning ? { ...bodySummary(id), warning } : bodySummary(id);
  },
});

defineCommand({
  name: "feature.simplify",
  description:
    "Reduce a mesh body's triangles, in place: an imported mesh, a split piece, or any modelled body (not a primitive or a plain extrusion). Give exactly one of maxDeviationMm -- remove as many triangles as possible while no point of the new surface lies further than this from the original, or the other way round (a measured bound, not an estimate) -- or triangles, the count to cut to. Returns the body with trianglesBefore and maxDeviationMm, the bound actually achieved. The body stays closed if it was.",
  input: {
    properties: {
      bodyId: { type: "integer" },
      maxDeviationMm: { type: "number", exclusiveMinimum: 0 },
      triangles: { type: "integer", minimum: 4 },
    },
    required: ["bodyId"],
  },
  run: async ({ bodyId, maxDeviationMm, triangles }) => {
    if ((maxDeviationMm == null) === (triangles == null))
      throw new ApiError(
        "BAD_ARGS",
        "Give exactly one of maxDeviationMm or triangles.",
      );
    // The validator doesn't read exclusiveMinimum; MCP clients do.
    if (maxDeviationMm != null && !(maxDeviationMm > 0))
      throw new ApiError("BAD_ARGS", "maxDeviationMm must be more than 0.");
    const item = itemOrThrow(bodyId);
    if (!canSimplify(item))
      throw new ApiError(
        "BAD_ARGS",
        `Item ${bodyId} is a ${item.type}; simplify takes a mesh body -- an import, a split piece, or a modelled body.`,
      );
    await waitForSettled();
    const params =
      triangles != null
        ? { mode: "triangles", targetTriangles: triangles }
        : { mode: "deviation", toleranceMm: maxDeviationMm };
    const ok = await commitSimplify({
      item: useStore.getState().items.find((i) => i.id === bodyId),
      params,
      printPrecision: activePrecision(),
    });
    if (!ok) {
      // The tool reports its reason on the dialog's error line; there is no
      // dialog here, so take it back and hand it over instead.
      const reason = useStore.getState().toolError;
      useStore.getState().setToolError(null);
      throw new ApiError(
        "GEOMETRY_REJECTED",
        reason ?? "The simplify produced nothing.",
      );
    }
    await waitForSettled();
    const stats = useStore.getState().items.find((i) => i.id === bodyId)
      ?.regenerator?.stats;
    return {
      ...bodySummary(bodyId),
      trianglesBefore: stats?.trianglesBefore,
      maxDeviationMm: stats?.maxDeviationMm,
    };
  },
});
