# Third-party licenses

PurpleCAD itself is licensed under the PolyForm Noncommercial License 1.0.0
(`LICENSE.md`). The components below are not: each remains under its own
license, as recorded in its installed package's manifest. Regenerate the
version numbers after a dependency update (`node_modules/<name>/package.json`
is the source of truth).

## Runtime dependencies

| Package | Version | License | Source |
| --- | --- | --- | --- |
| better-sqlite3 | 13.0.3 | MIT | https://github.com/WiseLibs/better-sqlite3 |
| decimal.js | 10.6.0 | MIT | https://github.com/MikeMcl/decimal.js |
| opentype.js | 2.0.0 | MIT | https://github.com/opentypejs/opentype.js |
| react | 19.3.1 | MIT | https://react.dev/ |
| react-dom | 19.3.1 | MIT | https://react.dev/ |
| three | 0.187.0 | MIT | https://threejs.org/ |
| three-gpu-pathtracer | 0.0.28 | MIT | https://github.com/gkjohnson/three-gpu-pathtracer |
| three-mesh-bvh | 0.9.18 | MIT | https://github.com/gkjohnson/three-mesh-bvh |
| zustand | 5.1.0 | MIT | https://github.com/pmndrs/zustand |

## Native geometry kernel

| Component | Version | License | Source |
| --- | --- | --- | --- |
| Open CASCADE Technology (OCCT) | 8.0.1 (8.0.0 / 7.9.0 supported) | LGPL-2.1-only, with the OCCT LGPL exception | https://github.com/Open-Cascade-SAS/OCCT |
| meshoptimizer (vendored, `native/occ-addon/third_party/meshoptimizer`) | 1.3 (`9e1f07b`) | MIT | https://github.com/zeux/meshoptimizer |
| node-addon-api | 8.9.2 | MIT | https://github.com/nodejs/node-addon-api |
| cmake-js (build only) | 8.0.0 | MIT | https://github.com/cmake-js/cmake-js |

OCCT is dynamically linked by the native addon (`native/occ-addon`), which
satisfies the LGPL's relinking requirement; the OCCT exception additionally
permits use in proprietary applications. See
https://dev.opencascade.org/resources/licensing for the exception text.

The packaged macOS app bundles the OCCT shared libraries
(`Contents/Resources/occ-libs`, see `scripts/afterPack.cjs`). Distributing
them carries the LGPL-2.1's conditions: ship this notice and the LGPL text
with the release, and make the exact OCCT source used available alongside
it (upstream tag `V8_0_1`, the one `Containerfile.e2e` and the addon CI build
clone). The LGPL 2.1 text and the Open CASCADE exception, taken from that tag,
are in `licenses/occt/`; the packaged app carries them, with this file,
`LICENSE.md` and `TRADEMARKS.md`, in its resources. The exception asks for
"prominent notice in supporting documentation" that the software uses OCCT --
the README's License section gives it.

meshoptimizer is compiled into the addon from its unmodified release sources;
its MIT notice is `native/occ-addon/third_party/meshoptimizer/LICENSE.md`.

## Vendored code and assets

| Item | Origin | License |
| --- | --- | --- |
| `src/three/vendor/TTFLoader.js` | three.js examples (adapted: local opentype.js import) | MIT |
| `src/assets/fonts/helvetiker_*.typeface.json` | three.js examples fonts; MgOpen Moderna by Magenta Ltd, renamed | MgOpen font licence (permissive; modified versions must be renamed) — http://www.ellak.gr/fonts/MgOpen/license.html |
| `src/assets/fonts/optimer_regular.typeface.json` | three.js examples fonts; MgOpen Cosmetica by Magenta Ltd, renamed | MgOpen font licence, as above |
| `src/assets/fonts/gentilis_regular.typeface.json` | three.js examples fonts; Gentium by SIL International, renamed (Reserved Font Name "Gentium") | SIL Open Font License 1.1 |

Each font's full licence text is embedded in its JSON
(`original_font_information.license_description`).

## Bundled into the MCP shim

The MCP shim ships inside the app as one bundled file
(`resources/mcp/purplecad-mcp.mjs`, built by `scripts/build-mcp.mjs`), so
these packages are development dependencies of the repository but their code
is distributed in every release. List what the bundle holds after an update
with `grep -o "node_modules/[^/]*" build/mcp/purplecad-mcp.mjs | sort -u`.

| Package | Version | License | Source |
| --- | --- | --- | --- |
| @modelcontextprotocol/sdk | 1.32.2 | MIT | https://modelcontextprotocol.io |
| ajv | 8.20.0 | MIT | https://ajv.js.org |
| ajv-formats | 3.0.1 | MIT | https://github.com/ajv-validator/ajv-formats |
| fast-deep-equal | 3.1.3 | MIT | https://github.com/epoberezkin/fast-deep-equal |
| fast-uri | 3.1.9 | BSD-3-Clause | https://github.com/fastify/fast-uri |
| json-schema-traverse | 1.0.0 | MIT | https://github.com/epoberezkin/json-schema-traverse |
| zod | 4.6.7 | MIT | https://zod.dev |

## Development dependencies

| Package | Version | License | Source |
| --- | --- | --- | --- |
| @electron/rebuild | 4.2.1 | MIT | https://github.com/electron/rebuild |
| @playwright/test | 1.65.0 | Apache-2.0 | https://playwright.dev |
| @vitejs/plugin-react | 6.3.0 | MIT | https://github.com/vitejs/vite-plugin-react |
| @vitest/coverage-v8 | 5.1.0 | MIT | https://vitest.dev |
| concurrently | 10.0.7 | MIT | https://github.com/open-cli-tools/concurrently |
| electron | 45.3.0 | MIT | https://github.com/electron/electron |
| electron-builder | 26.18.0 | MIT | https://github.com/electron-userland/electron-builder |
| electron-reloader | 2.0.0 | MIT | https://github.com/sindresorhus/electron-reloader |
| prettier | 3.10.0 | MIT | https://github.com/prettier/prettier |
| vite | 8.3.8 | MIT | https://vite.dev |
| vitest | 5.1.0 | MIT | https://vitest.dev |
| wait-on | 9.5.1 | MIT | https://github.com/jeffbski/wait-on |

Electron itself bundles Chromium and Node.js; their licenses ship inside the
packaged app (`LICENSES.chromium.html` et al. in the Electron distribution).

Transitive npm dependencies carry their own licenses. Checked against the
installed production tree (`npm ls --omit=dev --all`): 12 packages, all
MIT. (It was 83 while the MCP SDK was a runtime dependency, and 50 while
better-sqlite3 still pulled in `prebuild-install`; version 13 ships its
prebuilt binaries itself.) No
GPL, LGPL or other copyleft package is among them; OCCT (above) is the only
copyleft component. Re-run the check after a dependency update; for a packaged
release, `npx license-checker --production --summary` gives the same view.
