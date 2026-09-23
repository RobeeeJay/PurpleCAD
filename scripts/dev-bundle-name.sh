#!/usr/bin/env bash
# Name the DEV app PurpleCAD in the menu bar, the Cmd+Tab switcher and the Dock.
#
# macOS reads all three from the RUNNING bundle's Info.plist -- CFBundleName and
# CFBundleDisplayName -- and ignores both `app.setName()` and the label on the
# first menu template item.  `electron .` runs node_modules/electron's own
# Electron.app, so the dev app calls itself Electron however the code names
# itself.  (The PACKAGED app is unaffected: electron-builder writes
# productName into its Info.plist, which is why the built app is already right.)
#
# Editing a signed bundle breaks its seal, and an arm64 Mac kills a bundle whose
# signature does not verify, so it is re-signed ad-hoc afterwards.  node_modules
# is disposable, so this runs from the dev scripts rather than once by hand.
set -euo pipefail

APP="node_modules/electron/dist/Electron.app"
NAME="PurpleCAD"
PLIST="$APP/Contents/Info.plist"

[ -f "$PLIST" ] || exit 0 # no dev Electron installed: nothing to name

current=$(/usr/libexec/PlistBuddy -c "Print :CFBundleName" "$PLIST" 2>/dev/null || echo "")
[ "$current" = "$NAME" ] && exit 0 # already done; re-signing again costs seconds

for key in CFBundleName CFBundleDisplayName; do
  /usr/libexec/PlistBuddy -c "Set :$key $NAME" "$PLIST" 2>/dev/null ||
    /usr/libexec/PlistBuddy -c "Add :$key string $NAME" "$PLIST"
done

codesign --force --sign - "$APP" 2>/dev/null ||
  echo "[dev-bundle-name] could not re-sign $APP; it may refuse to launch" >&2

# LaunchServices caches the old name, and the switcher keeps showing it.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$APP" 2>/dev/null || true

echo "[dev-bundle-name] dev Electron now identifies as $NAME"
