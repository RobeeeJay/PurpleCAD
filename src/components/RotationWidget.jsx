import React, { useRef, useEffect, useCallback } from "react";
import * as THREE from "three";
import "../styles/RotationWidget.css";

const FACE_CONFIGS = [
  {
    label: "Right",
    rotX: 0,
    rotY: Math.PI / 2,
    color: "#aa2222",
    hover: "#cc4444",
    pos: [1, 0, 0],
    rx: 0,
    ry: Math.PI / 2,
  },
  {
    label: "Left",
    rotX: 0,
    rotY: -Math.PI / 2,
    color: "#7a1a1a",
    hover: "#aa3333",
    pos: [-1, 0, 0],
    rx: 0,
    ry: -Math.PI / 2,
  },
  {
    label: "Top",
    rotX: Math.PI / 2,
    rotY: 0,
    color: "#1a4daa",
    hover: "#3366cc",
    pos: [0, 1, 0],
    rx: -Math.PI / 2,
    ry: 0,
  },
  {
    label: "Bottom",
    rotX: -Math.PI / 2,
    rotY: 0,
    color: "#13387a",
    hover: "#2255aa",
    pos: [0, -1, 0],
    rx: Math.PI / 2,
    ry: 0,
  },
  {
    label: "Front",
    rotX: 0,
    rotY: 0,
    color: "#1a7a2a",
    hover: "#33aa44",
    pos: [0, 0, 1],
    rx: 0,
    ry: 0,
  },
  {
    label: "Back",
    rotX: 0,
    rotY: Math.PI,
    color: "#135520",
    hover: "#228833",
    pos: [0, 0, -1],
    rx: 0,
    ry: Math.PI,
  },
];

// 12 edges: type indicates which axis the edge runs along; sa/sb/sc are ±1 signs
const EDGE_DATA = [
  // Z-edges (between ±X and ±Y faces)
  { type: "z", sa: 1, sb: 1, dir: [1, 1, 0] },
  { type: "z", sa: -1, sb: 1, dir: [-1, 1, 0] },
  { type: "z", sa: 1, sb: -1, dir: [1, -1, 0] },
  { type: "z", sa: -1, sb: -1, dir: [-1, -1, 0] },
  // Y-edges (between ±X and ±Z faces)
  { type: "y", sa: 1, sc: 1, dir: [1, 0, 1] },
  { type: "y", sa: -1, sc: 1, dir: [-1, 0, 1] },
  { type: "y", sa: 1, sc: -1, dir: [1, 0, -1] },
  { type: "y", sa: -1, sc: -1, dir: [-1, 0, -1] },
  // X-edges (between ±Y and ±Z faces)
  { type: "x", sb: 1, sc: 1, dir: [0, 1, 1] },
  { type: "x", sb: -1, sc: 1, dir: [0, -1, 1] },
  { type: "x", sb: 1, sc: -1, dir: [0, 1, -1] },
  { type: "x", sb: -1, sc: -1, dir: [0, -1, -1] },
];

const CORNER_DATA = [
  [1, 1, 1],
  [1, 1, -1],
  [1, -1, 1],
  [1, -1, -1],
  [-1, 1, 1],
  [-1, 1, -1],
  [-1, -1, 1],
  [-1, -1, -1],
];

// Parse "#rrggbb" → [r, g, b], blend N hex colors, return THREE.js hex number
const parseRGB = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};
const blendHex = (...hexColors) => {
  const cs = hexColors.map(parseRGB);
  const avg = [0, 1, 2].map((i) =>
    Math.round(cs.reduce((s, c) => s + c[i], 0) / cs.length),
  );
  return (avg[0] << 16) | (avg[1] << 8) | avg[2];
};

// Which FACE_CONFIGS indices border each edge / corner
const edgeFaceIndices = (cfg) => {
  if (cfg.type === "z") return [cfg.sa > 0 ? 0 : 1, cfg.sb > 0 ? 2 : 3];
  if (cfg.type === "y") return [cfg.sa > 0 ? 0 : 1, cfg.sc > 0 ? 4 : 5];
  return [cfg.sb > 0 ? 2 : 3, cfg.sc > 0 ? 4 : 5];
};
const cornerFaceIndices = ([a, b, c]) => [
  a > 0 ? 0 : 1,
  b > 0 ? 2 : 3,
  c > 0 ? 4 : 5,
];

const dirToAngles = (dx, dy, dz) => {
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return {
    rotX: Math.asin(Math.max(-1, Math.min(1, dy / len))),
    rotY: Math.atan2(dx / len, dz / len),
  };
};

const makeFaceCanvas = (label, bgColor) => {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 5;
  ctx.strokeRect(2.5, 2.5, size - 5, size - 5);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, size / 2, size / 2);
  return new THREE.CanvasTexture(canvas);
};

const RotationWidget = ({
  rotationState,
  onOrientationChange,
  onHome,
  style,
}) => {
  const mountRef = useRef(null);
  const threeRef = useRef({});
  const hoveredRef = useRef(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const SIZE = 120;
    const H = 0.85;
    const C = 0.22;
    const F = H - C;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(SIZE, SIZE);
    renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);

    const group = new THREE.Group();
    scene.add(group);

    // ── Face materials ────────────────────────────────────────────────────────
    const faceMats = FACE_CONFIGS.map((f) => {
      const mat = new THREE.MeshBasicMaterial({
        map: makeFaceCanvas(f.label, f.color),
      });
      mat.userData.normalTex = mat.map;
      mat.userData.hoverTex = makeFaceCanvas(f.label, f.hover);
      return mat;
    });

    // ── Face planes (6) ───────────────────────────────────────────────────────
    const faceMeshes = FACE_CONFIGS.map((f, i) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2 * F, 2 * F),
        faceMats[i],
      );
      mesh.position.set(f.pos[0] * H, f.pos[1] * H, f.pos[2] * H);
      mesh.rotation.x = f.rx;
      mesh.rotation.y = f.ry;
      mesh.userData = { rotX: f.rotX, rotY: f.rotY };
      group.add(mesh);
      return mesh;
    });

    // ── Edge quads (12) ───────────────────────────────────────────────────────
    const edgeMeshes = EDGE_DATA.map((cfg) => {
      const { rotX, rotY } = dirToAngles(...cfg.dir);
      let v;
      if (cfg.type === "z") {
        const { sa, sb } = cfg;
        v = [
          [sa * H, sb * F, -F],
          [sa * F, sb * H, -F],
          [sa * F, sb * H, F],
          [sa * H, sb * F, F],
        ];
      } else if (cfg.type === "y") {
        const { sa, sc } = cfg;
        v = [
          [sa * H, -F, sc * F],
          [sa * F, -F, sc * H],
          [sa * F, F, sc * H],
          [sa * H, F, sc * F],
        ];
      } else {
        const { sb, sc } = cfg;
        v = [
          [-F, sb * H, sc * F],
          [-F, sb * F, sc * H],
          [F, sb * F, sc * H],
          [F, sb * H, sc * F],
        ];
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(
          new Float32Array([
            ...v[0],
            ...v[1],
            ...v[2],
            ...v[0],
            ...v[2],
            ...v[3],
          ]),
          3,
        ),
      );
      geo.computeVertexNormals();
      const fi = edgeFaceIndices(cfg);
      const baseColor = blendHex(...fi.map((i) => FACE_CONFIGS[i].color));
      const hoverColor = blendHex(...fi.map((i) => FACE_CONFIGS[i].hover));
      const mat = new THREE.MeshBasicMaterial({
        color: baseColor,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData = { rotX, rotY, baseColor, hoverColor };
      group.add(mesh);
      return mesh;
    });

    // ── Corner triangles (8) ──────────────────────────────────────────────────
    const cornerMeshes = CORNER_DATA.map(([a, b, c]) => {
      const { rotX, rotY } = dirToAngles(a, b, c);
      const Pa = [a * H, b * F, c * F];
      const Pb = [a * F, b * H, c * F];
      const Pc = [a * F, b * F, c * H];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array([...Pa, ...Pb, ...Pc]), 3),
      );
      geo.computeVertexNormals();
      const fi = cornerFaceIndices([a, b, c]);
      const baseColor = blendHex(...fi.map((i) => FACE_CONFIGS[i].color));
      const hoverColor = blendHex(...fi.map((i) => FACE_CONFIGS[i].hover));
      const mat = new THREE.MeshBasicMaterial({
        color: baseColor,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData = { rotX, rotY, baseColor, hoverColor };
      group.add(mesh);
      return mesh;
    });

    const allPieces = [...faceMeshes, ...edgeMeshes, ...cornerMeshes];
    const renderScene = () => renderer.render(scene, camera);

    // ── Hover helpers ─────────────────────────────────────────────────────────
    const clearHover = () => {
      const prev = hoveredRef.current;
      if (!prev) return;
      const mat = prev.material;
      if (mat.userData.normalTex) {
        mat.map = mat.userData.normalTex;
        mat.needsUpdate = true;
      } else {
        mat.color.setHex(prev.userData.baseColor);
      }
      hoveredRef.current = null;
    };

    const applyHover = (mesh) => {
      const mat = mesh.material;
      if (mat.userData.normalTex) {
        mat.map = mat.userData.hoverTex;
        mat.needsUpdate = true;
      } else {
        mat.color.setHex(mesh.userData.hoverColor);
      }
      hoveredRef.current = mesh;
    };

    const onMouseMove = (e) => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera({ x, y }, camera);
      const hits = raycaster.intersectObjects(allPieces);
      const newMesh = hits.length > 0 ? hits[0].object : null;

      if (newMesh !== hoveredRef.current) {
        clearHover();
        if (newMesh) applyHover(newMesh);
        renderScene();
      }
    };

    const onMouseLeave = () => {
      if (hoveredRef.current) {
        clearHover();
        renderScene();
      }
    };

    el.addEventListener("mousemove", onMouseMove);
    el.addEventListener("mouseleave", onMouseLeave);

    threeRef.current = {
      renderer,
      scene,
      camera,
      group,
      allPieces,
      renderScene,
    };
    renderScene();

    return () => {
      el.removeEventListener("mousemove", onMouseMove);
      el.removeEventListener("mouseleave", onMouseLeave);
      el.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    const { group, renderScene } = threeRef.current;
    if (!renderScene || !group || !rotationState) return;
    group.quaternion.copy(rotationState).invert();
    renderScene();
  }, [rotationState]);

  const handleClick = useCallback(
    (e) => {
      const { camera, allPieces } = threeRef.current;
      if (!camera || !allPieces) return;
      const rect = mountRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera({ x, y }, camera);
      const hits = raycaster.intersectObjects(allPieces);
      if (!hits.length) return;
      const { rotX, rotY } = hits[0].object.userData;
      onOrientationChange?.(rotX, rotY);
    },
    [onOrientationChange],
  );

  const handleHome = useCallback(() => {
    // onHome frames all models; fall back to a pure isometric reorient.
    if (onHome) onHome();
    else onOrientationChange?.(Math.asin(Math.sqrt(1 / 3)), Math.PI / 4);
  }, [onHome, onOrientationChange]);

  return (
    <div className="rotation-widget" style={style}>
      <div
        ref={mountRef}
        className="orientation-cube-mount"
        onClick={handleClick}
      />
      <button className="home-button" onClick={handleHome} title="Reset view">
        ⌂
      </button>
    </div>
  );
};

export default RotationWidget;
