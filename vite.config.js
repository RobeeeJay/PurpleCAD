import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    open: true,
    // opencascade.js's WASM file is large (~63MB) and needs to be served
    // with the correct MIME type and no aggressive caching during dev.
    fs: { strict: false }
  },
  // Don't try to pre-bundle opencascade.js — it expects to load its own
  // .wasm via fetch/fs at runtime.
  optimizeDeps: { exclude: ["opencascade.js"] },
  // Make sure the .wasm file is treated as an asset and copied to the
  // build output preserving its filename so opencascade.js can find it.
  assetsInclude: ["**/*.wasm"],
  test: {
    environment: 'node',
    globals: true,
  },
})
