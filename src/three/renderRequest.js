// "Something changed, draw another frame" -- the render loop is on demand, so
// anything that updates the scene outside a store change or a pointer event
// (a texture that finishes loading, say) says so here.  Its own module so the
// scene-object builders can call it without importing the render loop, which
// pulls in the whole scene setup.

let pending = true;

export function requestRender() {
  pending = true;
}

// Dispose replaced materials/geometries only after a frame has been drawn with
// their replacements.  three.js deletes a shader program when its last
// material is disposed, so disposing first makes an identical new material
// recompile it -- 0.2-1 s per program on a laptop GPU.  Gives up waiting after
// 60 frames (a stopped loop) and disposes anyway.
export function disposeAfterNextDraw(renderer, resources) {
  if (resources.length === 0) return;
  const frame0 = renderer.info.render.frame;
  let polls = 0;
  requestRender();
  const check = () => {
    if (renderer.info.render.frame === frame0 && ++polls < 60)
      requestAnimationFrame(check);
    else resources.forEach((r) => r.dispose());
  };
  requestAnimationFrame(check);
}

// The render loop's side: was a frame asked for since the last one?
export function takeRenderRequest() {
  const was = pending;
  pending = false;
  return was;
}
