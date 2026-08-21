#!/usr/bin/env bash
# Full e2e verification inside the Linux container: build the addon against
# the image's OCC, rebuild better-sqlite3 for this Electron/arch, build the
# renderer with the E2E hook, then run Playwright under xvfb.
set -euo pipefail

npm run addon:build
npm run sqlite:rebuild
VITE_E2E=1 npx vite build
exec ./scripts/with-display.sh npx playwright test "$@"
