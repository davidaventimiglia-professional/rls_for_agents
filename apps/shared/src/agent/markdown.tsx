// The small markdown subset the copilot renders in the agent's replies (#39): paragraphs and line breaks, bold,
// italic, inline code, bullet and numbered lists (nested by indentation), headings (as bold paragraphs), fenced code
// and rules. Everything else stays text. Replies quote untrusted text (payment memos), so nothing here produces raw
// HTML: the output is React elements, and every piece of text goes through React's escaping. Links stay text.
import type { ReactNode } from "react";

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; text: string }
  | { kind: "code"; text: string }
  | { kind: "hr" }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] };
type ListItem = { text: string; children: Block[] };

const ITEM = /^(\s*)([-*+]|(\d{1,9})[.)])\s+(.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*```/;

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] | null = null;
  // Open lists, outermost first, with the indent their items start at.
  let lists: { indent: number; list: Extract<Block, { kind: "list" }> }[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  const endPara = () => { if (para) blocks.push({ kind: "p", lines: para }); para = null; };
  const endLists = () => { lists = []; };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) {
      endPara(); endLists();
      const body: string[] = [];
      while (++i < lines.length && !FENCE.test(lines[i])) body.push(lines[i]);
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    if (!line.trim()) { endPara(); endLists(); continue; }
    if (RULE.test(line)) { endPara(); endLists(); blocks.push({ kind: "hr" }); continue; }
    const h = HEADING.exec(line);
    if (h) { endPara(); endLists(); blocks.push({ kind: "h", text: h[1].trim() }); continue; }

    const m = ITEM.exec(line);
    if (m) {
      endPara();
      const indent = m[1].replace(/\t/g, "  ").length, ordered = m[3] !== undefined;
      while (lists.length && lists[lists.length - 1].indent > indent) lists.pop();
      const top = lists[lists.length - 1];
      if (top && top.indent === indent && top.list.ordered === ordered) {
        top.list.items.push({ text: m[4], children: [] });
      } else {
        const list = { kind: "list" as const, ordered, start: ordered ? Number(m[3]) : 1, items: [{ text: m[4], children: [] }] };
        const parent = top && top.indent < indent ? top.list.items[top.list.items.length - 1] : null;
        if (parent) parent.children.push(list);
        else { if (top) lists = []; blocks.push(list); }
        lists.push({ indent, list });
      }
      continue;
    }
    // An indented line inside a list continues the last item; anything else ends the list.
    if (lists.length && /^\s+/.test(line)) {
      const top = lists[lists.length - 1].list;
      const item = top.items[top.items.length - 1];
      item.text += " " + line.trim();
      continue;
    }
    endLists();
    (para ??= []).push(line);
  }
  endPara();
  return blocks;
}

// Inline: `code` first (its content is literal), then **bold** / __bold__, then *italic* / _italic_. An underscore
// only counts at a word boundary, so tool names (mark_invoice_paid) stay as they are; a marker next to a space
// doesn't count either (2 * 3 * 4). An unclosed marker is just text.
const INLINE = /`([^`\n]+)`|\*\*(?=\S)(.+?)(?<=\S)\*\*|(?<![\w])__(?=\S)(.+?)(?<=\S)__(?![\w])|\*(?=[^\s*])(.+?)(?<=[^\s*])\*|(?<![\w])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\w])/g;

export function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, n = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}.${n++}`;
    if (m[1] !== undefined) out.push(<code key={k}>{m[1]}</code>);
    else if (m[2] !== undefined || m[3] !== undefined) out.push(<strong key={k}>{inline(m[2] ?? m[3], k)}</strong>);
    else out.push(<em key={k}>{inline(m[4] ?? m[5], k)}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderBlock(b: Block, key: string): ReactNode {
  switch (b.kind) {
    case "p": return <p key={key}>{b.lines.flatMap((l, i) => (i ? [<br key={`${key}.br${i}`} />, ...inline(l, `${key}.${i}`)] : inline(l, `${key}.${i}`)))}</p>;
    case "h": return <p key={key}><strong>{inline(b.text, key)}</strong></p>;
    case "code": return <pre key={key}><code>{b.text}</code></pre>;
    case "hr": return <hr key={key} />;
    case "list": {
      const items = b.items.map((it, i) => (
        <li key={i}>{inline(it.text, `${key}.${i}`)}{it.children.map((c, j) => renderBlock(c, `${key}.${i}.${j}`))}</li>
      ));
      return b.ordered ? <ol key={key} start={b.start === 1 ? undefined : b.start}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
  }
}

export function Markdown({ text }: { text: string }) {
  return <>{parseBlocks(text).map((b, i) => renderBlock(b, String(i)))}</>;
}
