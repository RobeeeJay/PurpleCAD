// The app:// protocol handler's traversal guard (main.cjs).  Serving a file
// outside dist/ would hand the renderer arbitrary filesystem reads.
import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import path from "path";

const { resolveAppPath } = createRequire(import.meta.url)(
  "../../../electron/resolveAppPath.cjs",
);

const DIST = path.join("/app", "dist");

describe("resolveAppPath", () => {
  it("serves files inside dist", () => {
    expect(resolveAppPath(DIST, "app://./index.html")).toBe(
      path.join(DIST, "index.html"),
    );
    expect(resolveAppPath(DIST, "app://./assets/main.js")).toBe(
      path.join(DIST, "assets", "main.js"),
    );
  });

  it("dot segments with literal slashes are collapsed by the URL parser", () => {
    // The WHATWG parser resolves ../ (and even %2e%2e/) against the root
    // BEFORE the handler sees the pathname, so these stay inside dist.
    expect(resolveAppPath(DIST, "app://./../secret.txt")).toBe(
      path.join(DIST, "secret.txt"),
    );
    expect(resolveAppPath(DIST, "app://./%2e%2e/secret.txt")).toBe(
      path.join(DIST, "secret.txt"),
    );
  });

  it("refuses ..%2f traversal (survives URL normalisation)", () => {
    // An ENCODED slash blocks the parser's dot-segment collapse; it only
    // becomes ../ after decodeURIComponent — the real traversal vector.
    expect(resolveAppPath(DIST, "app://./..%2fsecret.txt")).toBe(null);
    expect(resolveAppPath(DIST, "app://./assets/..%2f..%2fsecret.txt")).toBe(
      null,
    );
    expect(resolveAppPath(DIST, "app://./..%2f..%2fetc%2fpasswd")).toBe(null);
  });

  it("refuses a sibling directory that shares the dist prefix", () => {
    // startsWith(dist) alone would admit /app/dist-evil/...
    expect(resolveAppPath(DIST, "app://./..%2fdist-evil/x.js")).toBe(null);
  });
});
