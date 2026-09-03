// Save a finished part as a .pcad document so a human can open it IN PurpleCAD
// and check the geometry is actually right.  Assertions can only check what
// someone thought to assert: this suite has twice built a part that passed
// every dimension check and was still wrong (a lid with no floor, screw holes
// over thin air). A loadable document is the backstop for that.
//
// Every test that BUILDS A SPECIFIC PART should call this, and then verify it
// round-trips with `importPartPcad`.
//
// .pcad rather than a mesh format because it carries the TIMELINE, not a
// triangle soup: reopening it gives back the sketches, the features and their
// parameters, so the part can be inspected, edited and re-run.
//
// It goes through the app's real Save button rather than assembling the JSON
// here, so the test exercises the same path a user takes -- including
// packHistory, which compresses the dense meshes that once made documents
// hundreds of MB.
//
// Files land in test-results/parts/<name>.pcad, inside Playwright's output dir,
// so they survive until the next run and no further. The container lane mounts
// test-results, so a run there leaves them on the host too.
import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";

const PARTS_DIR = path.join(process.cwd(), "test-results", "parts");

export async function exportPartPcad(page, testInfo, name) {
  // Capture the Blob itself, not the URL: handleSave calls revokeObjectURL
  // immediately after click(), so a blob: URL read afterwards is already dead
  // ("Failed to fetch"). Patching createObjectURL keeps a reference to the
  // Blob that outlives the revoke.
  await page.evaluate(() => {
    window.__pcadBlob = null;
    if (!window.__pcadPatched) {
      const origCreate = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (obj) => {
        if (obj instanceof Blob) window.__pcadBlob = obj;
        return origCreate(obj);
      };
      const origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        // Swallow the download itself; the Blob above is what we want.
        if (this.download && String(this.href).startsWith("blob:")) return;
        return origClick.apply(this, arguments);
      };
      window.__pcadPatched = true;
    }
  });

  await page.locator('button[title="Save / Export"]').click();
  await page
    .locator('button[title="Save the document as a portable .pcad file"]')
    .click();

  const text = await page.evaluate(async () => {
    if (!window.__pcadBlob) throw new Error("Save produced no document");
    return await window.__pcadBlob.text();
  });

  // A file that is not a loadable document is worse than none -- it would sit
  // there looking like evidence.
  const doc = JSON.parse(text);
  expect(doc.version, "no version stamp").toBeGreaterThanOrEqual(1);
  expect(Array.isArray(doc.history), "history is not an array").toBe(true);
  expect(doc.history.length, "history is empty").toBeGreaterThan(1);
  // loadDocument rejects the pre-v1 shape outright; make sure we never write it.
  expect(doc.history[0].items, "old-format history entry").toBeUndefined();

  fs.mkdirSync(PARTS_DIR, { recursive: true });
  const file = path.join(PARTS_DIR, `${name}.pcad`);
  fs.writeFileSync(file, text, "utf8");
  await testInfo.attach(`${name}.pcad`, {
    path: file,
    contentType: "application/json",
  });
  // eslint-disable-next-line no-console
  console.log(
    `[part] ${name} -> ${file} (${doc.history.length} timeline steps, ${(text.length / 1024).toFixed(1)} kB)`,
  );
  return { file, steps: doc.history.length };
}

// Load a saved .pcad back into the running app. This is the check that matters:
// a document that cannot be reopened is not a deliverable. Clobbers the current
// document, so call it from the LAST test in a spec.
export async function importPartPcad(page, file) {
  const text = fs.readFileSync(file, "utf8");
  await page.evaluate((t) => {
    window.__store.getState().loadDocument(JSON.parse(t));
  }, text);
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const s = window.__store.getState();
    const solids = s.items.filter((i) => i.geometryData?.positions?.length);
    return {
      items: s.items.length,
      solids: solids.length,
      steps: s.history.length,
      tris: solids.reduce((n, i) => n + i.geometryData.indices.length / 3, 0),
    };
  });
}
