#!/usr/bin/env bash
# Rebuilds and relaunches the Electron dev app, for the Stop hook.
#
# Only does anything when app source changed since the last relaunch, so a
# turn that answered a question or only touched tests leaves the running app
# alone. The renderer is always rebuilt (dist/ is what `electron .` loads);
# the addon is rebuilt only when its own sources changed, since that is the
# slow step.
set -uo pipefail
cd "$(dirname "$0")/.."

STAMP=.claude/.last-relaunch
LOG=.claude/relaunch.log
SRC_DIRS=(src electron native/occ-addon/src native/occ-addon/CMakeLists.txt)

changed() { # changed <dir...> -- anything newer than the stamp?
  [ -e "$STAMP" ] || return 0
  [ -n "$(find "$@" -type f -newer "$STAMP" -not -path "*/build/*" 2>/dev/null | head -1)" ]
}

changed "${SRC_DIRS[@]}" || exit 0

{
  date
  if changed native/occ-addon/src native/occ-addon/CMakeLists.txt; then
    npm run addon:build || exit 1
  fi
  npx vite build || exit 1
} >>"$LOG" 2>&1 || {
  echo '{"systemMessage":"PurpleCAD relaunch: build failed, see .claude/relaunch.log"}'
  exit 0
}

# The dev bundle calls itself Electron in the menu bar and Cmd+Tab until its
# Info.plist is patched, and a reinstall of node_modules undoes that.
./scripts/dev-bundle-name.sh >>"$LOG" 2>&1 || true

# Kill only THIS checkout's dev app; the packaged PurpleCAD.app is left alone.
pkill -f "$PWD/node_modules/electron/dist/Electron.app" 2>/dev/null
# ELECTRON_RUN_AS_NODE would make it exit with no window.
(env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron . >>"$LOG" 2>&1 &) &
touch "$STAMP"
echo '{"systemMessage":"PurpleCAD dev app relaunched with this change."}'
