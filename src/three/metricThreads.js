// Standard ISO metric coarse-thread sizes for the Hole tool's dropdown: nominal
// (major) diameter and coarse pitch in mm.  Pure data; the tap-drill / minor
// diameter is derived in the op (major − 1.0825·pitch).
export const METRIC_THREADS = [
  { id: "M1.6", diameter: 1.6, pitch: 0.35 },
  { id: "M2", diameter: 2, pitch: 0.4 },
  { id: "M2.5", diameter: 2.5, pitch: 0.45 },
  { id: "M3", diameter: 3, pitch: 0.5 },
  { id: "M4", diameter: 4, pitch: 0.7 },
  { id: "M5", diameter: 5, pitch: 0.8 },
  { id: "M6", diameter: 6, pitch: 1.0 },
  { id: "M8", diameter: 8, pitch: 1.25 },
  { id: "M10", diameter: 10, pitch: 1.5 },
  { id: "M12", diameter: 12, pitch: 1.75 },
  { id: "M16", diameter: 16, pitch: 2.0 },
  { id: "M20", diameter: 20, pitch: 2.5 },
  { id: "M24", diameter: 24, pitch: 3.0 },
];

export const threadById = (id) => METRIC_THREADS.find((t) => t.id === id);
