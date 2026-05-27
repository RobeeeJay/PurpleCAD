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
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    open: true,
    // opencascade.js's WASM file is large (~63MB) and needs to be served
    // with the correct MIME type and no aggressive caching during dev.
    fs: { strict: false },
  },
  // Don't try to pre-bundle opencascade.js — it expects to load its own
  // .wasm via fetch/fs at runtime.
  optimizeDeps: { exclude: ["opencascade.js"] },
  // Make sure the .wasm file is treated as an asset and copied to the
  // build output preserving its filename so opencascade.js can find it.
  assetsInclude: ["**/*.wasm"],
  // Module worker (occ.worker.js) shares OCC code with the main bundle —
  // forcing ES output lets Rollup split chunks across the worker/main
  // boundary instead of bailing with the default IIFE format.
  // inlineDynamicImports collapses the worker's chunks into a single
  // file, sidestepping a Vite-4 bug where the OCC wasm asset gets
  // emitted twice (main + worker) and crashes build-import-analysis.
  worker: {
    format: "es",
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  test: {
    environment: "node",
    globals: true,
  },
});
