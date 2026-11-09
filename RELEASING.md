# Building PurpleCAD Releases

PurpleCAD has a native addon, and the addon links OpenCASCADE (OCC), so every
release has to be built on the operating system and processor it's for. There's
no cross-compiling here: a Windows build needs a Windows machine with OCC built
on it, an Intel Mac build needs an Intel Mac, and so on. The release workflow on
GitHub only builds for Apple Silicon Macs, which leaves the other two to be done
by hand.

This page is written for whoever does that, Claude included. Each platform
section is a sequence of steps, with a check after each step that says whether
it worked. If a check fails, stop and fix it before going on: a release that
builds but can't load its kernel looks perfectly healthy until someone opens a
part.

| Platform | Status | Section |
| -------- | ------ | ------- |
| macOS, Apple Silicon | Built and signed on the main development Mac. The release workflow builds it too. | [macOS](#macos-apple-silicon-and-intel) |
| macOS, Intel | Never built. The steps follow the Apple Silicon path, which works. | [macOS](#macos-apple-silicon-and-intel) |
| Windows x64 | Never built, and **needs code changes first**. The steps say which. | [Windows](#windows-x64) |
| Linux x64 | Not covered here yet. It needs the same change to `scripts/afterPack.cjs` as Windows. | |

## Before You Start, on Every Platform

Build every platform from the **same commit**, the one whose `package.json`
says the version you're releasing. Check it:

```bash
git log -1 --oneline
node -p "require('./package.json').version"
```

The version number shows in the app's About box, so a build from the wrong commit
is a build that lies about what it is.

You need Node.js 24, which is what CI uses and what made the lockfile, plus git.
Install the dependencies for the app and for the addon:

```bash
npm ci
npm ci --prefix native/occ-addon
```

`npm ci` rather than `npm install`, because it installs exactly what the
lockfile says and never quietly updates it.

**Don't publish anything.** Build, check, and hand the files back. Publishing a
release is a separate decision, and it's the owner's.

## macOS: Apple Silicon and Intel

The two Mac builds are the same steps with a different architecture name. Use
`arm64` on Apple Silicon and `x64` on an Intel Mac. The examples use `x64`,
since that's the one you're most likely to be doing by hand.

### Step One: Tools

You need the Xcode command line tools, plus CMake and Ninja from Homebrew:

```bash
xcode-select --install
brew install cmake ninja
```

On an Intel Mac, Homebrew lives in `/usr/local`, which is correct there. (On
Apple Silicon it's `/opt/homebrew`. `native/occ-addon/build.sh` skips any
`cmake` it can't run, because this development machine has an old Intel Homebrew
that it can't run.)

### Step Two: Build OpenCASCADE 8.0.1

This takes 15 minutes or so on a fast machine, and longer on an older Intel one.
The install directory name matters: the addon's `CMakeLists.txt` and
`scripts/afterPack.cjs` both look for `~/occ-8.0.1-<arch>`.

```bash
git clone --depth 1 --branch V8_0_1 \
  https://github.com/Open-Cascade-SAS/OCCT.git /tmp/occt
cmake -S /tmp/occt -B /tmp/occt-build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=x86_64 \
  -DCMAKE_INSTALL_PREFIX=$HOME/occ-8.0.1-x64 \
  -DBUILD_MODULE_FoundationClasses=ON \
  -DBUILD_MODULE_ModelingData=ON \
  -DBUILD_MODULE_ModelingAlgorithms=ON \
  -DBUILD_MODULE_DataExchange=ON \
  -DBUILD_MODULE_Visualization=OFF \
  -DBUILD_MODULE_Draw=OFF \
  -DBUILD_MODULE_ApplicationFramework=OFF \
  -DUSE_FREETYPE=OFF -DUSE_TK=OFF -DUSE_OPENGL=OFF
cmake --build /tmp/occt-build --parallel $(sysctl -n hw.logicalcpu)
cmake --install /tmp/occt-build
```

These are the same options the release workflow and the e2e container use. The
modules switched off are the ones PurpleCAD doesn't use, which saves about half
the build. On Apple Silicon, use `arm64` for both `CMAKE_OSX_ARCHITECTURES` and
the directory name.

**Pin `CMAKE_OSX_ARCHITECTURES` ALWAYS.** OCC 8.0.1 picks x86_64 by itself on an
Apple Silicon Mac, and the result fails quietly: the addon still links, and only
falls over when the app loads it.

Check you got the architecture you asked for:

```bash
lipo -archs ~/occ-8.0.1-x64/lib/libTKernel.8.0.1.dylib
```

You should see `x86_64`, or `arm64` on Apple Silicon.

### Step Three: Build and Test the Addon

```bash
npm run addon:build
npm test
```

The unit tests drive the real addon, so a pass here means this machine's OCC
build works. They take a few minutes, and `npm test -- --maxWorkers=3` is gentler
if the machine is busy with anything else. Every test should pass. Don't carry on
past a failure on the grounds that it looks unrelated.

### Step Four: Signing and Notarization Credentials

A Mac release has to be signed with a **Developer ID Application** certificate.
It has to be that one: an Apple Distribution certificate is for the App Store, and
Gatekeeper turns away a downloaded app signed with it. It also has to be
notarized, or macOS refuses to open it on any Mac but the one that built it.

Check the certificate is in this machine's keychain:

```bash
security find-identity -v -p codesigning
```

You should see a line with `Developer ID Application: ROBEENA JESSICA SHEPHERD
(7K4FM2CS29)`. If you don't, it has to be exported from a Mac that has it:

1. In Keychain Access, under **My Certificates**, export that certificate together
   with its private key as a `.p12`, with a password.
2. Copy the file across and double-click it to import it.
3. Run the check again.

Notarization uses an App Store Connect API key, which is a `.p8` file, plus its
key ID and issuer ID. electron-builder notarizes the app by itself when three
environment variables are set:

```bash
export APPLE_API_KEY=/path/to/AuthKey_XXXXXXXXXX.p8
export APPLE_API_KEY_ID=XXXXXXXXXX
export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

The key ID is the part of the file name after `AuthKey_`. The issuer ID is shown
on the same App Store Connect page as the keys (Users and Access, then
Integrations). Keep the `.p8` file out of this repository: it can notarize
anything in the owner's name.

### Step Five: Build the App

```bash
npm run dist:mac-x64
```

On Apple Silicon, that's `npm run dist:mac-arm64`. You should see electron-builder
sign the app, then report that notarization succeeded, and end up with a `.dmg` and a
`.zip` in `release/` with the version and architecture in their names.

If it says `skipped macOS notarization`, one of the three variables is missing.
Notarization can take anything from a minute to half an hour, because it waits
on Apple.

**The build also rebuilds `better-sqlite3`** for the packaged app, so afterwards
`npm run electron:start` can fail with an architecture error until you put it
back:

```bash
npm run sqlite:rebuild
```

### Step Six: Check the Build

Four checks, and all of them have to pass.

First, check the app loads its kernel using only what it carries. This runs the
app's own binary from an unrelated directory, so the bundled OCC is the only
OCC it can find:

```bash
app="$PWD/release/mac/PurpleCAD.app"   # release/mac-arm64/... on Apple Silicon
cd /tmp
ELECTRON_RUN_AS_NODE=1 "$app/Contents/MacOS/PurpleCAD" \
  -e "require('$app/Contents/Resources/app.asar.unpacked/native/occ-addon/build/Release/occ_addon.node'); console.log('ok')"
cd -
```

It should print `ok`. If it says `symbol not found` or `image not found`, the app
would crash on every machine except this one.

Second, check the signature, then ask Gatekeeper what it makes of the app:

```bash
codesign --verify --deep --strict --verbose=2 "$app"
spctl --assess --type execute --verbose "$app"
```

The second command should say `accepted` and `source=Notarized Developer ID`.
`source=Developer ID` alone means it's signed but not notarized.

Third, open the app from Finder (not from a VS Code terminal: see
`ELECTRON_RUN_AS_NODE` in `CLAUDE.md`). Make a box, sketch on it, extrude a
circle, chamfer an edge, and save the document.

Finally, write down the checksums of what you're handing back:

```bash
shasum -a 256 release/*.dmg release/*.zip
```

## Windows x64

Nobody has built PurpleCAD for Windows yet, so this section is a plan more than a
recipe. Steps One to Three ought to work as written, but I haven't run them.
Step Four is code that doesn't exist yet. Work through it in order, and commit
the code changes on a branch as you go, so they come back with the build.

Run the build steps in an **x64 Native Tools Command Prompt for VS 2022**, which
is a `cmd` window with the compiler on the PATH: those blocks are `cmd` syntax.
The checks in Step Six are PowerShell.

### Step One: Tools

- **Visual Studio 2022 Build Tools**, with the "Desktop development with C++"
  workload. That gives you MSVC and the Windows SDK.
- **CMake** and **Ninja**. Recent Build Tools include both.
- **Node.js 24**, **git** and **Python 3**. node-gyp needs Python when it rebuilds
  `better-sqlite3`.

### Step Two: Build OpenCASCADE 8.0.1

From the x64 Native Tools prompt:

```bat
git clone --depth 1 --branch V8_0_1 https://github.com/Open-Cascade-SAS/OCCT.git C:\src\occt
cmake -S C:\src\occt -B C:\src\occt-build -G Ninja ^
  -DCMAKE_BUILD_TYPE=Release ^
  -DCMAKE_INSTALL_PREFIX=%USERPROFILE%\occ-8.0.1-x64 ^
  -DINSTALL_DIR_LAYOUT=Unix ^
  -DBUILD_MODULE_FoundationClasses=ON ^
  -DBUILD_MODULE_ModelingData=ON ^
  -DBUILD_MODULE_ModelingAlgorithms=ON ^
  -DBUILD_MODULE_DataExchange=ON ^
  -DBUILD_MODULE_Visualization=OFF ^
  -DBUILD_MODULE_Draw=OFF ^
  -DBUILD_MODULE_ApplicationFramework=OFF ^
  -DUSE_FREETYPE=OFF -DUSE_TK=OFF -DUSE_OPENGL=OFF
cmake --build C:\src\occt-build --parallel
cmake --install C:\src\occt-build
```

`INSTALL_DIR_LAYOUT=Unix` asks for `lib\`, `bin\` and `lib\cmake\opencascade\`
in the install, rather than OCC's usual Windows layout, which buries them under
`win64\vc14\`. I haven't seen the result, so check it: there should be
`TKernel.dll` in `%USERPROFILE%\occ-8.0.1-x64\bin` and
`OpenCASCADEConfig.cmake` under `lib\cmake\opencascade`. If they're somewhere
else, use wherever they actually are in the steps below.

### Step Three: Build and Test the Addon

`npm run addon:build` goes through `build.sh`, which is a bash script, so call
cmake-js directly instead, and tell it where OCC is:

```bat
cd native\occ-addon
npx cmake-js compile --CDCMAKE_BUILD_TYPE=Release ^
  --CDOpenCASCADE_DIR=%USERPROFILE%\occ-8.0.1-x64\lib\cmake\opencascade
cd ..\..
```

Expect compile errors the first time. The addon has only ever been built with
clang and gcc, and MSVC disagrees with both of them in places. Fix them in a way
that still compiles with clang and gcc: no `#ifdef _MSC_VER` wrapped around ops,
and no changes to behaviour. `CLAUDE.md`'s section on the addon has the rules.

Then run the unit tests, with OCC's DLLs on the PATH so the tests can load the
addon:

```bat
set PATH=%USERPROFILE%\occ-8.0.1-x64\bin;%PATH%
npx vitest run --maxWorkers=3
```

`npm test` goes through a bash script too, hence `npx`. Every test should pass.
One that fails here but passes on a Mac is the interesting kind: it's the addon
behaving differently on Windows, and it needs fixing, not skipping.

There's one known risk to look at while you're in there. On Unix, the addon
defines `OCC_CONVERT_SIGNALS` so that a crash inside OCC becomes an exception
instead of taking the whole app down (see "OCC kernel faults" in `CLAUDE.md`).
Windows does this with structured exceptions instead, which MSVC only turns into
C++ exceptions when the code is compiled with `/EHa`. Check how the OCC build was
compiled, and compile the addon the same way. Without it, a geometry error that
merely fails an operation on a Mac could close the app on Windows.

### Step Four: Bundle OCC With the App (Code Change)

`scripts/afterPack.cjs` bundles OCC into a Mac app and returns early on every
other platform. As it stands, a Windows build would ship an addon that can't find
`TKernel.dll`. Add a Windows branch that:

1. Finds the OCC `bin` directory from an `OCC_BIN_DIR` environment variable,
   falling back to `%USERPROFILE%\occ-8.0.1-x64\bin`.
2. Copies every `TK*.dll` from there into the directory that holds
   `occ_addon.node`, under
   `resources\app.asar.unpacked\native\occ-addon\build\Release` in the packed
   app.
3. Lists the DLLs the addon imports (`dumpbin /dependents occ_addon.node`), and
   throws if any `TK*.dll` among them is missing from that directory, just as the
   Mac branch does for dylibs. A missing DLL has to fail the build, not the user.

DLLs placed beside the `.node` file should be found when the addon loads, because
Node loads native addons with a search path that includes the addon's own
directory. That's what I'd expect from how Node does it, not something I've seen
work, which is why the check in Step Six exists.

Make sure the change leaves the Mac branch alone. The Mac build has to come out
the same as before.

### Step Five: Build the App

`npm run dist:win` starts with the bash build script too, so run its other two
steps yourself:

```bat
npx vite build
npx electron-builder --win --x64 --publish never
```

You should end up with an installer (`PurpleCAD Setup <version>.exe`) and a
`.zip` in `release\`. The build isn't code-signed, so Windows SmartScreen will
warn whoever runs the installer. Signing for Windows needs a code-signing
certificate, which there isn't one of yet.

### Step Six: Check the Build

First, check the packed app loads its kernel using only what it carries. In a
new PowerShell window, from the repository, take OCC off the PATH, or the check
passes for the wrong reason, and run the app's own binary from another
directory:

```powershell
$occBin = "$env:USERPROFILE\occ-8.0.1-x64\bin"
$env:PATH = ($env:PATH -split ';' | Where-Object { $_ -ne $occBin }) -join ';'
$exe = (Resolve-Path release\win-unpacked\PurpleCAD.exe).Path
$addon = (Resolve-Path release\win-unpacked\resources\app.asar.unpacked\native\occ-addon\build\Release\occ_addon.node).Path
Push-Location $env:TEMP
$env:ELECTRON_RUN_AS_NODE = "1"
& $exe -e "require(process.argv[1]); console.log('ok')" $addon
Remove-Item Env:ELECTRON_RUN_AS_NODE
Pop-Location
```

It should print `ok`. "The specified module could
not be found" means a DLL is missing from the bundle.

Then install it with the installer, as a user would, and open it from the Start
menu. Make a box, sketch on it, extrude a circle, chamfer an edge, export an STL
and save the document. Finally, record the checksums:

```powershell
Get-FileHash release\*.exe, release\*.zip -Algorithm SHA256
```

### What to Bring Back From Windows

- The installer and the `.zip`, with their checksums.
- The branch with the MSVC fixes and the `afterPack.cjs` change, pushed for review.
  Note anything that only Windows needed.
- A note of anything you couldn't check, or that behaved differently from the
  Mac. "Didn't try X" is worth writing down.

## Getting the Notarization Key

You need three things from App Store Connect, and you probably already have them.
The ZX-Rustrum project notarizes with an App Store Connect API key the same way,
and PurpleCAD uses the same key: `AuthKey_R7WU32263A.p8`, kept in `~/Keys/` on
the main development Mac. Its key ID is `R7WU32263A`. `notarytool history` with
it lists ZX-Rustrum's own submissions, which is how I know it's the right one.
Copy the file to the build machine by hand, never through the repository.

To use one, or make a new one:

1. Sign in to [App Store Connect](https://appstoreconnect.apple.com) and go to
   **Users and Access**, then **Integrations**, then **App Store Connect API**.
2. The **Issuer ID** is shown above the list of keys. Copy it. It's the same for
   every key on the account.
3. Find the key whose ID matches the one in your `.p8` file name. If neither is
   listed any more, or you'd rather have one just for PurpleCAD, generate a new
   key with the **Developer** role and download it. Apple only lets you download
   it once, so keep it somewhere safe and outside any repository.
4. Set `APPLE_API_KEY`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` as Step Four of
   the Mac section shows.

Then check the key works before you spend a whole build finding out:

```bash
xcrun notarytool history --key "$APPLE_API_KEY" \
  --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER"
```

A list of past submissions, or an empty list, means it works. An authentication
error means the key ID and issuer don't belong together.

## Known Gaps

- **Linux** needs the same kind of `afterPack.cjs` branch as Windows, copying the
  `libTK*.so` files and setting an `$ORIGIN` rpath with `patchelf`. The e2e
  container already builds OCC and the addon on Linux, so it's the natural place
  to build that release, but nobody has tried it.
- **Windows builds aren't code-signed**, so SmartScreen warns about them until
  there's a certificate to sign with.
- **The release workflow** only builds Apple Silicon, and it signs nothing. Adding
  the Mac signing secrets to it is how the ZX-Rustrum project does it
  (`docs/build.md` there), and that's the obvious next step once a hand-built
  release has proved the path.
