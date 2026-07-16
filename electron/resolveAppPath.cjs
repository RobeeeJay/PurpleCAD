// Resolve an app://./<path> request to a file inside the dist directory, or
// null when the path escapes it.  Extracted from main.cjs's protocol handler
// so the traversal guard is unit-testable (main.cjs only loads under
// Electron).  Note the separator suffix: a bare startsWith(dist) would admit
// a SIBLING directory like "dist-evil".

const path = require("path");

function resolveAppPath(distDir, requestUrl) {
  const url = new URL(requestUrl);
  // The host part of `app://./index.html` is "." — pathname carries the file.
  const pathname = decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(distDir, pathname));
  const root = path.normalize(distDir);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) return null;
  return filePath;
}

module.exports = { resolveAppPath };
