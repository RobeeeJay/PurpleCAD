#!/usr/bin/env bash
# Launch the packaged app.
#
# ELECTRON_RUN_AS_NODE is the reason this exists. VS Code's integrated terminal
# (and anything else running under Electron) exports it, `open` passes the
# caller's environment straight through, and an Electron binary that sees it
# runs as plain Node: the packaged app exits in about a second with no window
# and NO MESSAGE -- main.cjs's guard cannot fire, because packaged
# Electron-as-Node never loads the app's main script at all.
set -euo pipefail

case "$(uname -s)" in
  Darwin)
    arch=$([ "$(uname -m)" = "arm64" ] && echo arm64 || echo x64)
    app="release/mac-$arch/PurpleCAD.app"
    [ -d "$app" ] || {
      echo "No packaged app at $app -- run 'npm run electron:build' first." >&2
      exit 1
    }
    exec env -u ELECTRON_RUN_AS_NODE open -n "$app"
    ;;
  *)
    echo "Only macOS for now; run the built app under release/ directly," >&2
    echo "with ELECTRON_RUN_AS_NODE unset." >&2
    exit 1
    ;;
esac
