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

module.exports = async function afterPack({ appOutDir, packager, arch }) {
  if (packager.platform.name !== "mac") return;
  const OCC_SRC = occLibDirForArch(arch);

  const appName = packager.appInfo.productFilename;
  const resourcesDir = path.join(
    appOutDir,
    `${appName}.app`,
    "Contents",
    "Resources",
  );
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
