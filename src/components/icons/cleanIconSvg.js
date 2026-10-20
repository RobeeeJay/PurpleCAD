// An icon as saved from a drawing program, made fit to render inline.
//
// The icons live as SVG files in cad-icons/, so they can be opened, edited and
// saved straight from Affinity Designer (or anything else) without a hand
// touch-up.  What such a file carries that the app can't use is taken off
// here: the XML prolog and DOCTYPE, comments, metadata, editors' own
// attributes (serif:, inkscape:, sodipodi:), and a <title>, which would show
// its own tooltip over the button's.  Two things are changed:
//
// - Pure magenta (#FF00FF) means "the UI's colour": it becomes currentColor,
//   so the icon follows hover, active and disabled states the way the
//   hand-written icons did.  A drawing program can't author currentColor;
//   this is the colour to draw those parts in.
// - ids are prefixed with the icon's name: Affinity names its gradients and
//   clip paths _Linear1, _clip1 in every file, and two icons on one page would
//   otherwise borrow each other's.
//
// Returns { viewBox, attrs, body }: the root's viewBox, its presentation
// attributes as React props (Affinity puts fill-rule, stroke-linecap and so on
// in a style on the root), and the markup inside it.

const MAGENTA =
  /#ff00ff\b|#f0f\b|rgba?\(\s*255\s*,\s*0\s*,\s*255\s*(?:,\s*1(?:\.0*)?\s*)?\)|\bmagenta\b/gi;

// Root attributes that style what is inside it, kept as React props.
const PRESENTATION = new Set([
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "clip-rule",
  "opacity",
  "color",
]);

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

const parseAttrs = (s) => {
  const out = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    out[m[1]] = m[2] ?? m[3];
  return out;
};

export function cleanIconSvg(text, name) {
  let t = String(text)
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<metadata[\s\S]*?<\/metadata>/gi, "")
    .replace(/<title[\s\S]*?<\/title>/gi, "")
    .replace(/<desc[\s\S]*?<\/desc>/gi, "")
    .replace(/<sodipodi:[\s\S]*?(?:\/>|<\/sodipodi:[\w-]+>)/g, "");
  const open = t.match(/<svg\b([^>]*)>/i);
  const close = t.lastIndexOf("</svg>");
  if (!open || close < 0) throw new Error(`icon ${name}: no <svg> element`);
  const rootAttrs = parseAttrs(open[1]);
  let body = t.slice(open.index + open[0].length, close);

  // Editors' attributes inside, and namespace declarations they need.
  body = body.replace(
    /\s(?:serif|inkscape|sodipodi|xmlns(?::[\w-]+)?|xml:space)(?::[\w-]+)?\s*=\s*(?:"[^"]*"|'[^']*')/g,
    "",
  );

  // Unique ids, and every reference to them.
  const ids = [...body.matchAll(/\sid\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  for (const id of new Set(ids)) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const to = `${name}__${id}`;
    body = body
      .replace(new RegExp(`(\\sid\\s*=\\s*")${esc}"`, "g"), `$1${to}"`)
      .replace(new RegExp(`url\\(\\s*#${esc}\\s*\\)`, "g"), `url(#${to})`)
      .replace(new RegExp(`(href\\s*=\\s*")#${esc}"`, "g"), `$1#${to}"`);
  }
  body = body.replace(MAGENTA, "currentColor").trim();

  const attrs = {};
  const style = rootAttrs.style || "";
  for (const decl of style.split(";")) {
    const [k, ...v] = decl.split(":");
    const key = (k || "").trim().toLowerCase();
    if (PRESENTATION.has(key)) attrs[camel(key)] = v.join(":").trim();
  }
  for (const [k, v] of Object.entries(rootAttrs))
    if (PRESENTATION.has(k)) attrs[camel(k)] = v;
  for (const k of Object.keys(attrs))
    attrs[k] = attrs[k].replace(MAGENTA, "currentColor");

  let viewBox = rootAttrs.viewBox;
  if (!viewBox) {
    const w = parseFloat(rootAttrs.width),
      h = parseFloat(rootAttrs.height);
    viewBox = w > 0 && h > 0 ? `0 0 ${w} ${h}` : "0 0 24 24";
  }
  return { viewBox, attrs, body };
}
