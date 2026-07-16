// Packed mesh persistence: base64 Float32/Uint32 instead of JSON float text
// (a 200k-tri mesh as raw JSON was ~100 MB; the stringify spikes OOM'd the
// renderer).  In-memory stays plain arrays; packing only at the boundaries.
import { describe, it, expect } from "vitest";
import {
  packGeometryData,
  unpackGeometryData,
  packHistory,
  unpackHistory,
} from "../geometryPack.js";

const bigMesh = () => {
  // Realistic full-precision doubles (like OCC/displacement output) — the
  // whole point of packing is that these serialise as ~19 chars of text each.
  const positions = [];
  for (let i = 0; i < 3000; i++)
    positions.push(Math.sin(i) * 7.1234, Math.cos(i) * 3.4567, i * 0.1 + 1e-7);
  return {
    positions,
    indices: Array.from({ length: 3000 }, (_, i) => i),
    normals: positions.map(() => 0.5773502691896258),
  };
};

describe("geometryPack", () => {
  it("round-trips a large mesh through pack/unpack (float32 precision)", () => {
    const g = bigMesh();
    const packed = packGeometryData(g);
    expect(packed.__packedGeometry).toBe(1);
    expect(typeof packed.p).toBe("string");
    const back = unpackGeometryData(packed);
    expect(back.positions.length).toBe(g.positions.length);
    expect(back.indices).toEqual(g.indices);
    for (let i = 0; i < 30; i++)
      expect(back.positions[i]).toBeCloseTo(g.positions[i], 4);
  });

  it("is dramatically smaller than JSON float text", () => {
    const g = bigMesh();
    const raw = JSON.stringify(g).length;
    const packed = JSON.stringify(packGeometryData(g)).length;
    expect(packed).toBeLessThan(raw / 3);
  });

  it("leaves small meshes as plain JSON", () => {
    const g = { positions: [0, 0, 0, 1, 1, 1, 2, 2, 2], indices: [0, 1, 2] };
    expect(packGeometryData(g)).toBe(g);
    expect(unpackGeometryData(g)).toBe(g);
  });

  it("packHistory reaches nested sources and shares untouched structure", () => {
    const g = bigMesh();
    const history = [
      { id: 0, instruction: { type: "scene_created" } },
      {
        id: 1,
        instruction: {
          type: "modify",
          itemId: 5,
          patches: {
            geometryData: g,
            regenerator: { kind: "texture", source: { geometryData: g } },
          },
        },
      },
    ];
    const packed = packHistory(history);
    expect(packed[0]).toBe(history[0]); // untouched entry keeps identity
    const p1 = packed[1].instruction.patches;
    expect(p1.geometryData.__packedGeometry).toBe(1);
    expect(p1.regenerator.source.geometryData.__packedGeometry).toBe(1);
    // Unpack restores the plain-array shape everywhere.
    const back = unpackHistory(packed);
    expect(
      back[1].instruction.patches.regenerator.source.geometryData.positions
        .length,
    ).toBe(g.positions.length);
  });
});
