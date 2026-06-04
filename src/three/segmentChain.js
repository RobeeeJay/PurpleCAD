// Walk the chain of connected straight segments that continue smoothly through
// `startIdx` — at each shared endpoint, follow the connected segment whose bend
// (turn angle) is within `maxAngleDeg`, in both directions.  Used so hovering
// one segment of a tessellated curved edge highlights (and selects) the whole
// curve.  Segments are { ax, ay, az, bx, by, bz }; works in 2D by leaving z 0.
export function computeSegmentChain(segs, startIdx, maxAngleDeg) {
  const start = segs?.[startIdx];
  if (!start) return startIdx == null ? [] : [startIdx];
  const maxAngle = (Math.max(0, maxAngleDeg) * Math.PI) / 180;
  const EPS = 1e-4;
  const close = (ax, ay, az, bx, by, bz) =>
    Math.abs(ax - bx) < EPS &&
    Math.abs(ay - by) < EPS &&
    Math.abs(az - bz) < EPS;
  const visited = new Set([startIdx]);
  const chain = [startIdx];

  // From endpoint (cx,cy,cz), travelling in unit direction (ux,uy,uz), greedily
  // extend along the smoothest in-tolerance connected segment.
  const walk = (cx, cy, cz, ux, uy, uz) => {
    for (;;) {
      let best = null;
      let bestAngle = Infinity;
      for (let i = 0; i < segs.length; i++) {
        if (visited.has(i)) continue;
        const s = segs[i];
        let ox, oy, oz;
        if (close(s.ax, s.ay, s.az, cx, cy, cz)) {
          ox = s.bx;
          oy = s.by;
          oz = s.bz;
        } else if (close(s.bx, s.by, s.bz, cx, cy, cz)) {
          ox = s.ax;
          oy = s.ay;
          oz = s.az;
        } else continue;
        let lx = ox - cx,
          ly = oy - cy,
          lz = oz - cz;
        const len = Math.hypot(lx, ly, lz);
        if (len < EPS) continue;
        lx /= len;
        ly /= len;
        lz /= len;
        const dot = Math.max(-1, Math.min(1, ux * lx + uy * ly + uz * lz));
        const angle = Math.acos(dot);
        if (angle < bestAngle) {
          bestAngle = angle;
          best = { i, ox, oy, oz, lx, ly, lz };
        }
      }
      if (!best || bestAngle > maxAngle) break;
      visited.add(best.i);
      chain.push(best.i);
      cx = best.ox;
      cy = best.oy;
      cz = best.oz;
      ux = best.lx;
      uy = best.ly;
      uz = best.lz;
    }
  };

  const len =
    Math.hypot(start.bx - start.ax, start.by - start.ay, start.bz - start.az) ||
    1;
  walk(
    start.bx,
    start.by,
    start.bz,
    (start.bx - start.ax) / len,
    (start.by - start.ay) / len,
    (start.bz - start.az) / len,
  );
  walk(
    start.ax,
    start.ay,
    start.az,
    (start.ax - start.bx) / len,
    (start.ay - start.by) / len,
    (start.az - start.bz) / len,
  );
  return chain;
}
