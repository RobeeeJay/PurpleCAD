// The scale for the stress field: what a colour on the body means, in MPa.
//
// Without it the plot is decoration.  The ramp runs from zero to the
// material's YIELD, so a reading is a fraction of what the part can take, and
// the top of the scale means "at or past yield".
//
// The peak is quoted separately, and deliberately not used to scale anything:
// it sits at the fixture, which is where a coarse grid resolves stress worst,
// so a scale built on it would move with the Detail setting rather than with
// the part.

import { useStore } from "../../store";
import { legendScale } from "../../three/fea/stressColors.js";

export default function StressLegend() {
  const result = useStore((s) => s.stressResult);
  const theme = useStore((s) => s.theme);
  if (!result) return null;
  const scale = legendScale(result.ceiling, theme, 6);
  const over = result.robustPeak > result.ceiling;

  return (
    <div
      style={{
        position: "absolute",
        right: 16,
        top: 80,
        padding: "10px 12px",
        borderRadius: 6,
        background: "var(--bg-secondary)",
        border: "1px solid var(--border-color)",
        color: "var(--text-primary)",
        fontSize: 11,
        minWidth: 150,
        pointerEvents: "none",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        Von Mises stress (MPa)
      </div>
      {[...scale].reverse().map((s) => (
        <div
          key={s.t}
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <span
            style={{
              width: 26,
              height: 12,
              background: s.hex,
              border: "1px solid var(--border-color)",
            }}
          />
          <span>{s.mpa.toFixed(0)}</span>
          {s.t === 1 && (
            <span style={{ color: "var(--text-secondary)" }}>yield</span>
          )}
        </div>
      ))}
      <div
        style={{
          marginTop: 8,
          paddingTop: 6,
          borderTop: "1px solid var(--border-color)",
          color: "var(--text-secondary)",
          lineHeight: 1.5,
        }}
      >
        <div>{result.material.name}</div>
        <div style={{ color: over ? "#e87575" : undefined }}>
          Peak {result.robustPeak.toFixed(0)} MPa
          {over ? " — over yield" : ""}
        </div>
        <div>Indicative: a voxel model, coarse at fillets</div>
        <div>
          {result.elements.toLocaleString()} voxels ·{" "}
          {result.seconds.toFixed(1)}s
        </div>
        {result.unsupportedLoad > 0.01 && (
          <div style={{ color: "#e87575" }}>
            {(result.unsupportedLoad * 100).toFixed(0)}% of the load fell
            outside the voxels — raise Detail
          </div>
        )}
      </div>
    </div>
  );
}
