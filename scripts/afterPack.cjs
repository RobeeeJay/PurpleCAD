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
// 3 = arm64.  Each mac arch links against its own OCC build (~/occ-arm64,
// ~/occ-x64); override with OCC_LIB_DIR if installed elsewhere.
const occLibDirForArch = (arch) => {
  if (process.env.OCC_LIB_DIR) return process.env.OCC_LIB_DIR;
  const name = { 1: "x64", 3: "arm64" }[arch] ?? "arm64";
  return path.join(process.env.HOME, `occ-${name}`, "lib");
};

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

  // The .node file's LC_RPATH currently points to the developer's local OCC
  // build.  Replace it with the path to the bundled occ-libs inside the app.
  // Relative from Release/ up to Resources/: 5 levels (Release→build→occ-addon
  // →native→app.asar.unpacked→Resources), then into occ-libs.
  const newRpath = "@loader_path/../../../../../occ-libs";
  const oldRpath = OCC_SRC;
  try {
    execSync(
      `install_name_tool -rpath "${oldRpath}" "${newRpath}" "${nodeFile}"`,
      { stdio: "pipe" },
    );
  } catch {
    // Rpath may already be absent or differ; add unconditionally.
    execSync(`install_name_tool -add_rpath "${newRpath}" "${nodeFile}"`, {
      stdio: "pipe",
    });
  }
  console.log("[afterPack] OCC dylibs bundled and RPATH patched");
};
