// Texture library for the Texture tool: procedurally generated default bump
// maps (animal scales, fabric, industrial surfaces) plus user imports
// persisted app-wide in the settings table.  Defaults are drawn on a canvas
// at first use (no binary assets in the repo) and cached; user entries store
// {id, name, dataURL}.

import * as db from "../store/db.js";

const SIZE = 256;
const LIBRARY_KEY = "texture_library";

// ── Procedural default maps ─────────────────────────────────────────────────
// Each generator paints a grayscale, seamlessly TILEABLE height pattern
// (white = raised) onto a SIZE×SIZE canvas 2D context.

const radial = (ctx, cx, cy, r, inner = "#fff", outer = "#000") => {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
};

// Overlapping offset rows of circles — classic fish/snake scale.
const scales = (rows, overlap) => (ctx) => {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const rh = SIZE / rows;
  const r = rh * overlap;
  // Draw an extra ring of tiles on every side so the pattern tiles cleanly.
  for (let row = -2; row < rows + 2; row++) {
    const y = row * rh;
    const shift = row % 2 ? rh : 0;
    for (let x = -rh * 2 + shift; x < SIZE + rh * 2; x += rh * 2)
      radial(ctx, x, y, r);
  }
};

// Diamond / reptile grid: rotated squares with a bright ridge.  The gradient
// is created AFTER translate so its coordinates live in the tile's own frame.
const diamonds = (n) => (ctx) => {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const s = SIZE / n;
  for (let row = -1; row <= 2 * n + 1; row++)
    for (let col = -1; col <= n; col++) {
      const cx = col * s + (row % 2 ? s / 2 : 0);
      const cy = (row * s) / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.62);
      g.addColorStop(0, "#fff");
      g.addColorStop(1, "#000");
      ctx.fillStyle = g;
      ctx.fillRect(-s * 0.44, -s * 0.44, s * 0.88, s * 0.88);
      ctx.restore();
    }
};

// Plain-weave fabric: alternating bright warp/weft bands.
const weave = (n) => (ctx) => {
  const s = SIZE / n;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++) {
      const over = (row + col) % 2 === 0;
      const g = over
        ? ctx.createLinearGradient(col * s, 0, (col + 1) * s, 0)
        : ctx.createLinearGradient(0, row * s, 0, (row + 1) * s);
      g.addColorStop(0, "#222");
      g.addColorStop(0.5, "#e8e8e8");
      g.addColorStop(1, "#222");
      ctx.fillStyle = g;
      ctx.fillRect(col * s + 1, row * s + 1, s - 2, s - 2);
    }
};

// Twill (denim): parallel diagonal ridges.  Canvas gradients don't repeat,
// so each ridge is layered solid strokes (dim base + bright crest).
const stripes = (ctx, period, dir) => {
  for (let d = -SIZE * 2; d < SIZE * 2; d += period) {
    for (const [w, col] of [
      [0.6, "#555"],
      [0.3, "#e6e6e6"],
    ]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = period * w;
      ctx.beginPath();
      if (dir > 0) {
        ctx.moveTo(d - 4, -4);
        ctx.lineTo(d + SIZE + 4, SIZE + 4);
      } else {
        ctx.moveTo(d + SIZE + 4, -4);
        ctx.lineTo(d - 4, SIZE + 4);
      }
      ctx.stroke();
    }
  }
};
const twill = (period) => (ctx) => {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SIZE, SIZE);
  stripes(ctx, period, 1);
};

// Knit: columns of interlocking V loops.
const knit = (n) => (ctx) => {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const s = SIZE / n;
  ctx.lineCap = "round";
  for (let row = -1; row <= n; row++)
    for (let col = -1; col <= n; col++) {
      const x = col * s;
      const y = row * s;
      for (const [dx, flip] of [
        [0, 1],
        [s / 2, -1],
      ]) {
        const g = ctx.createLinearGradient(x + dx, y, x + dx + s / 2, y + s);
        g.addColorStop(0, "#111");
        g.addColorStop(0.5, "#e0e0e0");
        g.addColorStop(1, "#111");
        ctx.strokeStyle = g;
        ctx.lineWidth = s * 0.3;
        ctx.beginPath();
        ctx.moveTo(x + dx, y);
        ctx.quadraticCurveTo(
          x + dx + (s / 4) * flip,
          y + s / 2,
          x + dx + s / 2,
          y + s,
        );
        ctx.stroke();
      }
    }
};

// Knurling: crossed diagonal ridges (diamond knurl).
const knurl = (period) => (ctx) => {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SIZE, SIZE);
  stripes(ctx, period, 1);
  ctx.globalCompositeOperation = "lighten";
  stripes(ctx, period, -1);
  ctx.globalCompositeOperation = "source-over";
};

// Dimpled / perforated grid: round bumps on a flat field.
const dimples = (n) => (ctx) => {
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const s = SIZE / n;
  for (let row = 0; row <= n; row++)
    for (let col = 0; col <= n; col++)
      radial(
        ctx,
        col * s + (row % 2 ? s / 2 : 0),
        row * s,
        s * 0.32,
        "#fff",
        "#3a3a3a",
      );
};

// Hex honeycomb ridges.
const hexes = (n) => (ctx) => {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const r = SIZE / n;
  const h = r * Math.sqrt(3);
  ctx.strokeStyle = "#e6e6e6";
  ctx.lineWidth = r * 0.28;
  for (let row = -1; row * h < SIZE + h; row++)
    for (let col = -1; col * 3 * r < SIZE + 3 * r; col++) {
      const cx = col * 3 * r + (row % 2 ? 1.5 * r : 0);
      const cy = (row * h) / 1;
      ctx.beginPath();
      for (let k = 0; k <= 6; k++) {
        const a = (Math.PI / 3) * k;
        const px = cx + r * Math.cos(a);
        const py = cy + r * Math.sin(a);
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
};

// Brushed metal: fine horizontal streaks (deterministic pseudo-noise).
const brushed = () => (ctx) => {
  ctx.fillStyle = "#666";
  ctx.fillRect(0, 0, SIZE, SIZE);
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 900; i++) {
    const y = rand() * SIZE;
    const w = 20 + rand() * 120;
    const x = rand() * SIZE - w / 2;
    const v = Math.round(70 + rand() * 150);
    ctx.strokeStyle = `rgb(${v},${v},${v})`;
    ctx.lineWidth = 0.8 + rand() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();
  }
};

export const DEFAULT_TEXTURES = [
  {
    id: "fish-scales",
    name: "Fish scales",
    category: "Animal scales",
    draw: scales(8, 0.9),
  },
  {
    id: "snake-scales",
    name: "Snake scales",
    category: "Animal scales",
    draw: scales(12, 0.72),
  },
  {
    id: "reptile-diamond",
    name: "Reptile diamond",
    category: "Animal scales",
    draw: diamonds(8),
  },
  {
    id: "plain-weave",
    name: "Plain weave",
    category: "Fabric",
    draw: weave(16),
  },
  {
    id: "denim-twill",
    name: "Denim twill",
    category: "Fabric",
    draw: twill(16),
  },
  { id: "knit", name: "Knit", category: "Fabric", draw: knit(8) },
  {
    id: "knurled",
    name: "Knurled grip",
    category: "Industrial",
    draw: knurl(24),
  },
  {
    id: "dimpled",
    name: "Dimpled plate",
    category: "Industrial",
    draw: dimples(8),
  },
  {
    id: "honeycomb",
    name: "Honeycomb",
    category: "Industrial",
    draw: hexes(6),
  },
  {
    id: "brushed",
    name: "Brushed metal",
    category: "Industrial",
    draw: brushed(),
  },
];

let defaultsCache = null;
export function getDefaultLibrary() {
  if (defaultsCache) return defaultsCache;
  defaultsCache = DEFAULT_TEXTURES.map(({ id, name, category, draw }) => {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    draw(canvas.getContext("2d"));
    return { id, name, category, dataURL: canvas.toDataURL("image/png") };
  });
  return defaultsCache;
}

// ── User imports (persisted app-wide) ───────────────────────────────────────

export function loadUserLibrary() {
  try {
    const raw = db.settingGet(LIBRARY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveUserLibrary(list) {
  db.settingSet(LIBRARY_KEY, JSON.stringify(list));
}

// Import-size guard: big bitmaps make every displacement resample slow and
// bloat the document (the dataURL is stored in each texture step's recipe).
// Returns a warning string, or null when the image is a comfortable size.
export function importSizeWarning({ width, height, bytes }) {
  const MPX = 1024 * 1024;
  const MB = 1024 * 1024;
  if (width * height > MPX || bytes > 1.5 * MB) {
    const px = `${width}×${height}`;
    const mb = (bytes / MB).toFixed(1);
    return (
      `This image is large (${px}, ${mb} MB). Bump maps this size make ` +
      `previews and recalculation noticeably slow and are stored inside the ` +
      `document. Consider a version at or below 1024×1024. Import anyway?`
    );
  }
  return null;
}
