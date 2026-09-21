// The largest chamfer / fillet a flat face's rim could possibly take, from the
// face's own outline.  Bevelling the rim insets the face's boundary by the
// bevel's size, and past a certain size that inset stops being the same shape:
//
//  - an EDGE shrinks to nothing (a gear tooth's tip land, eaten from both
//    ends -- the bevels on either side of it meet);
//  - two LOOPS meet (the outline and a hole, closing across the ring between);
//  - a NECK closes (a concave corner reaching the far side of a narrow strip).
//
// The smallest of those is an upper bound: a bevel any bigger cannot exist, so
// it is worth saying so before OCC spends seconds finding out.  It is NOT a
// promise that anything smaller works -- OCC's bevels on the short segments a
// sketch outline is made of give out earlier (a cog whose teeth allow 0.69 mm
// fails from about 0.4 mm), so it is shown as a limit, not a suggestion.
//
// Loops are closed polylines in any consistent unit; the result is in the same
// unit, or Infinity when nothing limits it.

const signedArea = (pts) =>
  pts.reduce((s, a, i) => {
    const b = pts[(i + 1) % pts.length];
    return s + (a.x * b.y - b.x * a.y) / 2;
  }, 0);

// Drop repeated points (a closing duplicate, or zero-length segments).
function clean(loop) {
  const out = [];
  for (const p of loop) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-12) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0],
      b = out[out.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= 1e-12) out.pop();
  }
  return out;
}

// Walk every loop with the material on its LEFT: the outline counter-clockwise,
// holes clockwise.
function orient(outer, holes) {
  const o = clean(outer);
  const hs = holes.map(clean).filter((h) => h.length >= 3);
  return [
    signedArea(o) > 0 ? o : [...o].reverse(),
    ...hs.map((h) => (signedArea(h) < 0 ? h : [...h].reverse())),
  ];
}

function segDist(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1e-30;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2),
  );
  return { d: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)), t };
}

// Interior angle at each vertex, measured through the material (0..2pi).
function interiorAngles(loop) {
  const n = loop.length;
  return loop.map((v, i) => {
    const a = loop[(i - 1 + n) % n],
      b = loop[(i + 1) % n];
    const inA = Math.atan2(v.y - a.y, v.x - a.x);
    const out = Math.atan2(b.y - v.y, b.x - v.x);
    let turn = out - inA; // left turn = convex, material on the left
    while (turn <= -Math.PI) turn += 2 * Math.PI;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    return Math.PI - turn;
  });
}

export function rimBevelLimit(outer, holes = []) {
  if (!outer || outer.length < 3) return Infinity;
  const loops = orient(outer, holes);
  let limit = Infinity;

  // Edge collapse: inset by d, an edge between vertices with interior angles
  // A and B shortens by d (cot(A/2) + cot(B/2)).
  for (const loop of loops) {
    const n = loop.length;
    const ang = interiorAngles(loop);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const rate = 1 / Math.tan(ang[i] / 2) + 1 / Math.tan(ang[j] / 2);
      if (rate <= 1e-9) continue; // the edge lengthens, or stays
      const len = Math.hypot(loop[j].x - loop[i].x, loop[j].y - loop[i].y);
      limit = Math.min(limit, len / rate);
    }
  }

  // Loops meeting: both insets advance d, so they touch at half the gap.
  for (let a = 0; a < loops.length; a++)
    for (let b = a + 1; b < loops.length; b++)
      for (const p of loops[a])
        for (let k = 0; k < loops[b].length; k++) {
          const q = loops[b][k],
            r = loops[b][(k + 1) % loops[b].length];
          limit = Math.min(limit, segDist(p, q, r).d / 2);
        }

  // A neck in one loop: a concave vertex facing a stretch of the SAME loop
  // across the material.  Only stretches far along the loop count -- on a
  // curve the neighbouring segments are close without facing it.
  for (const loop of loops) {
    const n = loop.length;
    const ang = interiorAngles(loop);
    const along = [0];
    for (let i = 1; i <= n; i++) {
      const a = loop[i - 1],
        b = loop[i % n];
      along.push(along[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    const perimeter = along[n];
    for (let i = 0; i < n; i++) {
      if (ang[i] <= Math.PI) continue; // only concave corners reach across
      for (let k = 0; k < n; k++) {
        if (k === i || (k + 1) % n === i) continue;
        const { d, t } = segDist(loop[i], loop[k], loop[(k + 1) % n]);
        if (!(d / 2 < limit)) continue;
        const pos = along[k] + t * (along[k + 1] - along[k]);
        const gap = Math.abs(pos - along[i]);
        if (Math.min(gap, perimeter - gap) <= Math.PI * d) continue;
        limit = d / 2;
      }
    }
  }
  return limit;
}
