// End-to-end smoke tests for STL + STEP export.  Verifies that the OCC
// STEPControl_Writer is callable with the bindings exposed by our pinned
// opencascade.js, and that a tessellated STL emerges with non-zero size.
// Without these tests an API drift (renamed enum, removed overload) is
// only caught when the user clicks Export — which is exactly the failure
// mode that originally motivated the rewrite.

import { describe, it, expect, beforeAll, vi } from "vitest";
import * as THREE from "three";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { ensureOcc, getOcc } from "../init.js";
import { makeCube, makeSphere } from "../primitives.js";
import { tessellate } from "../tessellate.js";

// The store import chain pulls in DOM-only modules; mock it so this test
// file can run in node.
vi.mock("../../../store", () => {
  const useStore = () => null;
  useStore.getState = () => ({ variables: [] });
  return { useStore };
});

beforeAll(async () => {
  await ensureOcc();
}, 60_000);

describe("occOps.exportSTL / exportSTEP", () => {
  it("exportSTL emits a valid binary STL for a scene", async () => {
    const { ops } = await import("../../occOps.js");
    const items = [
      { id: 1, type: "cube", position: { x: 0, y: 0, z: 0 } },
      { id: 2, type: "sphere", position: { x: 4, y: 0, z: 0 } },
    ];
    const buf = await ops.exportSTL({ items });
    expect(buf).toBeInstanceOf(ArrayBuffer);
    // 80-byte header + 4-byte count + 50 bytes per triangle.
    expect(buf.byteLength).toBeGreaterThan(84);
    const view = new DataView(buf);
    const triCount = view.getUint32(80, true);
    expect(triCount).toBeGreaterThan(0);
    expect(buf.byteLength).toBe(84 + triCount * 50);
  });

  it("exportSTL returns null for an empty scene", async () => {
    const { ops } = await import("../../occOps.js");
    expect(await ops.exportSTL({ items: [] })).toBeNull();
  });

  it("exportSTEP emits an ISO-10303-21 file", async () => {
    const { ops } = await import("../../occOps.js");
    const items = [{ id: 1, type: "cube", position: { x: 0, y: 0, z: 0 } }];
    const content = await ops.exportSTEP({ items });
    expect(typeof content).toBe("string");
    expect(content.startsWith("ISO-10303-21;")).toBe(true);
    expect(content.trim().endsWith("END-ISO-10303-21;")).toBe(true);
  });

  it("export pipeline preserves chamfers on CSG items", async () => {
    // Regression for: "Exported STL and Step files do not seem to include
    // chamfers or bevels."  buildItemShapeLocal must use chamferShapeBy
    // (not chamferShape) so face-mode chamfers and saved angleRad are
    // honoured during regeneration; otherwise the regenerated shape is
    // identical to the source and the export drops the chamfer.
    const { buildItemShapeLocal } = await import("../../csgUtils.js");
    const { tessellate: tess } = await import("../tessellate.js");
    const cube = { id: 1, type: "cube", position: { x: 0, y: 0, z: 0 } };
    const chamfered = {
      id: 2,
      type: "csg",
      position: { x: 0, y: 0, z: 0 },
      regenerator: {
        kind: "chamfer",
        source: cube,
        subGeo: {
          edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
          faces: [],
        },
        amount: 0.1,
        segments: 1,
      },
    };
    const baseShape = buildItemShapeLocal(cube, [cube]);
    const chamferedShape = buildItemShapeLocal(chamfered, [cube, chamfered]);
    expect(chamferedShape).toBeTruthy();
    const baseGeo = tess(baseShape, 0.01);
    const chamferedGeo = tess(chamferedShape, 0.01);
    // Chamfering an edge adds a new sloped face — the tessellation must
    // have more triangles than the unmodified cube.
    expect(chamferedGeo.index.count).toBeGreaterThan(baseGeo.index.count);
  });

  it("tessellates OCC primitives and STLExporter emits a binary STL", () => {
    const cubeGeo = tessellate(makeCube(), 0.01);
    const sphereGeo = tessellate(makeSphere(), 0.01);
    expect(cubeGeo.getAttribute("position").count).toBeGreaterThan(0);
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(cubeGeo));
    scene.add(new THREE.Mesh(sphereGeo));
    scene.updateMatrixWorld(true);
    const stl = new STLExporter().parse(scene, { binary: true });
    expect(stl).toBeInstanceOf(DataView);
    // Binary STL header is 80 bytes + 4 byte tri-count + 50 bytes/triangle.
    expect(stl.byteLength).toBeGreaterThan(84);
    const triCount = stl.getUint32(80, true);
    expect(triCount).toBeGreaterThan(0);
    expect(stl.byteLength).toBe(84 + triCount * 50);
  });
});

describe("orientation: Y-up viewport maps to Z-up export", () => {
  it("transformShape with rotation.x=+π/2 sends viewport +Y to +Z", async () => {
    // Regression for: "Ensure the exported orientation for STL and STEP
    // files matches the 3D viewport."  The viewport is Y-up; STL and STEP
    // viewers are Z-up.  Both exporters rotate +π/2 around X so the
    // viewport's "up" axis becomes the export's "up" axis — without this
    // rotation an upright object appears lying on its side (or upside
    // down with the legacy -π/2 rotation).
    const { transformShape } = await import("../operations.js");
    const oc = getOcc();
    // Build a tall, thin "post" extending along +Y (the viewport's "up").
    const p1 = new oc.gp_Pnt_3(-0.1, 0, -0.1);
    const p2 = new oc.gp_Pnt_3(0.1, 2.0, 0.1);
    const post = new oc.BRepPrimAPI_MakeBox_3(p1, p2).Shape();
    const oriented = transformShape(post, null, { x: Math.PI / 2 });
    const geo = tessellate(oriented, 0.05);
    const pos = geo.getAttribute("position");
    // The original max-Y was +2; after rotation that vertex should sit
    // at approximately +Z = +2 with original-Y collapsed near zero.
    let maxZ = -Infinity,
      maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      maxZ = Math.max(maxZ, pos.getZ(i));
      maxY = Math.max(maxY, pos.getY(i));
    }
    expect(maxZ).toBeGreaterThan(1.9);
    expect(maxY).toBeLessThan(0.2);
  });
});

describe("STEP export pipeline (OCC STEPControl_Writer)", () => {
  it("emits a non-empty ISO-10303-21 file via the OCC writer", () => {
    const oc = getOcc();
    expect(oc.STEPControl_Writer_1).toBeTypeOf("function");
    expect(oc.STEPControl_StepModelType).toBeDefined();
    const writer = new oc.STEPControl_Writer_1();
    const mode = oc.STEPControl_StepModelType.STEPControl_AsIs;
    writer.Transfer(makeCube(), mode, true);
    // OCC.js's STEPControl_Writer::Write marshals the JS string into a
    // Standard_CString via a temporary heap buffer that may be released
    // before the FS records the path — the file ends up under a garbled
    // name in this binding.  Walk the FS and pick the new entry rather
    // than trusting the original filename.
    const before = new Set(oc.FS.readdir("/"));
    writer.Write("scene.step");
    const after = oc.FS.readdir("/");
    const writtenName = after.find((n) => !before.has(n));
    expect(writtenName).toBeTruthy();
    const data = oc.FS.readFile("/" + writtenName, { encoding: "utf8" });
    try {
      oc.FS.unlink("/" + writtenName);
    } catch {}
    // A valid STEP file starts with "ISO-10303-21;" and ends with
    // "END-ISO-10303-21;".  This is the strongest cheap signal that the
    // writer produced parseable output.
    expect(data.startsWith("ISO-10303-21;")).toBe(true);
    expect(data.trim().endsWith("END-ISO-10303-21;")).toBe(true);
    expect(data.length).toBeGreaterThan(500);
  });

  it("accumulates multiple shapes in a single STEP file", () => {
    const oc = getOcc();
    const writer = new oc.STEPControl_Writer_1();
    const mode = oc.STEPControl_StepModelType.STEPControl_AsIs;
    writer.Transfer(makeCube(), mode, true);
    writer.Transfer(makeSphere(), mode, true);
    const before = new Set(oc.FS.readdir("/"));
    writer.Write("multi.step");
    const writtenName = oc.FS.readdir("/").find((n) => !before.has(n));
    expect(writtenName).toBeTruthy();
    const data = oc.FS.readFile("/" + writtenName, { encoding: "utf8" });
    try {
      oc.FS.unlink("/" + writtenName);
    } catch {}
    expect(data.startsWith("ISO-10303-21;")).toBe(true);
    // Both shapes should be present — heuristic: more entities than a
    // single-shape file.  A cube alone produces a few hundred lines;
    // cube+sphere should noticeably exceed that.
    const cubeOnly = (() => {
      const w = new oc.STEPControl_Writer_1();
      w.Transfer(makeCube(), mode, true);
      const beforeC = new Set(oc.FS.readdir("/"));
      w.Write("cube.step");
      const cName = oc.FS.readdir("/").find((n) => !beforeC.has(n));
      const c = oc.FS.readFile("/" + cName, { encoding: "utf8" });
      try {
        oc.FS.unlink("/" + cName);
      } catch {}
      return c;
    })();
    expect(data.length).toBeGreaterThan(cubeOnly.length);
  });
});
