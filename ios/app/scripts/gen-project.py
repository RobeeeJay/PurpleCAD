#!/usr/bin/env python3
"""Writes ios/app/PurpleCAD.xcodeproj/project.pbxproj.

The project is generated rather than edited in Xcode so it stays reviewable,
and so its source list can be checked against the addon's CMakeLists: the app
compiles the OCC core straight from native/occ-addon/src.  Re-run after adding
a source file:  python3 ios/app/scripts/gen-project.py

The simulator build is arm64 only (EXCLUDED_ARCHS): OCCT for the simulator
is built for arm64, and a generic simulator destination otherwise links
x86_64 too and fails on every OCCT symbol.
"""
import hashlib
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(APP))

def oid(*parts):
    return hashlib.md5("/".join(parts).encode()).hexdigest()[:24].upper()

SWIFT = ["AppDelegate.swift", "WebViewController.swift", "AppSchemeHandler.swift",
         "ScriptThread.swift", "OccHost.swift", "DbHost.swift"]
# The OCC core, exactly as the addon's CMakeLists lists it (checked below).
cmake = open(os.path.join(ROOT, "native/occ-addon/CMakeLists.txt")).read()
core_block = re.search(r"add_library\(occ_core OBJECT(.*?)\)", cmake, re.S).group(1)
CORE = []
for tok in core_block.split():
    tok = tok.replace("${MESHOPT_DIR}", "third_party/meshoptimizer/src")
    CORE.append("../../native/occ-addon/" + tok)
CORE.append("../../native/occ-addon/src/jsc_binding.cc")
for f in CORE:
    assert os.path.exists(os.path.join(APP, f)), f
OCC_LIBS = re.search(r"set\(OCC_LIBS(.*?)\)", cmake, re.S).group(1).split()

files = [(f"PurpleCAD/{s}", "sourcecode.swift", "<group>", s) for s in SWIFT]
files += [(c, "sourcecode.cpp.cpp", "SOURCE_ROOT", os.path.basename(c)) for c in CORE]
files.append(("PurpleCAD/Bridging-Header.h", "sourcecode.c.h", "<group>", "Bridging-Header.h"))

PROJ, TARGET, MAIN_GRP, SRC_GRP, CORE_GRP, PROD_GRP = (oid(x) for x in
    ["project", "target", "main", "srcgroup", "coregroup", "products"])
PRODUCT = oid("product")
P_SRC, P_FW, P_WEB, P_OCCT = (oid("phase", x) for x in ["sources", "frameworks", "web", "occt"])
CL_PROJ, CL_TARGET = oid("cl", "project"), oid("cl", "target")
BC_PROJ, BC_TARGET = oid("bc", "project"), oid("bc", "target")

def fref(path):
    return oid("file", path)

def bfile(path):
    return oid("build", path)

out = []
w = out.append
w("// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {\n\t};\n\tobjectVersion = 56;\n\tobjects = {\n")
w("\n/* Begin PBXBuildFile section */\n")
for path, typ, tree, name in files:
    if typ.endswith(".h"):
        continue
    w(f"\t\t{bfile(path)} /* {name} in Sources */ = {{isa = PBXBuildFile; fileRef = {fref(path)} /* {name} */; }};\n")
w("/* End PBXBuildFile section */\n")

w("\n/* Begin PBXFileReference section */\n")
for path, typ, tree, name in files:
    rel = path if tree == "SOURCE_ROOT" else name
    w(f'\t\t{fref(path)} /* {name} */ = {{isa = PBXFileReference; lastKnownFileType = {typ}; name = "{name}"; path = "{rel}"; sourceTree = "{tree}"; }};\n')
w(f"\t\t{PRODUCT} /* PurpleCAD.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = PurpleCAD.app; sourceTree = BUILT_PRODUCTS_DIR; }};\n")
w("/* End PBXFileReference section */\n")

w("\n/* Begin PBXFrameworksBuildPhase section */\n")
w(f"\t\t{P_FW} /* Frameworks */ = {{isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (\n\t\t\t); runOnlyForDeploymentPostprocessing = 0; }};\n")
w("/* End PBXFrameworksBuildPhase section */\n")

w("\n/* Begin PBXGroup section */\n")
w(f"\t\t{MAIN_GRP} = {{isa = PBXGroup; children = (\n\t\t\t\t{SRC_GRP} /* PurpleCAD */,\n\t\t\t\t{CORE_GRP} /* OCC core */,\n\t\t\t\t{PROD_GRP} /* Products */,\n\t\t\t); sourceTree = \"<group>\"; }};\n")
kids = "".join(f"\t\t\t\t{fref(p)} /* {n} */,\n" for p, t, tr, n in files if tr == "<group>")
w(f"\t\t{SRC_GRP} /* PurpleCAD */ = {{isa = PBXGroup; children = (\n{kids}\t\t\t); path = PurpleCAD; sourceTree = \"<group>\"; }};\n")
kids = "".join(f"\t\t\t\t{fref(p)} /* {n} */,\n" for p, t, tr, n in files if tr == "SOURCE_ROOT")
w(f"\t\t{CORE_GRP} /* OCC core */ = {{isa = PBXGroup; children = (\n{kids}\t\t\t); name = \"OCC core\"; sourceTree = \"<group>\"; }};\n")
w(f"\t\t{PROD_GRP} /* Products */ = {{isa = PBXGroup; children = (\n\t\t\t\t{PRODUCT} /* PurpleCAD.app */,\n\t\t\t); name = Products; sourceTree = \"<group>\"; }};\n")
w("/* End PBXGroup section */\n")

w("\n/* Begin PBXNativeTarget section */\n")
w(f"\t\t{TARGET} /* PurpleCAD */ = {{isa = PBXNativeTarget; buildConfigurationList = {CL_TARGET}; buildPhases = (\n"
  f"\t\t\t\t{P_SRC} /* Sources */,\n\t\t\t\t{P_FW} /* Frameworks */,\n\t\t\t\t{P_WEB} /* Bundle renderer and bridge */,\n\t\t\t\t{P_OCCT} /* Embed OCCT */,\n"
  f"\t\t\t); buildRules = (\n\t\t\t); dependencies = (\n\t\t\t); name = PurpleCAD; productName = PurpleCAD; productReference = {PRODUCT} /* PurpleCAD.app */; productType = \"com.apple.product-type.application\"; }};\n")
w("/* End PBXNativeTarget section */\n")

w("\n/* Begin PBXProject section */\n")
w(f"\t\t{PROJ} /* Project object */ = {{isa = PBXProject; attributes = {{BuildIndependentTargetsInParallel = 1; LastUpgradeCheck = 2700; }}; buildConfigurationList = {CL_PROJ}; compatibilityVersion = \"Xcode 14.0\"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (\n\t\t\t\ten,\n\t\t\t\tBase,\n\t\t\t); mainGroup = {MAIN_GRP}; productRefGroup = {PROD_GRP} /* Products */; projectDirPath = \"\"; projectRoot = \"\"; targets = (\n\t\t\t\t{TARGET} /* PurpleCAD */,\n\t\t\t); }};\n")
w("/* End PBXProject section */\n")

def shell(script):
    return script.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")

WEB = r'''set -e
# The renderer bundle, the OCC bridge and the host scripts.  dist/ is built by
# ios/app/build.sh (vite build); Xcode has no node to run it.
dist="$SRCROOT/../../dist"
if [ ! -f "$dist/index.html" ]; then
  echo "error: $dist/index.html missing -- run ios/app/build.sh, or npx vite build"
  exit 1
fi
res="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH"
rm -rf "$res/web" "$res/js" "$res/occ"
mkdir -p "$res/web" "$res/js" "$res/occ"
cp -R "$dist/" "$res/web/"
cp "$SRCROOT/PurpleCAD/js/"*.js "$res/js/"
cp "$SRCROOT/../../electron/occ-bridge.cjs" "$SRCROOT/../../electron/kvStore.cjs" "$res/occ/"
'''
OCCT = r'''set -e
# The OCCT libraries the app links, and everything they link in turn, into
# Frameworks/ under the names their install names give (libTKx.8.0.dylib).
# Dynamic, as OCCT's LGPL requires (CLAUDE.md, "Licensing").
dest="$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH"
mkdir -p "$dest"
todo="''' + " ".join(OCC_LIBS) + r'''"
seen=" "
while [ -n "$todo" ]; do
  set -- $todo
  lib=$1
  shift
  todo="$*"
  case "$seen" in *" $lib "*) continue ;; esac
  seen="$seen$lib "
  src="$OCCT_IOS/lib/lib$lib.8.0.dylib"
  cp -L "$src" "$dest/lib$lib.8.0.dylib"
  for dep in $(otool -L "$src" | sed -nE 's|^[[:space:]]*@rpath/lib(TK[A-Za-z0-9]+)\.8\.0\.dylib.*|\1|p'); do
    todo="$todo $dep"
  done
done
identity="${EXPANDED_CODE_SIGN_IDENTITY:--}"
for f in "$dest"/libTK*.dylib; do
  codesign --force --sign "$identity" --timestamp=none "$f"
done
'''
w("\n/* Begin PBXShellScriptBuildPhase section */\n")
for pid, name, script in [(P_WEB, "Bundle renderer and bridge", WEB), (P_OCCT, "Embed OCCT", OCCT)]:
    w(f"\t\t{pid} /* {name} */ = {{isa = PBXShellScriptBuildPhase; alwaysOutOfDate = 1; buildActionMask = 2147483647; files = (\n\t\t\t); inputPaths = (\n\t\t\t); name = \"{name}\"; outputPaths = (\n\t\t\t); runOnlyForDeploymentPostprocessing = 0; shellPath = /bin/sh; shellScript = \"{shell(script)}\"; }};\n")
w("/* End PBXShellScriptBuildPhase section */\n")

w("\n/* Begin PBXSourcesBuildPhase section */\n")
srcs = "".join(f"\t\t\t\t{bfile(p)} /* {n} in Sources */,\n" for p, t, tr, n in files if not t.endswith(".h"))
w(f"\t\t{P_SRC} /* Sources */ = {{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (\n{srcs}\t\t\t); runOnlyForDeploymentPostprocessing = 0; }};\n")
w("/* End PBXSourcesBuildPhase section */\n")

ldflags = "".join(f'\t\t\t\t\t"-l{l}",\n' for l in OCC_LIBS)
w("\n/* Begin XCBuildConfiguration section */\n")
w(f'''\t\t{BC_PROJ} /* Release */ = {{isa = XCBuildConfiguration; buildSettings = {{
\t\t\t\tALWAYS_SEARCH_USER_PATHS = NO;
\t\t\t\tCLANG_CXX_LANGUAGE_STANDARD = "c++17";
\t\t\t\tCLANG_ENABLE_OBJC_ARC = YES;
\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 17.0;
\t\t\t\tSDKROOT = iphoneos;
\t\t\t\tSUPPORTED_PLATFORMS = "iphoneos iphonesimulator";
\t\t\t\tSWIFT_COMPILATION_MODE = wholemodule;
\t\t\t\tSWIFT_OPTIMIZATION_LEVEL = "-O";
\t\t\t\tGCC_OPTIMIZATION_LEVEL = 2;
\t\t\t\tOCCT_IOS = "$(HOME)/occ-8.0.1-ios";
\t\t\t\t"OCCT_IOS[sdk=iphonesimulator*]" = "$(HOME)/occ-8.0.1-iossim";
\t\t\t\t"EXCLUDED_ARCHS[sdk=iphonesimulator*]" = x86_64;
\t\t\t}}; name = Release; }};
\t\t{BC_TARGET} /* Release */ = {{isa = XCBuildConfiguration; buildSettings = {{
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tCURRENT_PROJECT_VERSION = 1;
\t\t\t\tDEVELOPMENT_TEAM = 7K4FM2CS29;
\t\t\t\tENABLE_USER_SCRIPT_SANDBOXING = NO;
\t\t\t\tGENERATE_INFOPLIST_FILE = YES;
\t\t\t\tHEADER_SEARCH_PATHS = (
\t\t\t\t\t"$(OCCT_IOS)/include/opencascade",
\t\t\t\t\t"$(SRCROOT)/../../native/occ-addon/src",
\t\t\t\t\t"$(SRCROOT)/../../native/occ-addon/third_party/meshoptimizer/src",
\t\t\t\t);
\t\t\t\tINFOPLIST_FILE = PurpleCAD/Info.plist;
\t\t\t\tINFOPLIST_KEY_CFBundleDisplayName = PurpleCAD;
\t\t\t\tINFOPLIST_KEY_UILaunchScreen_Generation = YES;
\t\t\t\tINFOPLIST_KEY_UIApplicationSceneManifest_Generation = YES;
\t\t\t\tINFOPLIST_KEY_UISupportedInterfaceOrientations_iPad = "UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight";
\t\t\t\tLD_RUNPATH_SEARCH_PATHS = "@executable_path/Frameworks";
\t\t\t\tMARKETING_VERSION = 0.1;
\t\t\t\tOTHER_LDFLAGS = (
\t\t\t\t\t"-L$(OCCT_IOS)/lib",
{ldflags}\t\t\t\t\t"-lsqlite3",
\t\t\t\t\t"-framework",
\t\t\t\t\tJavaScriptCore,
\t\t\t\t);
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.robeesworld.purplecad;
\t\t\t\tPRODUCT_NAME = PurpleCAD;
\t\t\t\tSWIFT_OBJC_BRIDGING_HEADER = "PurpleCAD/Bridging-Header.h";
\t\t\t\tSWIFT_VERSION = 5.0;
\t\t\t\tTARGETED_DEVICE_FAMILY = 2;
\t\t\t\tWARNING_CFLAGS = (
\t\t\t\t\t"-Wno-deprecated-declarations",
\t\t\t\t\t"-Wno-#pragma-messages",
\t\t\t\t);
\t\t\t}}; name = Release; }};
''')
w("/* End XCBuildConfiguration section */\n")
w("\n/* Begin XCConfigurationList section */\n")
for cl, bc in [(CL_PROJ, BC_PROJ), (CL_TARGET, BC_TARGET)]:
    w(f"\t\t{cl} = {{isa = XCConfigurationList; buildConfigurations = (\n\t\t\t\t{bc} /* Release */,\n\t\t\t); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }};\n")
w("/* End XCConfigurationList section */\n")
w(f"\t}};\n\trootObject = {PROJ} /* Project object */;\n}}\n")

dest = os.path.join(APP, "PurpleCAD.xcodeproj")
os.makedirs(dest, exist_ok=True)
open(os.path.join(dest, "project.pbxproj"), "w").write("".join(out))
print(f"{len(files)} files, {len(OCC_LIBS)} OCCT libraries -> {dest}")
