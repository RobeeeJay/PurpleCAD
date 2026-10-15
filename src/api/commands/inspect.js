import { useStore } from "../../store";
import { bodySummary, NON_BODY_TYPES } from "../bodies.js";
import { ApiError, defineCommand } from "../registry.js";
import { waitForSettled } from "../settle.js";

defineCommand({
  name: "body.list",
  description:
    "Every solid body in the document, with its bounding box (min, max and size) and enclosed volume, in mm in the Z-up frame. Bodies consumed by a boolean are hidden and left out unless includeHidden is true. A volume near zero or negative means the surface is open or inside out, not solid.",
  input: { properties: { includeHidden: { type: "boolean" } } },
  run: async ({ includeHidden = false }) => {
    await waitForSettled();
    const bodies = useStore
      .getState()
      .items.filter((i) => !NON_BODY_TYPES.has(i.type))
      .map((i) => bodySummary(i.id))
      .filter((b) => includeHidden || !b.hidden);
    return { bodies };
  },
});

// Angles in the view cube's convention (RotationWidget.jsx), so a view here is
// the view a person gets by clicking that face of the cube.
const VIEWS = {
  iso: [Math.asin(Math.sqrt(1 / 3)), Math.PI / 4],
  front: [0, 0],
  back: [0, Math.PI],
  right: [0, Math.PI / 2],
  left: [0, -Math.PI / 2],
  top: [Math.PI / 2, 0],
  bottom: [-Math.PI / 2, 0],
};

const PNG_PREFIX = "data:image/png;base64,";

defineCommand({
  name: "view.render",
  description:
    "A PNG of the model from a named view, framed to fit every visible body, with sketches, the grid and gizmos hidden. Look at it after building: dimension checks alone have passed parts that were plainly wrong. front looks along +Y, top looks down along -Z, and iso is the default three-quarter view.",
  input: {
    properties: {
      view: { type: "string", enum: Object.keys(VIEWS) },
      width: { type: "integer", minimum: 64, maximum: 2048 },
      height: { type: "integer", minimum: 64, maximum: 2048 },
    },
  },
  run: async ({ view = "iso", width = 800, height = 600 }) => {
    await waitForSettled();
    const cc = useStore.getState()._cameraControls;
    if (!cc?.captureView)
      throw new ApiError(
        "NO_VIEWPORT",
        "The viewport is not ready to render yet.",
      );
    const [rotX, rotY] = VIEWS[view];
    const url = cc.captureView({ rotX, rotY, width, height });
    if (!url?.startsWith(PNG_PREFIX))
      throw new ApiError("RENDER_FAILED", "The viewport returned no image.");
    return {
      view,
      width,
      height,
      mimeType: "image/png",
      data: url.slice(PNG_PREFIX.length),
    };
  },
});
