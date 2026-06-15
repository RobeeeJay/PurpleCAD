// Shared preview overlay for the mirror / circular / rectangular pattern tools.
//
// Two things make the in-progress operation readable:
//   • the COPIES render as bold, nearly-opaque dashed lines in the tool colour
//     (Line2 for real pixel width — much easier to see than the old thin,
//     half-transparent THREE.Line), and dashed so they read as "not committed
//     yet" against the solid committed copies;
//   • each selected SOURCE shape gets a bright selection-coloured outline on
//     top, so it's obvious which geometry is being duplicated.

import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { getSketchShapePoints } from "../sceneObjects.js";
import { SKETCH_SELECTION_BLUE } from "../theme.js";

const resolutionOf = (renderer) =>
  renderer
    ? renderer.getSize(new THREE.Vector2())
    : new THREE.Vector2(window.innerWidth, window.innerHeight);

function makeLine(pts, opts) {
  const {
    color,
    linewidth,
    dashed,
    resolution,
    opacity = 1,
    renderOrder,
  } = opts;
  const geo = new LineGeometry();
  geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
  const mat = new LineMaterial({
    color,
    linewidth,
    depthTest: false,
    resolution,
    transparent: opacity < 1,
    opacity,
    dashed: !!dashed,
    dashSize: dashed ? 0.12 : 0,
    gapSize: dashed ? 0.08 : 0,
  });
  const line = new Line2(geo, mat);
  line.computeLineDistances();
  line.renderOrder = renderOrder;
  return line;
}

// Build the overlay objects for a mirror/pattern preview.  `sourceShapes` are
// the selected originals (highlighted); `copyShapes` are the transformed
// duplicates (bold dashed in `color`).  Returns the objects to add to the scene
// — the caller owns adding/removing and disposing them.
export function buildPatternPreviewObjects({
  sketchMesh,
  sourceShapes,
  copyShapes,
  axisShapes = [],
  color,
  renderer,
}) {
  const resolution = resolutionOf(renderer);
  const objs = [];
  // Match the colour normal sketch-line selection uses, so a highlighted source
  // reads the same whether selected directly or as a pattern source.
  const highlight = SKETCH_SELECTION_BLUE;

  // The mirror axis: a bold solid line in the tool colour so the chosen line of
  // reflection reads clearly distinct from the (dashed) copies.
  axisShapes.forEach((shape) => {
    const pts = getSketchShapePoints(shape, sketchMesh);
    if (pts.length < 2) return;
    objs.push(
      makeLine(pts, {
        color,
        linewidth: 3,
        dashed: false,
        resolution,
        renderOrder: 1007,
      }),
    );
  });

  sourceShapes.forEach((shape) => {
    const pts = getSketchShapePoints(shape, sketchMesh);
    if (pts.length < 2) return;
    objs.push(
      makeLine(pts, {
        color: highlight,
        linewidth: 3.5,
        dashed: false,
        resolution,
        renderOrder: 1009,
      }),
    );
  });

  copyShapes.forEach((shape) => {
    const pts = getSketchShapePoints(shape, sketchMesh);
    if (pts.length < 2) return;
    objs.push(
      makeLine(pts, {
        color,
        linewidth: 2.5,
        dashed: true,
        resolution,
        opacity: 0.95,
        renderOrder: 1008,
      }),
    );
  });

  return objs;
}
