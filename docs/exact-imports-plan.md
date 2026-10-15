# Exact Surfaces From Imported STEP and STL Files

Import a STEP file of a part with a nice round bore, and what you get in PurpleCAD is a bag of triangles. Chamfer that bore and the chamfer runs round a polygon. Fillet it and OCC sews thousands of flat faces back into a solid first, which is slow, and sometimes it gives up. Everything PurpleCAD builds itself has used exact curves since the `curves2D` work, but anything you import still doesn't.

The two formats are very different problems, so this plan treats them separately. A STEP file already *contains* exact surfaces, and we throw them away; keeping them is a straightforward fix. An STL file never had any surfaces, only triangles, so getting curves out of one means recognising shapes in a mesh. That's possible for mechanical parts (planes, cylinders, cones, spheres) and not for organic ones, and the plan is honest about where that line is.

## Where We Are Now

Here is what an import does today, read from the source rather than remembered.

**STEP.** `occOps.js#importStep` reads the file with OCC's STEP reader, which produces exact surfaces, then tessellates the shape and *releases it*:

```js
const id = occ.importSTEP(stepText);
tess = occ.tessellate(id, printPrecision ?? 0.5);
occ.releaseShape(id);
```

`DocumentSection.jsx` hands the positions and indices to `finalizeImportedMesh` (mm and Z-up to scene units and Y-up, centred on the bounding box) and `addImportedSolid`, which makes a plain mesh item: a `csg` with `geometryData` and no regenerator. The exact shape is gone by the time the item exists. The edges OCC hands back with the mesh are dropped too.

**STL.** `parseStl`, then `weldForImport` (meshoptimizer), then the same `addImportedSolid`. Same kind of item.

**Every op afterwards.** `buildItemShapeLocal` rebuilds a mesh item by sewing its triangles into a solid (`makeSolidFromMesh`, which merges coplanar triangles and refuses meshes over 50,000 triangles so a later boolean can't hang). So a curved face is always a fan of flat faces to OCC, whatever the file said.

## Part One: Keep the STEP File's Surfaces

This is the easy half, and it's most of the value for anyone importing from another CAD program.

### Basic Design

An imported STEP body keeps its exact shape as its *recipe*, and is rebuilt from it like anything else. The mesh becomes what it is for every other body: the drawing of the recipe at the current Resolution.

### Steps

1. **Serialise the shape.** Add an addon op that writes the imported shape as OCC's BREP text (`BRepTools::Write` to a stream) and one that reads it back. BREP rather than the original STEP text because it's what OCC holds after translation, it reads back without re-running the STEP translator, and it can carry the import's transform baked in.
2. **Bake the import transform into the shape.** `finalizeImportedMesh` turns file coordinates (mm, Z-up) into scene units (Y-up) and centres the result. Do the same to the *shape* (scale by 1/`MM_PER_UNIT`, rotate −π/2 about X, translate by the bounding-box centre) before serialising, so the stored shape and the drawn mesh share a frame. The parity invariant in CLAUDE.md applies: the OCC rebuild's world bounding box must equal the mesh's.
3. **A new recipe kind.** The item gets `regenerator: { kind: "importedShape", brep, regeneratedAt }`. `buildItemShapeLocal` reads the BREP back instead of sewing the mesh, and the recalc re-tessellates it at the current Resolution, so a finer Resolution actually refines an imported bore. This goes in BOTH OCC implementations (`occOps.js` and `electron/occ-bridge.cjs`), with a `bridgeParity.test.js` case, as always.
4. **Watch the BREP riding the chain.** Every op's frozen `regenerator.source` nests the item before it, so a chain of ops on an imported body carries several copies of its BREP. Unlike `geometryData` it can't be pruned from the deeper copies, because it *is* the recipe they rebuild from. So it was measured before deciding (see below): for real parts it costs about what the mesh it replaces does, so it is stored as plain text and left unpruned for now.
5. **Edges for the outline.** Pass the edges OCC returns through `finalizeImportedMesh`, so an imported part draws its real edges rather than every triangle seam.

### Done, and What It Measured

Part One is built: `importStep` returns the shape as BREP text baked into the body's frame, the body's recipe is `{ kind: "importedShape", brep }`, both OCC implementations rebuild from it, and the recalc redraws it at the current Resolution. Tests are in `importedStepShape.test.js` and at the end of `e2e/import.spec.js`.

Here are the sizes for real STEP files: the twelve V-Core 3 printed parts I had to hand, plus two of OCCT's samples, imported at the 0.05 mm Resolution:

| File | STEP | BREP | Mesh (packed) | Import |
| --- | --- | --- | --- | --- |
| bed_arm_back | 183 kB | 191 kB | 6,098 tris, 144 kB | 54 ms |
| cable_tie | 206 kB | 266 kB | 90,210 tris, 1,659 kB | 198 ms |
| MGN12 3030 Centering Tool | 618 kB | 435 kB | 3,566 tris, 88 kB | 92 ms |
| motor_support_l | 36 kB | 28 kB | 3,744 tris, 88 kB | 19 ms |
| OCCT linkrods | 1,751 kB | 1,370 kB | 7,734 tris, 149 kB | 166 ms |

Across the fourteen files the BREP ran from 28 kB to 435 kB (1.4 MB for the multi-body linkrods sample), against meshes of 50 kB to 1.7 MB. So it's the same order as the mesh it stands in for, which is why it isn't packed. `cable_tie` is worth a second look: at 90,210 triangles its mesh is over the 50,000-triangle cap that sewing a mesh would refuse, and as a recipe it never gets sewn at all.

A trap for anyone measuring this again: a STEP file that *PurpleCAD exported* isn't representative. The exporter writes each body's baked mesh, one face per triangle, so its BREP is just triangles written longhand (13.5 MB for a ring with a 20,000-triangle mesh). Use a STEP file from real CAD software.

One side effect: the toolbar used to import at a fixed 0.5 mm and now imports at your Resolution, so imported parts are drawn more finely than before.

### What Won't Change

STEP bodies imported before this change have already lost their surfaces: the shape was released at import and the file isn't kept. The only way to give them curves is to import the file again. The upgrade-on-recalculation route that works for sketch profiles can't help, because there's nothing exact left to upgrade from. Say so in the release notes, not just here.

### How We'll Know It Works

- Unit tests: export a body with a cylinder and a cone to STEP, import it, then count faces and surface types on the rebuilt shape (a STEP round trip, the way `exactCurveExtrude.test.js` counts them). A chamfer on the imported bore's rim should select one circular edge.
- Resolution: the same import tessellated at 0.05 and 0.01 mm must give more triangles at the finer setting, where today it's fixed at whatever the import used.
- Size: record the BREP size against the old mesh size for at least one real part, and write both down in the commit.
- e2e: import a STEP through the real file input and check the item carries the recipe and survives a save and reload.

## Part Two: Recognising Surfaces in an STL

So can you get curves back out of a mesh? For a machined or printed mechanical part, mostly yes. For a scanned face or a sculpted figurine, no, and nothing here pretends otherwise. Those regions stay triangles.

### A Probe That Failed (Usefully)

OCC 8.0.1 ships `ShapeAnalysis_CanonicalRecognition`, which answers "is this face, shell or wire really a plane / cylinder / cone / sphere, within a tolerance?" That sounded like exactly the tool, so I tried it on the realistic input: an exact 10 mm-radius cylinder, tessellated at 0.05 and 0.01 mm, sewn back into a solid the way an import is, and its 45 (or 100) wall faces gathered into one shell. At tolerances of 0.001, 0.01 and 0.1 mm it returned status 1, "error, usually wrong input data", every time.

Reading the header explains it. The recogniser converts a face whose surface is already some other curve type (a B-spline that's secretly a cylinder, say), and its least-squares fitting is only reached through *wires*. A shell of flat triangle faces isn't what it's for. That probe was a throwaway, since reverted. The lesson: the fitting has to be ours, though the recogniser may still be useful later on the boundary wires between regions (see the Unknowns below).

### Basic Design

Find the regions of the mesh that are really one surface, fit that surface exactly, and rebuild those regions as exact faces. Anything that doesn't fit stays triangles. A part comes out as a hybrid: exact where it can be, faceted where it can't, and never worse than it went in.

### Steps

1. **Segment.** After the existing weld, grow regions across edges where neighbouring triangles' normals turn by less than a threshold, and stop at sharp creases. The creases of a mechanical part are where its real edges are, so this splits it into candidate faces.
2. **Fit each region.**
   - A plane is a least-squares fit, which is what the coplanar merge already does in effect.
   - A sphere has a closed-form algebraic fit.
   - A cylinder's axis is the direction its normals never point along: the smallest eigenvector of the normals' covariance. Then a circle fit in the plane across that axis gives the radius.
   - A cone is the same idea, with the normals tilted by the half angle.
   - Torus is optional, for fillets on round parts.
   Each fit reports its worst vertex deviation.
3. **Accept or reject.** A fit is kept only if every vertex of the region lies within a tolerance of it. The default should come from the mesh itself (its own chord error is the floor), with a tolerance field the user can change. Adjacent regions that fit the same surface merge: a cylinder sliced into strips by the mesher is one face.
4. **Rebuild.**
   - Each accepted region becomes a face on its exact surface, bounded by its boundary polyline projected onto that surface.
   - Boundary polylines that are really lines or circles (OCC's `IsLine` / `IsCircle` on a wire may do here) become exact edges. Others become B-splines through their points.
   - Rejected regions keep their triangles.
   - Sew the lot with a tolerance, and validate with BRepCheck, a closed-mesh check and a volume comparison against the original mesh.
   - On failure, fall back to the original mesh, so a bad conversion never costs the user their part.
5. **The tool.** A Modify tool, "Convert to Surfaces", on a mesh body:
   - A bottom-bar dialog with the tolerance.
   - A live preview colouring each region by what it was recognised as, plus a count ("212 faces: 30 planes, 12 cylinders, 2 cones, 168 triangles left").
   - A timeline step with a recipe (`kind: "meshToSurfaces"`, source, tolerance) and an Edit that reopens the same dialog, as every Modify tool has.

### How We'll Know It Works

- Synthetic meshes with a known answer: tessellate exact shapes (a plate with a bore, a stepped shaft, a cone) at several Resolutions, convert, and check the surface types, the face count, and that every exact face lies within tolerance of the original surface.
- Noise: the same meshes with small random vertex jitter, to find where recognition breaks down, measured rather than assumed.
- Real files: at least one printed-part STL. `test-files/multisystem2.pcad` carries an imported STL base with known sewing trouble, which makes it a good stress test.
- Downstream: a chamfer on a converted bore's rim should select one circular edge and bevel in about the time it takes on a body built in PurpleCAD.

## Unknowns and Risks

- **Hybrid sewing is the hard part.** An exact face next to a triangle face has to share an edge, and the exact face's boundary is a projected polyline while the triangles' boundary is the original one. They agree to within the fit tolerance, so sewing *should* close them, but nobody has tried it. If it can't, the fallback is all-or-nothing per connected group of regions, which is weaker but safe.
- **Fillet bands.** A small fillet between two faces is a thin strip of a torus or cylinder with only a few triangles across it. It may be too thin to fit reliably, and will then stay triangles. That's acceptable, but worth measuring.
- **Speed.** Segmentation and fitting are linear-ish, but sewing a few thousand faces isn't fast. The 50,000-triangle import cap stays in place until there are measurements.
- **Recogniser on wires.** `ShapeAnalysis_CanonicalRecognition` on boundary wires (for exact line and circle edges) is untested.

## Order of Work

1. Part One, the STEP recipe, first: the most value for the least risk, and it settles the recipe and parity plumbing that Part Two's output will reuse.
2. Part Two, steps 1 to 3 (segmentation and fitting) as a pure, unit-tested module with a report of what it found. No geometry is rebuilt yet, so it can be measured on real files before anything depends on it.
3. Part Two, step 4 (the rebuild), behind the fallback.
4. Part Two, step 5 (the tool and its timeline Edit), with e2e coverage.

Each step lands as its own commit with its tests and its measurements, and each can stop there if the measurements say the next one isn't worth it.
