// The iPad runs occ-bridge.cjs unchanged inside JavaScriptCore, over the same
// OCC ops the Node addon exports (native/occ-addon/src/occ_js.h).  This runs
// one script under both engines -- Node with the N-API build, and
// occ_jsc_host with the JavaScriptCore adapter -- and requires identical
// output: every result's typed arrays hashed bit for bit, and every error
// message.  The native code is shared, so a difference is the adapter.
//
// macOS only: JavaScriptCore ships with it, and `npm run build` in the addon
// builds the host beside the .node there.  Elsewhere the suite skips.

import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { buildEmbossStamp } from "../../embossGeometry.js";

const root = resolve(__dirname, "../../../..");
const host = join(root, "native/occ-addon/build/occ_jsc_host");
const script = join(root, "native/occ-addon/test/bridge-engines.cjs");
const bridge = join(root, "electron/occ-bridge.cjs");

// OCC's STEP writer prints a banner to stdout; the results are the JSON lines.
const results = (stdout) =>
  stdout
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l));

describe.skipIf(process.platform !== "darwin")(
  "occ-bridge.cjs under JavaScriptCore",
  () => {
    it("returns exactly what it returns under Node", () => {
      expect(
        existsSync(host),
        `${host} missing: run npm run build in native/occ-addon`,
      ).toBe(true);

      // The emboss stamp needs the ESM geometry code, so it is built here.
      const stamp = buildEmbossStamp(
        [
          {
            polygon2D: [
              { x: -0.3, y: -0.3 },
              { x: 0.3, y: -0.3 },
              { x: 0.3, y: 0.3 },
              { x: -0.3, y: 0.3 },
            ],
            holes: [],
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            normalWorld: { x: 0, y: 0, z: 1 },
          },
        ],
        { nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 },
        { deboss: false, angleDeg: 0, offsetMm: 0, scale: 1, distanceMm: 4 },
        [],
        null,
      );
      const extra = join(
        mkdtempSync(join(tmpdir(), "jsc-bridge-")),
        "extra.json",
      );
      writeFileSync(extra, JSON.stringify({ stamp }));

      const args = [script, bridge, extra];
      const run = (cmd, a) =>
        results(
          execFileSync(cmd, a, {
            encoding: "utf8",
            maxBuffer: 1 << 26,
            stdio: ["ignore", "pipe", "ignore"],
          }),
        );
      const node = run(process.execPath, args);
      const jsc = run(host, args);

      // Not a vacuous match: the cases ran, and all but the deliberate failures
      // produced geometry.
      const errors = node.filter((r) => "error" in r).map((r) => r.case);
      expect(errors).toEqual([
        "chamfer too big",
        "wrong argument type",
        "unknown shape id",
      ]);
      expect(node.length).toBe(35);

      for (let i = 0; i < node.length; i++)
        expect(jsc[i], `case ${node[i].case}`).toEqual(node[i]);
      expect(jsc.length).toBe(node.length);
    }, 180000);
  },
);
