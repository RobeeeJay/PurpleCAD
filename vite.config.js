import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve version + git commit at config-load time so they're available
// as compile-time string constants in the bundle.  Both fall back to a
// safe placeholder when the surrounding environment can't supply them
// (no .git directory, no package.json, etc.) so the build never breaks
// on a misconfigured CI box.
function readVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "package.json"), "utf8"),
    );
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function readGitCommit() {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

// Versions for the About dialog. Pulled from package.json so they stay in
// sync with what's actually installed; OpenCASCADE isn't an npm package
// (native addon, see native/occ-addon) so its version is hardcoded to match
// the CLAUDE.md-documented build target.
function readDependencyVersions() {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "package.json"), "utf8"),
    );
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const pick = (name) => deps[name]?.replace(/^[\^~]/, "") || "unknown";
    return {
      react: pick("react"),
      three: pick("three"),
      "three-gpu-pathtracer": pick("three-gpu-pathtracer"),
      electron: pick("electron"),
      OpenCASCADE: "8.0.0",
    };
  } catch {
    return {};
  }
}

export default defineConfig({
  // Relative `base` so the built bundle loads under Electron's
  // `file://` scheme (and from any subpath when served).  Vite's
  // default of "/" works for a web server but breaks file-system
  // loading: index.html ends up requesting /assets/... which file://
  // resolves to the volume root.
  base: "./",
  plugins: [react()],
  define: {
    // JSON.stringify wraps the value as a string literal in the bundle
    // (Vite's `define` replaces verbatim, so raw strings would become
    // identifiers).
    __APP_VERSION__: JSON.stringify(readVersion()),
    __GIT_COMMIT__: JSON.stringify(readGitCommit()),
    __DEPENDENCY_VERSIONS__: JSON.stringify(readDependencyVersions()),
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    fs: { strict: false },
  },
  build: {
    // occOps.js uses Node.js createRequire for the native C++ addon — it must
    // not be bundled into the browser/renderer chunk.  In Electron the renderer
    // never reaches the occOps import path (all OCC calls go through IPC);
    // in Node/vitest the module is resolved directly from the source tree.
    rollupOptions: {
      external: (id) => /\/occOps\.js$/.test(id),
    },
  },
  test: {
    environment: "node",
    globals: true,
  },
});
