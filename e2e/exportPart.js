// Export a finished part to STL so a human can open it and check the geometry
// is actually right.  Assertions can only check what someone thought to assert:
// this suite has twice built a part that passed every dimension check and was
// still wrong (a lid with no floor, screw holes over thin air). A real mesh
// file on disk is the backstop for that.
//
// Every test that BUILDS A SPECIFIC PART should end with a call to this.
//
// STL rather than STEP so it opens in macOS Preview with no CAD tool -- the
// point is that someone actually LOOKS at it, and a format that needs extra
// software gets looked at less.
//
// The file lands in test-results/parts/<name>.stl -- inside Playwright's output
// dir, so it survives until the next run and no further -- and is attached to
// the HTML report. The container lane mounts test-results, so a run there
// leaves the file on the host too.
import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";

const PARTS_DIR = path.join(process.cwd(), "test-results", "parts");

export async function exportPartStl(page, testInfo, name, itemIds) {
  const bytes = await page.evaluate(async (ids) => {
    const s = window.__store.getState();
    const items = s.items.filter((i) => ids.includes(i.id));
    if (items.length === 0) throw new Error("no items to export");
    // The real exporter: it sews each item's BAKED mesh, so what lands in the
    // file is the geometry that was on screen, not a fresh recipe rebuild.
    const buf = await window.electronAPI.invokeOcc("exportSTL", {
      items,
      allItems: s.items,
      precision: s.printPrecisionMm ?? 0.1,
    });
    // Cross the IPC/evaluate boundary as a plain array.
    return Array.from(new Uint8Array(buf.buffer ?? buf, buf.byteOffset ?? 0, buf.byteLength));
  }, itemIds);

  const buf = Buffer.from(bytes);
  // A file that is not a real STL is worse than none -- it would sit there
  // looking like evidence. Binary STL: 80-byte header, uint32 triangle count,
  // then 50 bytes per triangle.
  expect(buf.length, "STL export returned nothing").toBeGreaterThan(84);
  const triCount = buf.readUInt32LE(80);
  expect(triCount, "STL has no triangles").toBeGreaterThan(0);
  expect(
    buf.length,
    `STL length does not match its own triangle count (${triCount})`,
  ).toBe(84 + triCount * 50);

  fs.mkdirSync(PARTS_DIR, { recursive: true });
  const file = path.join(PARTS_DIR, `${name}.stl`);
  fs.writeFileSync(file, buf);
  await testInfo.attach(`${name}.stl`, { path: file, contentType: "model/stl" });
  // eslint-disable-next-line no-console
  console.log(
    `[part] ${name} -> ${file} (${triCount} tris, ${(buf.length / 1024).toFixed(1)} kB)`,
  );
  return { file, triCount };
}
