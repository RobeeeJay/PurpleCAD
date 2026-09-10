# Stress analysis and generative design

Two tools over one shared model: **Stress** colours a body by von Mises stress
under a load case, and **Generative design** (SIMP topology optimisation)
removes the material that carries none of it. Both are reached from the MODIFY
toolbar group; generative design is badged EXPERIMENTAL on the button and on
its own bar.

## The shape of it

    voxelise.js     surface mesh -> occupancy grid (the design space)
    stressField.js  buildLoadCase(): grid + fixed dofs + nodal forces
                    solveStressField(): the above, solved, plus von Mises
    hexSolver.js    8-node hex elements, matrix-free conjugate gradient
    stressMesh.js   display mesh: surface subdivided + sampled from the field
    stressColors.js the sequential ramp and the legend's stops
    topology.js     SIMP: densities, sensitivities, the filter, the update
    surfaceNets.js  density field -> smooth isosurface (what the result becomes)
    voxelMesh.js    connectivity filter; voxelSurface is now only a test baseline
    *Worker*.js     both solves run in a Web Worker; vitest falls back in-process

OCC only ever hands over a SURFACE mesh, so the volumetric discretisation is
built here. A regular grid is deliberate: every voxel is the same cube, so one
24x24 element stiffness matrix serves the whole model, the global matrix is
never assembled, and the conjugate gradient only needs K*v -- a gather, a small
multiply and a scatter per element. That is what keeps it in plain JS.

**Units are N / mm / MPa** throughout, which is self-consistent. Scene units are
mm / MM_PER_UNIT, and the conversion happens at the stressField boundary.

**Terminating these workers mid-solve is SAFE** -- pure JS, no shared native
state -- unlike the OCC worker, where a terminate corrupts the kernel's globals.
Cancel here is a genuine abort, not a cooperative flag.

## What is actually validated

Against closed-form answers, in `__tests__`:

- Cantilever tip deflection converges on Euler-Bernoulli from below: 0.879,
  0.971, 0.992, 0.999 at 2/4/6/8 elements through the thickness. Through the
  whole mesh path (buildLoadCase included) it lands at 0.992, 0.999, 1.005.
- Uniaxial tension reads force over area exactly, everywhere.
- SIMP reproduces the canonical cantilever truss, compliance falling to 0.16 of
  the uniform design at the same volume, with the volume constraint hit exactly.

What is NOT validated: mesh convergence per run, any factor of safety, more
than one load case at a time, and anything against a physical test. Hence the
badge.

## Landmines

Each cost real time; the numbers are what was measured.

- **Nodes are NOT voxel centres.** Nodes sit at voxel corners, so the index is
  `(p - origin) / h`, with no `- 0.5`. Using the voxel-centre formula put every
  load and fixture half a voxel out, and asymmetrically: a point on one face
  straddled a supported node and an empty one, dumping its whole share on one
  node while its mirror split evenly between two (-68.75N against -6.25N on the
  two edges of one loaded face).
- **Load must not reach nodes with no material.** A surface point sits ON the
  boundary, so some of its eight neighbours are outside the body and carry no
  stiffness. Force handed to one can never be balanced, the system is
  inconsistent, and the conjugate gradient DIVERGES -- residuals of 1e+61 after
  grinding out all 4000 iterations, 49s to return NaN. `surroundingNodes`
  filters by a `supported` mask and renormalises the survivors so the total
  force is preserved. The solver also gives up when the residual grows six
  orders of magnitude, and the store surfaces that rather than colouring
  whatever came back.
- **The sample lattice must be centred on the body**, or a symmetric part
  voxelises asymmetrically (measured -1.00, -0.71, -0.63 voxels off-centre for
  one box at three resolutions; up to 160 mismatched voxels).
- **The anti-degeneracy nudge needs two DIFFERENT magnitudes.** It exists
  because grid-aligned faces send rays along shared triangle edges, where a
  crossing is double-counted (a box over-fills by 7% without it). But moving y
  and z by the same amount leaves a sample on the line y = z still on it, so the
  ray runs along a cap's diagonal, collects four crossings, and the pairs come
  out as zero-length spans -- that column ends up EMPTY. Six columns of a
  60x10x10 bar filled nothing: 17% of the material gone, the beam 24% too
  flexible.
- **Loads are integrated over each triangle's area, not lumped at corners.**
  Corner lumping makes the transfer depend on how a face was triangulated -- a
  quad splits along one diagonal, so the two corners on it collect double, and
  mirroring flips the diagonal.
- **Fixtures take the nearest node plane (both on a tie), not trilinear
  weights.** A fixture is a yes/no, and a tie must not break one way. A full
  voxel of reach is too much: it holds a whole layer of elements inside the
  body, whose strain -- and so whose stress -- then reads zero.
- **The ramp is scaled to the material's YIELD, never to the field's peak.** The
  peak sits at the fixture, which is where a coarse grid resolves it worst: the
  same bar reads 170 MPa at one detail and 255 at another.
- **The stress material must be UNLIT.** Magnitude is encoded in lightness, and
  a lit material encodes it too -- the first render had a bar's held end reading
  BRIGHTER than its free end purely because that face pointed at the light,
  exactly reversing the field.
- **The plot needs its own resolution.** Drawn on a body's own vertices, a fused
  box gives eight distinct colours for the whole part. The display mesh is the
  surface subdivided to about a voxel and sampled from the volumetric field.
- **The result is never stored on the item.** It is one float per vertex, and
  items are persisted into .pcad and frozen into every downstream op's
  `regenerator.source`, where mesh-dense data stacks up O(k^2). It lives in the
  store keyed by item, and is dropped when the geometry it describes is rebuilt.
- **SIMP's sensitivity filter is load-bearing.** Without it the result breaks
  into checkerboards (adjacent-voxel flip rate 0.000 to 0.145) -- and the
  checkerboard scores a LOWER compliance than the correct answer, so a
  compliance-only check walks straight into it.
- **The optimiser's surface follows the CONTINUOUS density**, not thresholded
  blocks. Thresholding first and wrapping cubes throws away everything the field
  knew between 0 and 1: 100% axis-aligned faces against under 5% for the
  isosurface.

**A correction worth keeping**: it was reported here that stress at a built-in
edge "climbs without limit as the mesh is refined". That was an artefact of the
half-voxel placement, not a singularity. Applied correctly it CONVERGES from
below -- 170, 221, 236, 242, 255 MPa against beam theory's 288.

## Cost

Solve time is dominated by the element count, on a Jacobi-preconditioned
conjugate gradient: roughly 1.3s at 7k elements, 3.8s at 17k, 9.4s at 33k, 19s
at 58k and 60s at 137k. A solid body at Detail 64 is that last figure; a thin or
hollow part at the same setting is far quicker, since only material counts.
Tightening the solver tolerance past 1e-5 changes neither mean nor peak stress
by 0.01% and costs a fifth more iterations. The obvious next win is a multigrid
preconditioner.
