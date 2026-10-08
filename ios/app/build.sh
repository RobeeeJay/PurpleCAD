#!/usr/bin/env bash
# Builds the iPad app: the renderer bundle (vite), then the app (xcodebuild).
#
#   ios/app/build.sh sim               build for the iOS simulator
#   ios/app/build.sh device <UDID>     build for a connected iPad
#
# Prints the .app path last.  OCCT for iOS comes from ios/spike/build.sh
# (~/occ-8.0.1-ios, ~/occ-8.0.1-iossim).  The renderer bundle is built
# without VITE_E2E: the app ships the real renderer.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
target="${1:-sim}"

(cd "$root" && npx vite build >/dev/null)

out="$here/build"
case "$target" in
  sim)
    xcodebuild -project "$here/PurpleCAD.xcodeproj" -scheme PurpleCAD \
      -configuration Release -sdk iphonesimulator \
      -destination "generic/platform=iOS Simulator" \
      SYMROOT="$out" build -quiet
    echo "$out/Release-iphonesimulator/PurpleCAD.app"
    ;;
  device)
    udid="${2:?usage: build.sh device <UDID>}"
    # A destination, not -sdk iphoneos: it lets Xcode add the iPad to the
    # signing profile (ios/spike/README.md, "Running on a device").
    xcodebuild -project "$here/PurpleCAD.xcodeproj" -scheme PurpleCAD \
      -configuration Release -destination "id=$udid" \
      -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
      SYMROOT="$out" build -quiet
    echo "$out/Release-iphoneos/PurpleCAD.app"
    ;;
  *)
    echo "usage: build.sh sim | device <UDID>" >&2
    exit 2
    ;;
esac
