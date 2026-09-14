import { useStore } from "../../store";
import { maxItemId } from "../../store/internals.js";
import { solveConstraints } from "../../three/sketchSolver.js";
import { conflictingDimensions } from "../../three/sketchDimensionConflicts.js";
import { variablesToMap } from "../../utils/formulas.js";
import { PLANES, planePlacement, toScene } from "../frames.js";
import { sketchRegions } from "../profiles.js";
import { ApiError, defineCommand } from "../registry.js";
import { waitForSettled } from "../settle.js";

// Coordinate fields per shape type, all in mm on the way in. Nested points
// (a bezier's p0..p3) are { x, y }.
const SHAPES = {
  line: { numbers: ["x1", "y1", "x2", "y2"], points: [] },
  circle: { numbers: ["cx", "cy", "r"], points: [] },
  point: { numbers: ["x", "y"], points: [] },
  bezier: { numbers: [], points: ["p0", "p1", "p2", "p3"] },
};

const finite = (v) => typeof v === "number" && Number.isFinite(v);

function sceneShape(shape, i) {
  const spec = SHAPES[shape?.type];
  if (!spec)
    throw new ApiError(
      "BAD_SHAPE",
      `shapes[${i}] has unknown type "${shape?.type}".`,
      {
        supported: Object.keys(SHAPES),
      },
    );
  const out = { type: shape.type };
  for (const key of spec.numbers) {
    if (!finite(shape[key]))
      throw new ApiError(
        "BAD_SHAPE",
        `shapes[${i}] (${shape.type}) needs a number for "${key}".`,
      );
    out[key] = toScene(shape[key]);
  }
  for (const key of spec.points) {
    const p = shape[key];
    if (!finite(p?.x) || !finite(p?.y))
      throw new ApiError(
        "BAD_SHAPE",
        `shapes[${i}] (${shape.type}) needs "${key}" as { x, y }.`,
      );
    out[key] = { x: toScene(p.x), y: toScene(p.y) };
  }
  if (shape.type === "circle" && !(out.r > 0))
    throw new ApiError(
      "BAD_SHAPE",
      `shapes[${i}] (circle) needs a positive r.`,
    );
  return out;
}

// Constraint types whose `distance` is a length. A bare NUMBER stored there is
// read as legacy scene units, so mm from an agent is stored as a formula
// string -- the store's convention for anything a person typed in mm.
const LENGTH_CONSTRAINTS = new Set(["distance", "pointLineDistance", "offset"]);

const INDEX_FIELDS = [
  "shapeIdx",
  "shapeAIdx",
  "shapeBIdx",
  "pointShapeIdx",
  "lineShapeIdx",
  "targetShapeIdx",
];

function storedConstraint(c, i, shapeCount) {
  if (typeof c?.type !== "string")
    throw new ApiError("BAD_CONSTRAINT", `constraints[${i}] needs a type.`);
  for (const f of INDEX_FIELDS)
    if (
      c[f] !== undefined &&
      !(Number.isInteger(c[f]) && c[f] >= 0 && c[f] < shapeCount)
    )
      throw new ApiError(
        "BAD_CONSTRAINT",
        `constraints[${i}].${f} is ${c[f]}, but the sketch has shapes 0 to ${shapeCount - 1}.`,
      );
  if (LENGTH_CONSTRAINTS.has(c.type) && finite(c.distance))
    return { ...c, distance: String(c.distance) };
  return { ...c };
}

defineCommand({
  name: "sketch.create",
  description: [
    "Create a sketch on a principal plane: shapes in the plane's own 2D coordinates, in mm, and optional constraints that the solver enforces before the sketch is saved.",
    "Planes: XY (local x->X, y->Y, extrudes toward +Z), XZ (x->X, y->Z, extrudes toward -Y), YZ (x->Y, y->Z, extrudes toward +X). offset moves the plane along that direction, in mm.",
    "Shapes: line {x1,y1,x2,y2}, circle {cx,cy,r}, point {x,y}, bezier {p0,p1,p2,p3} with each p as {x,y}. Closed regions come from lines and curves meeting end to end.",
    'Constraints refer to shapes by index: coincident {shapeAIdx,pointA,shapeBIdx,pointB} with points "start"/"end" (or "p0"/"p3" on a bezier), horizontal/vertical {shapeIdx}, distance {shapeAIdx,pointA,shapeBIdx,pointB,distance} with distance in mm or a variable formula, pointLineDistance {pointShapeIdx,pointKey,lineShapeIdx,distance}. Bezier control points are held fixed by the solver.',
    "Fails with SKETCH_UNSOLVED -- and saves nothing -- when the constraints cannot all be met, naming the dimensions that conflict.",
  ].join(" "),
  input: {
    properties: {
      plane: { type: "string", enum: Object.keys(PLANES) },
      offset: { type: "number", description: "mm along the plane's normal" },
      name: { type: "string" },
      shapes: { type: "array", items: { type: "object" } },
      constraints: { type: "array", items: { type: "object" } },
    },
    required: ["plane", "shapes"],
  },
  run: async ({ plane, offset = 0, name, shapes, constraints = [] }) => {
    if (!shapes.length)
      throw new ApiError("BAD_ARGS", "sketch.create needs at least one shape.");
    const scene = shapes.map(sceneShape);
    const stored = constraints.map((c, i) =>
      storedConstraint(c, i, scene.length),
    );

    const state = useStore.getState();
    const vars = variablesToMap(state.variables);
    let solved = scene;
    if (stored.length) {
      const res = solveConstraints(scene, stored, { variables: vars });
      if (!res.ok) {
        const bad = conflictingDimensions(res.shapes, stored, vars);
        throw new ApiError(
          "SKETCH_UNSOLVED",
          "The constraints cannot all be met at once.",
          {
            maxResidualMm: Math.round(res.maxResidual * 10 * 1000) / 1000,
            conflictingConstraints: bad.map((c) => stored.indexOf(c)),
          },
        );
      }
      solved = res.shapes;
    }

    const id = maxItemId(state.history) + 1;
    state.addItem({
      id,
      name: name ?? `Sketch ${id}`,
      type: "sketch",
      children: [],
      parentId: null,
      ...planePlacement(plane, offset),
      scale: { x: 1, y: 1, z: 1 },
      shapes: solved,
      constraints: stored,
    });
    // Adding selects the item, and a selected sketch drops the viewport into
    // sketch mode with a camera fly-in. An agent builds in the 3D view.
    useStore.getState().selectItem(null);
    await waitForSettled();

    const sketch = useStore.getState().items.find((i) => i.id === id);
    return {
      id,
      shapes: solved.length,
      closedRegions: sketchRegions(sketch).length,
    };
  },
});
