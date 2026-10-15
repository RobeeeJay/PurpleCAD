# meshoptimizer (vendored)

- Upstream: https://github.com/zeux/meshoptimizer
- Release: v1.3, commit `9e1f07b159d3cb777f1c67ed31fc11fd117986f4`
- Licence: MIT (`LICENSE.md`)
- Contents: `src/` exactly as released -- unmodified.

Vendored rather than fetched at build time so the container image and the
packaged app build reproducibly offline (see CLAUDE.md, "Third-party libraries:
native C++ over WASM").  Only the translation units the addon uses are compiled;
they are listed in `native/occ-addon/CMakeLists.txt`.

To update: replace `src/` and `LICENSE.md` with a new release's, update the
release and commit above, rebuild the addon, and run both the container suite
(gcc) and the macOS e2e suite (clang).
