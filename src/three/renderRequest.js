// "Something changed, draw another frame" -- the render loop is on demand, so
// anything that updates the scene outside a store change or a pointer event
// (a texture that finishes loading, say) says so here.  Its own module so the
// scene-object builders can call it without importing the render loop, which
// pulls in the whole scene setup.

let pending = true;

export function requestRender() {
  pending = true;
}

// The render loop's side: was a frame asked for since the last one?
export function takeRenderRequest() {
  const was = pending;
  pending = false;
  return was;
}
