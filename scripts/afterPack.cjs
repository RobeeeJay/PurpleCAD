// electron-builder afterPack hook — bundles OCC dylibs and fixes RPATH.
//
// The native addon links against OCC with @rpath references.  At build time
// the RPATH points to ~/occ-arm64/lib (the developer's local build).  For a
// distributable app we copy the OCC dylibs next to the app's Resources and
// patch the RPATH so they resolve at runtime regardless of install location.

const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

// OCC dylib dir per target arch.  electron-builder's Arch enum: 1 = x64,
// 3 = arm64.  The candidates are in the SAME order as the addon's CMakeLists
// HINTS, so the app bundles the build the addon was actually compiled against
// -- taking ~/occ-<arch> unconditionally shipped OCC 7.9 dylibs beside an
// addon linked to 8.0.1, which resolved only on the machine that built it.
// Override with OCC_LIB_DIR if OCC lives somewhere else.
const occLibDirForArch = (arch) => {
  if (process.env.OCC_LIB_DIR) return process.env.OCC_LIB_DIR;
  const name = { 1: "x64", 3: "arm64" }[arch] ?? "arm64";
  const candidates = [
    `occ-8.0.1-${name}`,
    `occ-8.0-${name}`,
    `occ-${name}`,
  ].map((dir) => path.join(process.env.HOME, dir, "lib"));
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates.at(-1);
};

// The @rpath/libTK*.dylib names the addon asks dyld for.
const requiredDylibs = (nodeFile) =>
  execSync(`otool -L "${nodeFile}"`, { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim().match(/^@rpath\/(libTK[^\s]*\.dylib)/)?.[1])
    .filter(Boolean);

const rpathsOf = (file) =>
  execSync(`otool -l "${file}"`, { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim().match(/^path (.+) \(offset \d+\)$/)?.[1])
    .filter(Boolean);

// The oldest macOS a Mach-O file says it runs on.
const minosOf = (file) =>
  execSync(`otool -l "${file}"`, { encoding: "utf8" }).match(
    /^\s*minos (\S+)$/m,
  )?.[1];

const versionAbove = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

// Where the packed addon sits: resources/app.asar.unpacked/... on Linux and
// Windows, inside Contents/ on a Mac.
const addonPathIn = (resourcesDir) =>
  path.join(
    resourcesDir,
    "app.asar.unpacked",
    "native",
    "occ-addon",
    "build",
    "Release",
    "occ_addon.node",
  );

// The libTK* sonames an ELF file asks the loader for.
const elfNeeded = (file) =>
  execSync(`readelf -d "${file}"`, { encoding: "utf8" })
    .split("\n")
    .map((line) => line.match(/\(NEEDED\).*\[(libTK[^\]]+)\]/)?.[1])
    .filter(Boolean);

const elfSoname = (file) =>
  execSync(`readelf -d "${file}"`, { encoding: "utf8" }).match(
    /\(SONAME\).*\[([^\]]+)\]/,
  )?.[1];

// Linux: OCC's libraries go into resources/occ-libs under their sonames, and
// every library carries an $ORIGIN runpath of its own -- DT_RUNPATH is not
// inherited by a library's dependencies (the e2e container's ldconfig note),
// so the addon's runpath alone would find libTKBool and not what IT needs.
const packLinux = (appOutDir, arch) => {
  const occSrc = occLibDirForArch(arch);
  const resourcesDir = path.join(appOutDir, "resources");
  const nodeFile = addonPathIn(resourcesDir);
  if (!fs.existsSync(occSrc))
    throw new Error(`[afterPack] OCC lib dir not found: ${occSrc}`);
  const occLibsDir = path.join(resourcesDir, "occ-libs");
  fs.mkdirSync(occLibsDir, { recursive: true });

  // Only the fully versioned files are real; the two shorter names are
  // symlinks to them, and copying each would triple the size.
  let count = 0;
  for (const f of fs.readdirSync(occSrc)) {
    if (!/^libTK.*\.so\.\d+\.\d+\.\d+$/.test(f)) continue;
    const src = path.join(occSrc, f);
    const dst = path.join(occLibsDir, elfSoname(src) ?? f);
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, 0o755);
    execSync(`patchelf --set-rpath '$ORIGIN' "${dst}"`, { stdio: "pipe" });
    count++;
  }
  // Release -> build -> occ-addon -> native -> app.asar.unpacked -> resources.
  execSync(
    `patchelf --set-rpath '$ORIGIN/../../../../../occ-libs' "${nodeFile}"`,
    { stdio: "pipe" },
  );

  const files = [
    nodeFile,
    ...fs.readdirSync(occLibsDir).map((f) => path.join(occLibsDir, f)),
  ];
  const missing = [
    ...new Set(
      files
        .flatMap(elfNeeded)
        .filter((lib) => !fs.existsSync(path.join(occLibsDir, lib))),
    ),
  ];
  if (missing.length)
    throw new Error(`[afterPack] ${occSrc} has no ${missing.join(", ")}`);
  console.log(
    `[afterPack] bundled ${count} OCC libraries from ${occSrc}, RUNPATH set`,
  );
};

// The DLLs a PE file imports, lower-cased.  dumpbin comes with MSVC; the
// release workflow puts it on the PATH.
const peDependents = (file) =>
  execSync(`dumpbin /nologo /dependents "${file}"`, { encoding: "utf8" })
    .split("\n")
    .map((line) =>
      line
        .trim()
        .match(/^(\S+\.dll)$/i)?.[1]
        ?.toLowerCase(),
    )
    .filter(Boolean);

// The C++ runtime is not part of Windows, and Electron links its own
// statically, so the addon's and OCC's copy has to ship beside them.
const isCrt = (dll) => /^(msvcp140|vcruntime140|concrt140)/.test(dll);

// Windows: OCC's DLLs and the C++ runtime go beside occ_addon.node.  Node
// loads an addon with LOAD_WITH_ALTERED_SEARCH_PATH, so the addon's own
// directory is searched for what it imports.
const packWindows = (appOutDir) => {
  const occBin =
    process.env.OCC_BIN_DIR ??
    path.join(process.env.USERPROFILE ?? "", "occ-8.0.1-x64", "bin");
  const nodeFile = addonPathIn(path.join(appOutDir, "resources"));
  const releaseDir = path.dirname(nodeFile);
  if (!fs.existsSync(occBin))
    throw new Error(`[afterPack] OCC bin dir not found: ${occBin}`);
  const dlls = fs.readdirSync(occBin).filter((f) => /^TK.*\.dll$/i.test(f));
  for (const dll of dlls)
    fs.copyFileSync(path.join(occBin, dll), path.join(releaseDir, dll));

  const redist = process.env.VCToolsRedistDir;
  const crtDir =
    redist &&
    fs
      .readdirSync(path.join(redist, "x64"))
      .filter((d) => /^Microsoft\.VC\d+\.CRT$/.test(d))
      .map((d) => path.join(redist, "x64", d))[0];
  const bundled = () =>
    new Set(fs.readdirSync(releaseDir).map((f) => f.toLowerCase()));
  const imports = () =>
    [...bundled()]
      .filter((f) => f.endsWith(".dll") || f.endsWith(".node"))
      .flatMap((f) => peDependents(path.join(releaseDir, f)));
  for (const dll of new Set(imports().filter(isCrt))) {
    if (!crtDir)
      throw new Error(
        `[afterPack] ${dll} is needed but VCToolsRedistDir is not set`,
      );
    fs.copyFileSync(path.join(crtDir, dll), path.join(releaseDir, dll));
  }

  const have = bundled();
  const missing = [
    ...new Set(
      imports().filter((d) => (/^tk/.test(d) || isCrt(d)) && !have.has(d)),
    ),
  ];
  if (missing.length)
    throw new Error(`[afterPack] not bundled: ${missing.join(", ")}`);
  console.log(
    `[afterPack] bundled ${dlls.length} OCC DLLs from ${occBin} and the C++ runtime`,
  );
};

// Settings tells users to register this file with their MCP client; a build
// that forgot `npm run mcp:build` would ship a setting pointing at nothing.
function requireMcpShim(resourcesDir) {
  const shim = path.join(resourcesDir, "mcp", "purplecad-mcp.mjs");
  if (!fs.existsSync(shim))
    throw new Error(
      `[afterPack] ${shim} is missing: run npm run mcp:build before packaging`,
    );
}

// macOS 26 takes the icon from Assets.car (CFBundleIconName), which
// electron-builder compiles from app-icons/PurpleCAD.icon (mac.icon); macOS
// 13-15 take the .icns named by CFBundleIconFile.  electron-builder fills that
// .icns from the same .icon through actool, which stops at 256 px, so it is
// replaced with the rounded 1024 px one the icon script makes for those
// systems (scripts/make-app-icons.py says why each shape).
const ROUNDED_ICNS = path.join(__dirname, "..", "app-icons", "icon.icns");

function placeMacIcons(resourcesDir) {
  const plist = path.join(resourcesDir, "..", "Info.plist");
  const key = (k) => {
    try {
      return execSync(`plutil -extract ${k} raw "${plist}"`).toString().trim();
    } catch {
      return "";
    }
  };
  if (
    !fs.existsSync(path.join(resourcesDir, "Assets.car")) ||
    !key("CFBundleIconName")
  )
    throw new Error(
      "[afterPack] no compiled .icon (Assets.car / CFBundleIconName): macOS 26 " +
        "would show the icon shrunk on a grey tile. mac.icon must be " +
        "app-icons/PurpleCAD.icon, built with Xcode 26 or newer's actool.",
    );
  const icns = key("CFBundleIconFile");
  if (!icns)
    throw new Error("[afterPack] Info.plist names no CFBundleIconFile");
  fs.copyFileSync(ROUNDED_ICNS, path.join(resourcesDir, icns));
  console.log(
    `[afterPack] Assets.car for macOS 26+, rounded ${icns} for 13-15`,
  );
}

module.exports = async function afterPack({ appOutDir, packager, arch }) {
  requireMcpShim(
    packager.platform.name === "mac"
      ? path.join(
          appOutDir,
          `${packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources",
        )
      : path.join(appOutDir, "resources"),
  );
  if (packager.platform.name === "linux") return packLinux(appOutDir, arch);
  if (packager.platform.name === "windows") return packWindows(appOutDir);
  if (packager.platform.name !== "mac") return;
  const OCC_SRC = occLibDirForArch(arch);

  const appName = packager.appInfo.productFilename;
  const resourcesDir = path.join(
    appOutDir,
    `${appName}.app`,
    "Contents",
    "Resources",
  );
  placeMacIcons(resourcesDir);
  const occLibsDir = path.join(resourcesDir, "occ-libs");
  const nodeFile = path.join(
    resourcesDir,
    "app.asar.unpacked",
    "native",
    "occ-addon",
    "build",
    "Release",
    "occ_addon.node",
  );

  if (!fs.existsSync(nodeFile)) {
    console.warn("[afterPack] occ_addon.node not found — skipping OCC fixup");
    return;
  }

  if (!fs.existsSync(OCC_SRC)) {
    throw new Error(
      `[afterPack] OCC source dir not found: ${OCC_SRC}\n` +
        "Build OCC for arm64 first (see native/occ-addon/README or project memory).",
    );
  }

  // Copy every libTK*.dylib (versioned symlinks excluded — copy resolved files).
  fs.mkdirSync(occLibsDir, { recursive: true });
  const dylibs = fs
    .readdirSync(OCC_SRC)
    .filter((f) => /^libTK.*\.dylib$/.test(f) && !f.includes(".7.9.0"));
  for (const dylib of dylibs) {
    const src = fs.realpathSync(path.join(OCC_SRC, dylib));
    const dst = path.join(occLibsDir, dylib);
    if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
  }

  // Each bundled dylib asks dyld for its siblings by @rpath as well, and dyld
  // resolves those against the DYLIB's own rpaths, not the addon's -- so
  // without this they only load while some other rpath happens to point at a
  // full OCC install.
  for (const dylib of fs.readdirSync(occLibsDir)) {
    const file = path.join(occLibsDir, dylib);
    if (!rpathsOf(file).includes("@loader_path"))
      execSync(`install_name_tool -add_rpath "@loader_path" "${file}"`, {
        stdio: "pipe",
      });
  }

  // The .node file's LC_RPATH points at the developer's local OCC build.  Add
  // the bundled occ-libs and REMOVE every absolute path: an absolute rpath
  // resolves on the build machine and nowhere else, which is exactly how a
  // broken bundle passes a local smoke test.
  // Relative from Release/ up to Resources/: 5 levels (Release→build→occ-addon
  // →native→app.asar.unpacked→Resources), then into occ-libs.
  const newRpath = "@loader_path/../../../../../occ-libs";
  if (!rpathsOf(nodeFile).includes(newRpath))
    execSync(`install_name_tool -add_rpath "${newRpath}" "${nodeFile}"`, {
      stdio: "pipe",
    });
  for (const rpath of rpathsOf(nodeFile))
    if (rpath.startsWith("/"))
      execSync(`install_name_tool -delete_rpath "${rpath}" "${nodeFile}"`, {
        stdio: "pipe",
      });

  // Every bundled binary has to run on the oldest macOS the app claims to.
  // The build defaults to the macOS doing the building, and a kernel built for
  // a newer one fails to load on an older Mac though the app itself opens.
  const appMin = execSync(
    `plutil -extract LSMinimumSystemVersion raw "${path.join(resourcesDir, "..", "Info.plist")}"`,
    { encoding: "utf8" },
  ).trim();
  const tooNew = [
    nodeFile,
    ...fs.readdirSync(occLibsDir).map((f) => path.join(occLibsDir, f)),
  ]
    .map((file) => [file, minosOf(file)])
    .filter(([, min]) => min && versionAbove(min, appMin));
  if (tooNew.length)
    throw new Error(
      `[afterPack] the app runs on macOS ${appMin} but these need newer: ` +
        tooNew.map(([f, min]) => `${path.basename(f)} (${min})`).join(", ") +
        ". Build OCC and the addon with CMAKE_OSX_DEPLOYMENT_TARGET=" +
        appMin +
        ".",
    );

  // Fail the BUILD rather than ship an app that cannot load its kernel. The
  // bundle is now the only place these can come from, so a missing one is a
  // crash on every machine but this one.
  const missing = requiredDylibs(nodeFile).filter(
    (lib) => !fs.existsSync(path.join(occLibsDir, lib)),
  );
  if (missing.length)
    throw new Error(
      `[afterPack] ${OCC_SRC} has no ${missing.join(", ")} -- the addon is ` +
        "linked against a different OpenCASCADE than the one being bundled.",
    );

  console.log(
    `[afterPack] bundled ${dylibs.length} OCC dylibs from ${OCC_SRC}, RPATH patched`,
  );
};
