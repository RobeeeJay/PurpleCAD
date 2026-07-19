#!/usr/bin/env bash
# Run a command under a virtual X display when one is needed but none exists.
#
# The Electron e2e tests open a real renderer window, so on headless Linux they
# need an X server — xvfb.  This wrapper runs the command under `xvfb-run` when
# it's available (headless Linux/CI), and directly otherwise (macOS, or any host
# that already has a display).  So `xvfb-run … <tests>` is used wherever xvfb
# exists, without breaking platforms that don't ship it.
set -euo pipefail

if [ -n "${DISPLAY:-}" ]; then
  # A display is already present (e.g. a desktop session) — use it as-is.
  exec "$@"
elif command -v xvfb-run >/dev/null 2>&1; then
  # Headless with xvfb available: give the command its own virtual framebuffer.
  # -a picks a free server number; the screen is big enough for the app window.
  exec xvfb-run -a --server-args="-screen 0 1600x1000x24" "$@"
else
  # No xvfb (e.g. macOS) — the platform provides a window server itself.
  exec "$@"
fi
