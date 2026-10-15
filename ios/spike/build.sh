#!/usr/bin/env bash
# iPad port, Phase 0: build OCCT 8.0.1 for iOS (simulator and device) and the
# spike for macOS, the iOS simulator and the device, then run it on macOS and
# in the simulator.  See README.md for what it measures and the results.
#
#   ios/spike/build.sh [outdir]      (default: ./build-spike)
#
# OCCT is cloned to ~/occt-src-8.0.1 and installed beside the macOS build the
# addon uses (~/occ-8.0.1-arm64): ~/occ-8.0.1-iossim and ~/occ-8.0.1-ios.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
out="${1:-$root/build-spike}"
mkdir -p "$out"

# The arm64 tools by full path: an Intel Homebrew cmake/ninja first on PATH
# can't run on this Mac (see CLAUDE.md, "npm run build goes through build.sh").
CMAKE=/opt/homebrew/bin/cmake
NINJA=/opt/homebrew/bin/ninja

src="$HOME/occt-src-8.0.1"
[ -d "$src" ] || git clone --depth 1 --branch V8_0_1 \
  https://github.com/Open-Cascade-SAS/OCCT.git "$src"

# The container's module set (Containerfile.e2e), for iOS, as shared
# libraries -- OCCT is LGPL and may only be linked dynamically.  The
# DataExchange modules pull in TKService, whose Objective-C sources need
# Foundation; OCCT's iOS link line doesn't add it, so the shared-library link
# flags do.
build_occt() { # <sysroot> <install dir>
  local sdk="$1" prefix="$2" bdir="$HOME/occt-build-$1"
  [ -f "$prefix/lib/libTKernel.8.0.1.dylib" ] && return
  "$CMAKE" -S "$src" -B "$bdir" -G Ninja -DCMAKE_MAKE_PROGRAM="$NINJA" \
    -DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_SYSROOT="$sdk" \
    -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=17.0 \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" \
    -DBUILD_LIBRARY_TYPE=Shared \
    -DCMAKE_SHARED_LINKER_FLAGS="-framework Foundation -framework UIKit" \
    -DBUILD_MODULE_FoundationClasses=ON -DBUILD_MODULE_ModelingData=ON \
    -DBUILD_MODULE_ModelingAlgorithms=ON -DBUILD_MODULE_DataExchange=ON \
    -DBUILD_MODULE_Visualization=OFF -DBUILD_MODULE_Draw=OFF \
    -DBUILD_MODULE_ApplicationFramework=OFF \
    -DUSE_FREETYPE=OFF -DUSE_TK=OFF -DUSE_OPENGL=OFF
  "$CMAKE" --build "$bdir" --parallel "$(sysctl -n hw.ncpu)"
  "$CMAKE" --install "$bdir"
}
build_occt iphonesimulator "$HOME/occ-8.0.1-iossim"
build_occt iphoneos "$HOME/occ-8.0.1-ios"

LIBS="-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKGeomAlgo
  -lTKTopAlgo -lTKPrim -lTKShHealing -lTKBool -lTKBO -lTKMesh"
FLAGS="-std=c++17 -O2 -fobjc-arc -Wno-deprecated-declarations
  -Wno-#pragma-messages -framework Foundation -framework JavaScriptCore"
spike() { # <sdk> <target flags> <occt prefix> <rpath> <out>
  # shellcheck disable=SC2086
  xcrun --sdk "$1" clang++ $2 $FLAGS "$here/spike.mm" \
    -I"$3/include/opencascade" -L"$3/lib" $LIBS -Wl,-rpath,"$4" -o "$5"
}
spike macosx "-arch arm64 -mmacosx-version-min=14.0" \
  "$HOME/occ-8.0.1-arm64" "$HOME/occ-8.0.1-arm64/lib" "$out/spike-macos"
spike iphonesimulator "-target arm64-apple-ios17.0-simulator" \
  "$HOME/occ-8.0.1-iossim" "$HOME/occ-8.0.1-iossim/lib" "$out/spike-iossim"
spike iphoneos "-target arm64-apple-ios17.0" \
  "$HOME/occ-8.0.1-ios" "@executable_path/Frameworks" "$out/spike-ios"

node "$here/mesh.js" "$out/ms2.bin"

echo "== macOS"
for m in native jsc; do "$out/spike-macos" "$out/ms2.bin" "$m"; done

# Any booted iPad simulator, else the first available one.
dev="$(xcrun simctl list devices booted | grep -m1 iPad | grep -oE '[0-9A-F-]{36}' || true)"
if [ -z "$dev" ]; then
  dev="$(xcrun simctl list devices available | grep -m1 iPad | grep -oE '[0-9A-F-]{36}')"
  xcrun simctl boot "$dev"
  xcrun simctl bootstatus "$dev" -b >/dev/null
fi
echo "== iOS simulator ($dev)"
for m in native jsc; do
  xcrun simctl spawn "$dev" "$out/spike-iossim" "$out/ms2.bin" "$m"
done
echo "spike-ios (device build) linked: $out/spike-ios"
