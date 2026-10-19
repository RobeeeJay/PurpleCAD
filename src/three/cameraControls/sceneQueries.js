// Read-only questions the UI, the agent API and the e2e suite ask of the
// scene as drawn: a body's live surface and stats, sketch annotation colours
// and constraint markers, and where a world point lands on screen.

import * as THREE from "three";
import { constraintIconScreenPos } from "../sceneObjects/constraintIconSprites.js";

export function attachSceneQueries({
  controls,
  scene,
  renderer,
  cameraRef,
  itemsRef,
  objectsRef,
  selectedIdRef,
  sketchShapesGroupRef,
}) {
  // World position + triangle/vertex counts of a selected object's live mesh,
  // for the status line.
  // The surface of a body that has no BAKED mesh.
  //
  // Extrudes and primitives are built analytically in the renderer, so
  // geometryData is empty for them and anything reading it alone sees no body
  // at all -- which is why Stress refused to open on an extrude. What is drawn
  // is a perfectly good watertight surface, in the same local frame the face
  // picks come back in, so the analysis can read it straight off the scene.
  controls.hasSurfaceMesh = (itemId) => {
    const p = objectsRef.current[itemId]?.geometry?.attributes?.position;
    return !!p && p.count >= 12;
  };
  controls.meshSurface = (itemId) => {
    const geom = objectsRef.current[itemId]?.geometry;
    const pos = geom?.attributes?.position;
    if (!pos) return null;
    return {
      positions: Array.from(pos.array),
      indices: geom.index ? Array.from(geom.index.array) : null,
    };
  };

  // A body's own surface for the agent API to measure: local positions and
  // indices plus the world matrix.  A mesh wearing a stress field or an
  // optimisation preview has had its geometry swapped, so it is the geometry
  // kept aside in userData that describes the body, not what is on screen.
  controls.meshWorldData = (itemId) => {
    const mesh = objectsRef.current[itemId];
    if (!mesh?.isMesh) return null;
    const geom = mesh.userData?.stressGeometry ?? mesh.geometry;
    const pos = geom?.attributes?.position;
    if (!pos) return null;
    mesh.updateMatrixWorld(true);
    return {
      positions: pos.array,
      indices: geom.index ? geom.index.array : null,
      matrix: Array.from(mesh.matrixWorld.elements),
      hull: !!mesh.userData?.hullGeometry,
    };
  };

  // What a body's mesh is currently WEARING: whether a per-vertex field is on
  // it and how varied it is.  The e2e suite's only way to see a stress plot --
  // the colours live in a BufferAttribute in the three.js scene, and no part
  // of that reaches the DOM.
  controls.meshDisplayInfo = (itemId) => {
    const mesh = objectsRef.current[itemId];
    if (!mesh?.isMesh) return null;
    const attr = mesh.geometry?.attributes?.color;
    const seen = new Set();
    if (attr)
      for (let i = 0; i < attr.count; i++)
        seen.add(
          [0, 1, 2].map((c) => attr.array[i * 3 + c].toFixed(3)).join(","),
        );
    return {
      hasVertexColors: !!attr && !!mesh.material?.vertexColors,
      colorCount: attr?.count ?? 0,
      distinctColors: seen.size,
      // Whether the mesh currently on screen is the body's own or something
      // swapped in over it (a stress field, an optimisation preview).
      vertexCount: mesh.geometry?.attributes?.position?.count ?? 0,
      swapped: !!mesh.userData?.stressGeometry,
      // What the view draws the body WITH.  `finish` lists any metalness /
      // roughness / clearcoat / specular settings the material carries; the
      // raster views should carry none.
      material: mesh.material
        ? {
            type: mesh.material.type,
            color: mesh.material.color?.getHexString() ?? null,
            opacity: mesh.material.opacity,
            transparent: mesh.material.transparent,
            finish: [
              "metalness",
              "roughness",
              "clearcoat",
              "specularIntensity",
              "shininess",
            ].filter((k) => k in mesh.material),
          }
        : null,
    };
  };

  // The colours the open sketch's constraint annotations are currently drawn
  // in, as { [constraintIdx]: ["#rrggbb", ...] } — used by the e2e suite to
  // see that a dimension is highlighted.  Nothing else can: the annotations
  // live in the three.js scene, and a label's text is baked into a canvas
  // texture rather than sitting in the DOM.
  controls.sketchAnnotationColors = () => {
    const out = {};
    sketchShapesGroupRef.current?.traverse((o) => {
      const idx = o.userData?.constraintIdx;
      if (idx == null || !o.material?.color) return;
      (out[idx] ??= []).push("#" + o.material.color.getHexString());
    });
    return out;
  };

  // Dash sizes of every construction line on screen -- the sketch being edited
  // and sketches drawn in the 3D view alike. They are world lengths that the
  // render loop re-sizes every frame to hold a constant size on screen, which
  // is what the e2e suite reads them to check.
  controls.constructionDashSizes = () => {
    const out = [];
    scene.traverse((o) => {
      if (o.material?.userData?.screenDash)
        out.push({
          dashSize: o.material.dashSize,
          gapSize: o.material.gapSize,
        });
    });
    return out;
  };

  // Every toolbar-icon constraint marker in the sketch being edited: where its
  // anchor and its middle are on screen, and how big it is drawn.  The size is
  // measured independently of the render loop that set it (world scale over
  // world-per-pixel), so the e2e suite can check the loop got it right.
  controls.constraintMarkers = () => {
    const mesh = objectsRef.current[selectedIdRef.current];
    const cam = cameraRef.current;
    const group = sketchShapesGroupRef.current;
    if (!mesh || !cam || !group) return [];
    const rect = renderer.domElement.getBoundingClientRect();
    const out = [];
    group.traverse((o) => {
      const icon = o.userData.screenIcon;
      if (!icon) return;
      const anchor = constraintIconScreenPos(
        {
          userData: {
            constraintIconLocalPos: o.userData.constraintIconLocalPos,
          },
        },
        mesh,
        cam,
        rect,
      );
      const visibleHeight = cam.isOrthographicCamera
        ? (cam.top - cam.bottom) / cam.zoom
        : 2 *
          cam.position.distanceTo(o.getWorldPosition(new THREE.Vector3())) *
          Math.tan((cam.fov * Math.PI) / 360);
      out.push({
        type: o.userData.constraintType,
        constraintIdx: o.userData.constraintIdx,
        anchor,
        middle: constraintIconScreenPos(o, mesh, cam, rect),
        sizePx: (o.scale.x * rect.height) / visibleHeight,
        selected: !!icon.selected,
        // Opacity of the marker's picture at a point that is background, not
        // artwork: just inside its left edge, half-way down.
        backgroundAlpha: (() => {
          const img = o.material.map?.image;
          const ctx = img?.getContext?.("2d");
          if (!ctx) return null;
          const x = Math.round(img.width * 0.08);
          const y = Math.round(img.height * 0.5);
          return ctx.getImageData(x, y, 1, 1).data[3] / 255;
        })(),
        // For a marker tied to a value label: where that label's TEXT is.
        label: icon.label
          ? (() => {
              const at = icon.label
                .getWorldPosition(new THREE.Vector3())
                .project(cam);
              return {
                x: rect.left + ((at.x + 1) / 2) * rect.width,
                y: rect.top + ((1 - at.y) / 2) * rect.height,
                halfWidthPx:
                  (icon.label.scale.x *
                    (icon.label.userData.textWidthFraction ?? 1) *
                    rect.height) /
                  visibleHeight /
                  2,
                // The whole label sprite's height (the text sits inside it).
                halfHeightPx:
                  (icon.label.scale.y * rect.height) / visibleHeight / 2,
                text: icon.label.userData.labelText,
              };
            })()
          : null,
      });
    });
    return out;
  };

  // Project a world-space point to CSS pixel coordinates in the canvas —
  // used by the e2e suite to aim REAL mouse clicks at faces/edges (raycast
  // targets aren't DOM-addressable any other way).
  controls.worldToScreen = (x, y, z) => {
    const cam = cameraRef.current;
    if (!cam) return null;
    const v = new THREE.Vector3(x, y, z).project(cam);
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
      inFront: v.z < 1,
    };
  };

  // Whole-scene totals for the corner stats tag: faces/points of every model
  // mesh currently displayed (sketches and reference planes excluded).
  controls.getSceneStats = () => {
    let faces = 0;
    let points = 0;
    for (const mesh of Object.values(objectsRef.current)) {
      const item = itemsRef.current.find((i) => i.id === mesh.userData.itemId);
      if (!item || item.type === "sketch" || item.type === "plane") continue;
      if (item.visible === false) continue;
      const g = mesh.geometry;
      const pos = g?.getAttribute("position");
      if (!pos) continue;
      points += pos.count;
      faces += g.index ? g.index.count / 3 : pos.count / 3;
    }
    return { faces: Math.round(faces), points };
  };

  controls.getObjectStats = (id) => {
    const mesh = objectsRef.current[id];
    const g = mesh?.geometry;
    const pos = g?.getAttribute("position");
    if (!pos) return null;
    const wp = mesh.getWorldPosition(new THREE.Vector3());
    return {
      worldPosition: { x: wp.x, y: wp.y, z: wp.z },
      points: pos.count,
      faces: g.index ? g.index.count / 3 : pos.count / 3,
    };
  };
}
