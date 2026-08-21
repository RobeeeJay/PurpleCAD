# Third-party licenses

Licenses of PurpleCAD's dependencies, as recorded in each installed
package's manifest. Regenerate the version numbers after a dependency
update (`node_modules/<name>/package.json` is the source of truth).

## Runtime dependencies

| Package | Version | License | Source |
| --- | --- | --- | --- |
| better-sqlite3 | 12.11.1 | MIT | https://github.com/WiseLibs/better-sqlite3 |
| decimal.js | 10.6.0 | MIT | https://github.com/MikeMcl/decimal.js |
| opentype.js | 1.3.4 | MIT | https://github.com/opentypejs/opentype.js |
| react | 19.2.7 | MIT | https://react.dev/ |
| react-dom | 19.2.7 | MIT | https://react.dev/ |
| three | 0.185.1 | MIT | https://threejs.org/ |
| three-bvh-csg | 0.0.18 | MIT | https://github.com/gkjohnson/three-bvh-csg |
| three-gpu-pathtracer | 0.0.24 | MIT | https://github.com/gkjohnson/three-gpu-pathtracer |
| zustand | 5.0.14 | MIT | https://github.com/pmndrs/zustand |

## Native geometry kernel

| Component | Version | License | Source |
| --- | --- | --- | --- |
| Open CASCADE Technology (OCCT) | 8.0.1 (8.0.0 / 7.9.0 supported) | LGPL-2.1-only, with the OCCT LGPL exception | https://github.com/Open-Cascade-SAS/OCCT |
| node-addon-api | ^8.3.1 | MIT | https://github.com/nodejs/node-addon-api |
| cmake-js (build only) | ^7.3.0 | MIT | https://github.com/cmake-js/cmake-js |

OCCT is dynamically linked by the native addon (`native/occ-addon`), which
satisfies the LGPL's relinking requirement; the OCCT exception additionally
permits use in proprietary applications. See
https://dev.opencascade.org/resources/licensing for the exception text.

## Vendored code and assets

| Item | Origin | License |
| --- | --- | --- |
| `src/three/vendor/TTFLoader.js` | three.js examples (adapted: local opentype.js import) | MIT |
| `src/assets/fonts/helvetiker_*.typeface.json` | three.js examples fonts (Helvetiker) | MIT-style (typeface conversion of the Helvetiker font) |
| `src/assets/fonts/optimer_regular.typeface.json` | three.js examples fonts (Optimer) | MIT-style (three.js examples distribution) |
| `src/assets/fonts/gentilis_regular.typeface.json` | three.js examples fonts (Gentilis / Gentium-derived) | SIL Open Font License 1.1 |

## Development dependencies

| Package | Version | License | Source |
| --- | --- | --- | --- |
| @electron/rebuild | 4.2.0 | MIT | https://github.com/electron/rebuild |
| @playwright/test | 1.61.1 | Apache-2.0 | https://playwright.dev |
| @vitejs/plugin-react | 6.0.3 | MIT | https://github.com/vitejs/vite-plugin-react |
| @vitest/coverage-v8 | 4.1.10 | MIT | https://vitest.dev |
| concurrently | 10.0.3 | MIT | https://github.com/open-cli-tools/concurrently |
| electron | 43.1.0 | MIT | https://github.com/electron/electron |
| electron-builder | 26.15.3 | MIT | https://github.com/electron-userland/electron-builder |
| electron-reloader | 1.2.3 | MIT | https://github.com/sindresorhus/electron-reloader |
| prettier | 3.9.5 | MIT | https://github.com/prettier/prettier |
| vite | 8.1.4 | MIT | https://vite.dev |
| vitest | 4.1.10 | MIT | https://vitest.dev |
| wait-on | 9.0.10 | MIT | https://github.com/jeffbski/wait-on |

Electron itself bundles Chromium and Node.js; their licenses ship inside the
packaged app (`LICENSES.chromium.html` et al. in the Electron distribution).

Transitive npm dependencies carry their own licenses — enumerate them with
`npx license-checker --summary` against the installed tree when a full
manifest is needed (e.g. for a packaged release).
