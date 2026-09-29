# PurpleCAD

A parametric CAD application built with React, Three.js, and a native
OpenCASCADE (OCC) kernel, packaged as an Electron desktop app.

## Features

- **Sketching**: 2D sketch planes with line, rectangle, circle, ellipse, arc,
  and bezier tools, plus dimensional/geometric constraints (distance, angle,
  coincident, parallel, concentric, offset, etc.) solved live as you draw.
- **3D primitives**: cube, sphere, cylinder, torus.
- **Extrude**: turn sketch profiles into solids, including cut (boolean
  difference) extrudes.
- **Boolean operations**: union, cut, and intersection, with automatic
  weld/unify so abutting solids join cleanly.
- **Chamfer / fillet**: edge and face selection with a live geometry preview
  before committing.
- **Split**: break a multi-component solid back into its separate objects.
- **Materials**: per-object or default PBR material (color, opacity,
  metalness, roughness, clearcoat) with live preview and presets.
- **Variables & formulas**: drive dimensions, extrude depths, and
  chamfer/fillet parameters from named variables and mm-based formulas.
- **History timeline**: every operation is a step you can scrub, retarget,
  or undo/redo; edits to upstream steps regenerate everything downstream.
- **Render modes**: wireframe, shaded, transparent, and smooth (with
  reflections), plus ground-plane shadows.
- **Cross-section view**: a camera-tracking clip plane with hatched caps
  across cut faces.
- **Path-traced render** (prototype): in-app progressive GPU path tracing
  with a denoise pass and studio-style HDR lighting.
- **Import/export**: save/load `.cad.json` documents, export STL, STEP, and
  PNG snapshots of the viewport.
- **Object Tree**: expandable tree view of the scene hierarchy.
- **Camera controls**: orbit/pan/zoom with a rotation widget, snap-to-grid,
  and configurable curve resolution (preview vs. 3D-print quality).

## Quick Start

### Prerequisites

- Node.js 16+ and npm
- Xcode command line tools / a C++ toolchain and CMake (to build the native
  OCC addon — see `native/occ-addon/` and `CLAUDE.md` for details)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Start the app in development (Vite dev server + Electron):
```bash
npm run dev
```

This builds the native OCC addon, starts Vite on `http://localhost:3000`,
and launches Electron pointed at it.

### Building for Production

```bash
npm run electron:build
```

Produces a packaged Electron app (`.dmg` on macOS). `npm run build` alone
just produces the Vite bundle in `dist/`.

### Testing

```bash
npx vitest run    # unit tests (pure modules, runs in node)
npx vite build    # production bundle — also catches renderer-bundling issues
```

## Usage

### Creating Objects

The toolbar's **Create** section adds sketch planes and 3D primitives (cube,
sphere, cylinder, torus). Select a sketch plane and enter sketch mode to draw
2D profiles, then use **Modify → Extrude** to turn a profile into a solid.

### Combining & Editing Solids

The **Boolean** section unions, cuts, or intersects selected solids. The
**Modify** section (3D view) provides Chamfer, Bevel (fillet), and Split,
each with a live preview before you confirm.

### Materials & Rendering

The **Material** section opens a dialog to set the default material or
override an individual object's appearance. The **Render** section switches
render modes, toggles shadows/cross-section/path-traced rendering, and sets
curve resolution — each with a `1`-`8` keyboard shortcut in the 3D view.

### Object Management

- **Select**: click objects in the viewport or the tree view
- **Delete**: hover over a tree item and click the ✕ button
- **Timeline**: scrub, retarget, or undo/redo any step in the history panel

### Camera Controls

- **Left-drag**: orbit the view
- **Right-drag**: pan
- **Scroll**: zoom
- **Rotation Widget**: click a face/axis for a precise view snap

## Technologies

- **React 18**: UI framework
- **Three.js**: 3D graphics and WebGL rendering (+ `three-mesh-bvh`,
  `three-gpu-pathtracer` for the path-traced render mode)
- **Zustand**: state management (sliced store: history, sketch, materials,
  variables, UI)
- **Electron**: desktop packaging and native module access
- **OpenCASCADE (OCC)**: native C++ geometry kernel via a custom addon
  (`native/occ-addon/`) for booleans, chamfer/fillet, and STEP/STL export
- **Vite**: build tool and dev server
- **Vitest**: unit testing

## Project Structure

```
src/
├── main.jsx                  # Entry point
├── App.jsx                   # Main app component
├── store.js                  # Zustand store (combines slices)
├── store/                    # Store slices: history, sketch, materials,
│                              # variables, UI, undo, document
├── components/
│   ├── Toolbar.jsx            # Toolbar shell
│   ├── toolbar/                # Per-section toolbar components
│   ├── Viewport.jsx            # 3D viewport (Three.js host)
│   ├── viewport/                # Scene-sync hooks, sketch/chamfer overlays
│   ├── TreeView.jsx             # Object hierarchy tree
│   ├── Timeline.jsx             # History timeline panel
│   ├── RotationWidget.jsx       # View rotation control
│   └── *Dialog.jsx              # Material/variables/chamfer/extrude dialogs
├── three/
│   ├── cameraControls.js + cameraControls/  # Input handling, navigation,
│   │                                         # sketch interaction, previews
│   ├── sceneObjects/            # Mesh building, render modes, materials
│   ├── occClient.js, occOps.js  # OCC call boundary (IPC in Electron)
│   ├── pathTrace.js, pathTraceEnv.js  # GPU path-tracer integration
│   ├── crossSection.js, crossSectionCaps.js  # Section-view clipping
│   └── sketchSolver.js, sketchConstraints.js, sketchGeometry.js
├── utils/                     # Formula evaluation helpers
└── styles/                    # CSS

native/occ-addon/              # Native C++ addon wrapping OpenCASCADE
electron/                       # Electron main process
```

## License

PurpleCAD is licensed under the
[PolyForm Noncommercial License 1.0.0](LICENSE.md): you may use, change and
share it for any noncommercial purpose, but not sell it, bundle it with
something that is sold, or use it for commercial work. Versions published
before this change were MIT-licensed, and copies of those keep that license.

The PurpleCAD name, logo, application icons and toolbar icons are not covered
by the license; see [TRADEMARKS.md](TRADEMARKS.md). A fork takes its own name
and icons, toolbar icons included, and says clearly that it is forked from
PurpleCAD.

Third-party components keep their own licenses:
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). PurpleCAD makes use of
facilities provided by the Open CASCADE Technology software (OCCT), under the
GNU LGPL 2.1 with the Open CASCADE exception; both texts are in
[licenses/occt/](licenses/occt/).
