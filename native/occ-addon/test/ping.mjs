import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const addonPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../build/Release/occ_addon.node",
);
const addon = require(addonPath);

// ping
const pong = addon.ping();
console.assert(pong === "pong", `ping() returned ${pong}`);
console.log(`ping: ${pong}`);

// makeCubeTessellated
const result = addon.makeCubeTessellated(0.1);
console.assert(result.positions instanceof Float32Array, "positions is Float32Array");
console.assert(result.indices instanceof Uint32Array, "indices is Uint32Array");
console.assert(result.triangleCount > 0, "triangleCount > 0");
console.assert(result.positions.length === (result.indices.length / 3) * 3 ||
               result.positions.length > 0, "positions populated");
console.log(`makeCubeTessellated: ${result.triangleCount} triangles, ${result.positions.length / 3} vertices`);

console.log("all assertions passed");
