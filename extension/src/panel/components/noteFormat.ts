// Minimal markdown-lite helpers for note bodies. Bodies stay plain strings in
// storage; the preview renders a small safe subset (bold, italic, bullets).

export interface TextSelection {
  start: number;
  end: number;
}

export interface FormatResult {
  body: string;
  selection: TextSelection;
}

/** Wrap the selected text (or an empty cursor) with a bold/italic marker. */
export function wrapInline(body: string, sel: TextSelection, marker: "**" | "*"): FormatResult {
  const start = Math.max(0, Math.min(sel.start, body.length));
  const end = Math.max(start, Math.min(sel.end, body.length));
  const next = `${body.slice(0, start)}${marker}${body.slice(start, end)}${marker}${body.slice(end)}`;
  const cursor = start === end ? { start: start + marker.length, end: start + marker.length } : { start: start + marker.length, end: end + marker.length };
  return { body: next, selection: cursor };
}

interface LineEdit {
  from: number;
  to: number;
  insert: string;
}

/** Toggle a "- " bullet on every line touched by the selection. */
export function toggleBullets(body: string, sel: TextSelection): FormatResult {
  const lines = body.split("\n");
  const offsets: number[] = [];
  let at = 0;
  for (const line of lines) {
    offsets.push(at);
    at += line.length + 1;
  }
  const start = Math.max(0, Math.min(sel.start, body.length));
  const end = Math.max(start, Math.min(sel.end, body.length));
  const firstLine = offsets.findIndex((offset, i) => start < offset + lines[i].length + 1);
  const lastLine = offsets.findIndex((offset, i) => end <= offset + lines[i].length + (i === lines.length - 1 ? 1 : 0));
  const from = firstLine === -1 ? lines.length - 1 : firstLine;
  const to = lastLine === -1 ? lines.length - 1 : Math.max(lastLine, from);
  const edits: LineEdit[] = [];
  let removing = true;
  for (let i = from; i <= to; i++) {
    const match = lines[i].match(/^(\s*)[-*] (.*)$/);
    if (!match) removing = false;
    else edits.push({ from: offsets[i] + match[1].length, to: offsets[i] + match[1].length + 2, insert: "" });
  }
  if (!removing) {
    edits.length = 0;
    for (let i = from; i <= to; i++) {
      if (!lines[i].trim()) continue;
      const indent = lines[i].match(/^\s*/)?.[0] ?? "";
      edits.push({ from: offsets[i] + indent.length, to: offsets[i] + indent.length, insert: "- " });
    }
  }
  edits.sort((a, b) => b.from - a.from);
  let next = body;
  for (const edit of edits) next = `${next.slice(0, edit.from)}${edit.insert}${next.slice(edit.to)}`;
  const shift = (pos: number) => {
    let delta = 0;
    for (const edit of edits) {
      if (edit.from <= pos) delta += edit.insert.length - (edit.to - edit.from);
    }
    return Math.max(0, Math.min(pos + delta, next.length));
  };
  return { body: next, selection: { start: shift(start), end: shift(end) } };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+?)\*/g, "<em>$1</em>");
}

/** Render the safe preview subset. Output contains only our own tags. */
export function renderPreview(body: string): string {
  const out: string[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length > 0) {
      out.push(`<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
      list = [];
    }
  };
  for (const line of body.split("\n")) {
    const bullet = line.match(/^\s*[-*] (.*)$/);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flushList();
    if (line.trim()) out.push(`<p>${renderInline(line.trim())}</p>`);
  }
  flushList();
  return out.join("");
}
