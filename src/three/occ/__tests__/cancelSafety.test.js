// Cancelling a recalculation mid-emboss took the whole app down: the
// cancelled boolean handed back the id of an EMPTY shape as if it had worked,
// the emboss went on to mesh it, and the mesher's edge pass dereferenced NULL.
// OCC turns such a fault into an exception only when an OCC_CATCH_SIGNALS
// handler is in scope; with none it prints "*** Abort ***" and exits, and the
// addon shares the process with the app.  A cancelled boolean now returns 0,
// an empty shape meshes to nothing, and every op runs under a handler.
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "module";
import { ensureOcc } from "../init.js";

const occ = createRequire(import.meta.url)(
  "../../../../native/occ-addon/build/Release/occ_addon.node",
);

beforeAll(async () => {
  await ensureOcc();
}, 60000);

describe("a cancelled boolean", () => {
  it("returns no result, and the next op runs normally", () => {
    const flag = new Int32Array(new SharedArrayBuffer(4));
    occ.setCancelBuffer(flag);
    const a = occ.makeCylinder(-1, 1, 2);
    const b = occ.makeBox(-0.2, -2, -0.2, 0.2, 2, 0.2);
    try {
      flag[0] = 1;
      const cancelled = occ.booleanOp([a, b], "difference");
      flag[0] = 0;
      expect(cancelled, "a cancelled boolean's result id").toBe(0);
      const next = occ.booleanOp([a, b], "difference");
      expect(occ.tessellate(next, 0.05).indices.length).toBeGreaterThan(0);
      occ.releaseShape(next);
    } finally {
      flag[0] = 0;
      occ.releaseShape(a);
      occ.releaseShape(b);
    }
  });
});
