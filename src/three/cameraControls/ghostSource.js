// Ghosting the body a tool's live preview is drawn over: fade it to a
// translucent outline-free shell so the preview reads through it, and put
// every material setting back exactly when the preview goes.  The same code
// sits inline in the chamfer, draft, emboss, hole, push/pull and shell
// previews; new previews use this.

const GHOST_OPACITY = 0.12;

export function createGhost(objectsRef) {
  let ghosted = null;

  const unghost = () => {
    if (!ghosted) return;
    const { mesh, opacity, transparent, depthWrite, uOpacity, edges } = ghosted;
    const mat = mesh.material;
    if (mat) {
      mat.transparent = transparent;
      mat.depthWrite = depthWrite;
      if (uOpacity != null && mat.uniforms?.uOpacity)
        mat.uniforms.uOpacity.value = uOpacity;
      else mat.opacity = opacity;
      mat.needsUpdate = true;
    }
    edges.forEach(({ child, visible }) => {
      child.visible = visible;
    });
    ghosted = null;
  };

  const ghost = (itemId) => {
    const mesh = objectsRef.current[itemId];
    if (!mesh || (ghosted && ghosted.mesh === mesh)) return;
    unghost();
    const mat = mesh.material;
    ghosted = {
      mesh,
      opacity: mat.opacity,
      transparent: mat.transparent,
      depthWrite: mat.depthWrite,
      uOpacity: mat.uniforms?.uOpacity ? mat.uniforms.uOpacity.value : null,
      edges: mesh.children.map((c) => ({ child: c, visible: c.visible })),
    };
    mat.transparent = true;
    mat.depthWrite = false;
    if (mat.uniforms?.uOpacity) mat.uniforms.uOpacity.value = GHOST_OPACITY;
    else mat.opacity = GHOST_OPACITY;
    mat.needsUpdate = true;
    mesh.children.forEach((c) => {
      c.visible = false;
    });
  };

  return { ghost, unghost };
}
