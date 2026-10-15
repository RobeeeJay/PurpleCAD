// Dash sizes in three's line materials are WORLD lengths, so a construction
// line authored with a fixed dash stops reading as dashed as soon as the view
// moves: zoom in and a single dash covers the whole line (it looks solid, and
// therefore looks like ordinary geometry), zoom out and the dashes crowd into
// a dotted smear. Sizing them in SCREEN pixels instead keeps a construction
// line recognisable at every zoom.
//
// The sizes are refreshed from the render loop (cameraControls/animateLoop.js),
// alongside the other constant-on-screen-size work.

export const CONSTRUCTION_DASH_PX = 7;
export const CONSTRUCTION_GAP_PX = 4;

// Weak refs: a sketch overlay is rebuilt on every edit, and its materials must
// be free to go with it rather than pile up here.
const tracked = [];
let lastWorldPerPixel = 0;

const sizeDashes = (material, worldPerPixel) => {
  const { dashPx, gapPx } = material.userData.screenDash;
  material.dashSize = dashPx * worldPerPixel;
  material.gapSize = gapPx * worldPerPixel;
};

// Keep this material's dashes a constant size on screen.
export function trackScreenDash(
  material,
  dashPx = CONSTRUCTION_DASH_PX,
  gapPx = CONSTRUCTION_GAP_PX,
) {
  material.userData.screenDash = { dashPx, gapPx };
  tracked.push(new WeakRef(material));
  // Size it now rather than leaving it solid until the next frame.
  if (lastWorldPerPixel > 0) sizeDashes(material, lastWorldPerPixel);
  return material;
}

export function applyScreenDashes(worldPerPixel) {
  if (!(worldPerPixel > 0)) return;
  lastWorldPerPixel = worldPerPixel;
  let live = 0;
  for (const ref of tracked) {
    const material = ref.deref();
    if (!material) continue;
    sizeDashes(material, worldPerPixel);
    tracked[live++] = ref;
  }
  tracked.length = live;
}
