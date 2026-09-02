// Export a finished part to STEP so a human can open it and check the geometry
// is actually right.  Assertions can only check what someone thought to assert:
// this suite has twice built a part that passed every dimension check and was
// still wrong (a lid with no floor, screw holes over thin air). A real CAD file
// on disk is the backstop for that.
//
// Every test that BUILDS A SPECIFIC PART should end with a call to this.
//
// The file lands in test-results/parts/<name>.step -- inside Playwright's
// output dir, so it survives until the next run and no further -- and is also
// attached to the HTML report. The container lane mounts test-results, so a
// run there leaves the file on the host too.
import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";

const PARTS_DIR = path.join(process.cwd(), "test-results", "parts");

export async function exportPartStep(page, testInfo, name, itemIds) {
  const text = await page.evaluate(async (ids) => {
    const s = window.__store.getState();
    const items = s.items.filter((i) => ids.includes(i.id));
    if (items.length === 0) throw new Error("no items to export");
    // The real exporter: it sews each item's BAKED mesh, so what lands in the
    // file is the geometry on screen rather than a fresh recipe rebuild.
    return window.electronAPI.invokeOcc("exportSTEP", {
      items,
      allItems: s.items,
      precision: s.printPrecisionMm ?? 0.1,
    });
  }, itemIds);

  // A STEP file that is not a STEP file is worse than none -- it would sit
  // there looking like evidence.
  expect(typeof text, "STEP export returned no text").toBe("string");
  expect(text).toContain("ISO-10303-21");
  expect(text).toContain("END-ISO-10303-21");
  expect(
    text.length,
    "STEP file is too small to contain real geometry",
  ).toBeGreaterThan(2000);

  fs.mkdirSync(PARTS_DIR, { recursive: true });
  const file = path.join(PARTS_DIR, `${name}.step`);
  fs.writeFileSync(file, text, "utf8");
  await testInfo.attach(`${name}.step`, { path: file, contentType: "text/plain" });
  // eslint-disable-next-line no-console
  console.log(`[part] ${name} -> ${file} (${(text.length / 1024).toFixed(1)} kB)`);
  return file;
}
