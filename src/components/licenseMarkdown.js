// A small Markdown reader for the licence dialog: just what LICENSE.md,
// TRADEMARKS.md and THIRD_PARTY_LICENSES.md use -- headings, paragraphs,
// lists (one level of nesting), tables, rules, quotes, and bold, italic,
// code and links inline.  No library: one would need its own entry in the
// third-party list, for a job this size.  Returns plain data for the dialog to
// draw, so it can be tested without a DOM.

// Inline runs: [{ t: "text" | "strong" | "em" | "code" | "link", v, href? }].
// A bare web address is a link too: the third-party tables are full of them.
// It stops before trailing punctuation, so "(https://x.org)." links x.org.
export function inline(text) {
  const out = [];
  const re =
    /(`[^`]+`)|(\*\*\*[^*]+\*\*\*)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)]+\))|(<https?:\/\/[^>]+>)|(https?:\/\/[^\s<>()|]*[^\s<>()|.,;:'"!?])/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    const s = m[0];
    if (m[1]) out.push({ t: "code", v: s.slice(1, -1) });
    else if (m[2]) out.push({ t: "strong", v: s.slice(3, -3) });
    else if (m[3]) out.push({ t: "strong", v: s.slice(2, -2) });
    else if (m[4]) out.push({ t: "em", v: s.slice(1, -1) });
    else if (m[5]) {
      const [, v, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(s);
      out.push({ t: "link", v, href });
    } else if (m[6])
      out.push({ t: "link", v: s.slice(1, -1), href: s.slice(1, -1) });
    else out.push({ t: "link", v: s, href: s });
    last = m.index + s.length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => inline(c.trim()));

// Blocks: { type: "heading", level, text } | { type: "para", text }
// | { type: "quote", text } | { type: "rule" }
// | { type: "list", ordered, items: [{ text, children: [text] }] }
// | { type: "table", head: [cell], rows: [[cell]] }; text/cells are inline runs.
export function parseMarkdown(src) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ type: "heading", level: h[1].length, text: inline(h[2]) });
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }
    if (line.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|"))
        rows.push(lines[i++]);
      const body = rows.filter(
        (r, k) => !(k === 1 && /^\|[\s:|-]+\|$/.test(r)),
      );
      blocks.push({
        type: "table",
        head: cells(body[0]),
        rows: body.slice(1).map(cells),
      });
      continue;
    }
    if (line.startsWith(">")) {
      const parts = [];
      while (i < lines.length && lines[i].startsWith(">"))
        parts.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ type: "quote", text: inline(parts.join(" ")) });
      continue;
    }
    const first = LIST_ITEM.exec(line);
    if (first) {
      const base = first[1].length;
      const ordered = /\d/.test(first[2]);
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          // A blank line ends the list unless an indented line follows it.
          if (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1])) {
            i++;
            continue;
          }
          break;
        }
        const m = LIST_ITEM.exec(l);
        if (m && m[1].length <= base) {
          items.push({ text: m[3], children: [] });
        } else if (m && items.length) {
          items.at(-1).children.push(m[3]);
        } else if (/^\s+\S/.test(l) && items.length) {
          // A wrapped line continues the last item (or its last sub-item).
          const it = items.at(-1);
          if (it.children.length)
            it.children[it.children.length - 1] += " " + l.trim();
          else it.text += " " + l.trim();
        } else break;
        i++;
      }
      blocks.push({
        type: "list",
        ordered,
        items: items.map((it) => ({
          text: inline(it.text),
          children: it.children.map(inline),
        })),
      });
      continue;
    }
    const parts = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|\||>)/.test(lines[i]) &&
      !LIST_ITEM.exec(lines[i]) &&
      !/^\s*(-{3,}|\*{3,})\s*$/.test(lines[i])
    )
      parts.push(lines[i++].trim());
    blocks.push({ type: "para", text: inline(parts.join(" ")) });
  }
  return blocks;
}
