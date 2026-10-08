// Write the spike's input: MultiSystem2's base STL (test-files/multisystem2.pcad,
// item 1) and the two boss holes the document cuts through it, in the binary
// layout spike.mm reads.  Usage: node ios/spike/mesh.js <out.bin>
import fs from "fs";
import { unpackGeometryData } from "../../src/store/geometryPack.js";

const out = process.argv[2];
if (!out) {
  console.error("usage: node ios/spike/mesh.js <out.bin>");
  process.exit(2);
}
const doc = JSON.parse(
  fs.readFileSync(
    new URL("../../test-files/multisystem2.pcad", import.meta.url),
    "utf8",
  ),
);
const stl = doc.history.find((e) => e.id === 1).instruction.item;
const g = unpackGeometryData(stl.geometryData);
const p = stl.position || { x: 0, y: 0, z: 0 };
const positions = Float64Array.from(g.positions, (v, i) =>
  i % 3 === 0 ? v + p.x : i % 3 === 1 ? v + p.y : v + p.z,
);
const indices = g.indices?.length
  ? Uint32Array.from(g.indices)
  : Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
let lo = Infinity;
let hi = -Infinity;
for (let i = 1; i < positions.length; i += 3) {
  lo = Math.min(lo, positions[i]);
  hi = Math.max(hi, positions[i]);
}
// The boss holes of the document's Cut 14: radius 1.972 mm at these centres
// (scene units, 1 = 10 mm), cut clean through the base.
const holes = [
  [11.664, 0, -4.704],
  [-11.692, 0, -4.704],
];
const header = new Uint32Array([positions.length, indices.length]);
const tail = new Float64Array([...holes.flat(), 0.1972, hi + 0.1, lo - 0.1]);
fs.writeFileSync(
  out,
  Buffer.concat([
    Buffer.from(header.buffer),
    Buffer.from(positions.buffer),
    Buffer.from(indices.buffer),
    Buffer.from(tail.buffer),
  ]),
);
console.log(
  `${indices.length / 3} triangles, y ${lo.toFixed(3)}..${hi.toFixed(3)} -> ${out}`,
);
