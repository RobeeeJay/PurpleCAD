// Bundles the MCP shim (mcp/purplecad-mcp.mjs) and the SDK it uses into one
// file, which electron-builder copies into the app's resources.  A user then
// runs it with the app's own executable as Node, needing neither a Node
// install nor a checkout -- and the SDK's dependency tree stays out of the
// packaged app's node_modules, where nothing else used it.
import fs from "node:fs";
import { build } from "vite";

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));

await build({
  configFile: false,
  publicDir: false,
  logLevel: "warn",
  define: { __PURPLECAD_VERSION__: JSON.stringify(version) },
  ssr: { noExternal: true },
  build: {
    ssr: "mcp/purplecad-mcp.mjs",
    outDir: "build/mcp",
    emptyOutDir: true,
    target: "node18",
    minify: false,
    rollupOptions: { output: { format: "es", entryFileNames: "[name].mjs" } },
  },
});
console.log(`[build-mcp] build/mcp/purplecad-mcp.mjs (${version})`);
