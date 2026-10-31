// The angle dimension between two sketch lines: which of the two supplementary
// angles it means, and the rotation that gets a line near a new value, since
// the solver converges poorly from far away.

const ENDPOINT_TOL = 1e-6;
const ends = (l) => [
  { x: l.x1, y: l.y1 },
  { x: l.x2, y: l.y2 },
];

// The endpoint two lines share, with which end it is on each: 0 start, 1 end.
function sharedEnd(a, b) {
  const ea = ends(a);
  const eb = ends(b);
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++)
      if (Math.hypot(ea[i].x - eb[j].x, ea[i].y - eb[j].y) < ENDPOINT_TOL)
        return { point: ea[i], onA: i, onB: j };
  return null;
}

// A line has no direction of its own, so two lines make both an angle and its
// supplement.  `sense` (+1 or -1) says which is meant, read against the lines'
// stored directions: the corner's angle where they share an endpoint, otherwise
// the acute one, which is how an angle between separate lines is read.
export function angleSense(a, b) {
  const shared = sharedEnd(a, b);
  if (shared) return shared.onA === shared.onB ? 1 : -1;
  const dot = (a.x2 - a.x1) * (b.x2 - b.x1) + (a.y2 - a.y1) * (b.y2 - b.y1);
  return dot >= 0 ? 1 : -1;
}

// The angle between two lines in degrees, 0 to 180, in that sense.
export function linesAngleDeg(a, b, sense) {
  const ax = a.x2 - a.x1;
  const ay = a.y2 - a.y1;
  const bx = b.x2 - b.x1;
  const by = b.y2 - b.y1;
  return (
    (Math.atan2(Math.abs(ax * by - ay * bx), (ax * bx + ay * by) * sense) *
      180) /
    Math.PI
  );
}

// `line` turned to make `deg` with `other`, staying on the side of it that it
// is on.  It turns about the endpoint they share, or else its own middle, and
// keeps its length.
export function turnLineToAngle(line, other, sense, deg) {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const len = Math.hypot(dx, dy) || 1e-9;
  const ox = (other.x2 - other.x1) * sense;
  const oy = (other.y2 - other.y1) * sense;
  const side = ox * dy - oy * dx >= 0 ? 1 : -1;
  const heading = Math.atan2(oy, ox) + side * ((deg * Math.PI) / 180);
  const ux = Math.cos(heading);
  const uy = Math.sin(heading);
  const pivot = sharedEnd(line, other)?.point ?? {
    x: (line.x1 + line.x2) / 2,
    y: (line.y1 + line.y2) / 2,
  };
  const place = (p) => {
    const along = ((p.x - pivot.x) * dx + (p.y - pivot.y) * dy) / len;
    return { x: pivot.x + ux * along, y: pivot.y + uy * along };
  };
  const [s, e] = ends(line).map(place);
  return { ...line, x1: s.x, y1: s.y, x2: e.x, y2: e.y };
}
