/**
 * A deliberately small Markdown dialect for lesson text, parsed into a plain data structure that
 * the mobile app (React Native) and the admin console (React DOM) each render with their own
 * components. Because nothing here produces HTML, there is nothing to sanitise: unknown syntax is
 * shown as ordinary text and links are limited to a short list of safe schemes.
 *
 * Supported:   # / ## / ### headings · **bold** · _italic_ (or *italic*) · `code`
 *              - or * bullet lists · 1. numbered lists · > notes (blockquote) · --- rule
 *              [text](https://…) links (http, https, mailto, tel only)
 * Not supported on purpose: raw HTML, images (use the image lesson type), tables.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "quote"; children: Inline[] }
  | { type: "rule" };

const SAFE_LINK = /^(https?:\/\/|mailto:|tel:)/i;

export function isSafeLink(href: string): boolean {
  return SAFE_LINK.test(href.trim()) && !/[\s<>"]/.test(href.trim());
}

/** Inline formatting. Nesting is allowed (bold containing italic) but bounded, so hostile input stays cheap. */
export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ type: "text", text });
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);

    // `code`
    let m = /^`([^`\n]+)`/.exec(rest);
    if (m) {
      flush();
      out.push({ type: "code", text: m[1] });
      i += m[0].length;
      continue;
    }
    // [label](href)
    m = depth < 3 ? /^\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/.exec(rest) : null;
    if (m) {
      if (isSafeLink(m[2])) {
        flush();
        out.push({ type: "link", href: m[2], children: parseInline(m[1], depth + 1) });
      } else {
        text += m[1]; // unsafe scheme: keep the words, drop the link
      }
      i += m[0].length;
      continue;
    }
    // **bold** (also __bold__)
    m = depth < 3 ? /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest) : null;
    if (m) {
      flush();
      out.push({ type: "bold", children: parseInline(m[2], depth + 1) });
      i += m[0].length;
      continue;
    }
    // _italic_ / *italic*  (the closing mark must not be followed by a word character, so snake_case stays intact)
    m = depth < 3 ? /^(\*|_)(?=\S)([^*_\n]*?\S)\1(?![A-Za-z0-9ऀ-ॿ])/.exec(rest) : null;
    if (m && (m[1] === "*" || i === 0 || /[^A-Za-z0-9ऀ-ॿ]/.test(src[i - 1]))) {
      flush();
      out.push({ type: "italic", children: parseInline(m[2], depth + 1) });
      i += m[0].length;
      continue;
    }
    // a backslash escapes the next punctuation mark
    if (src[i] === "\\" && i + 1 < src.length && /[\\`*_[\]()#>\-]/.test(src[i + 1])) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    text += src[i];
    i += 1;
  }
  flush();
  return out;
}

const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const isSpecial = (line: string) => HEADING.test(line) || RULE.test(line) || BULLET.test(line) || NUMBERED.test(line) || QUOTE.test(line);

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    let m = HEADING.exec(line);
    if (m) {
      blocks.push({ type: "heading", level: m[1].length as 1 | 2 | 3, children: parseInline(m[2]) });
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = NUMBERED.test(line) && !BULLET.test(line);
      const pattern = ordered ? NUMBERED : BULLET;
      const items: Inline[][] = [];
      while (i < lines.length && pattern.test(lines[i]) && !RULE.test(lines[i])) {
        m = pattern.exec(lines[i])!;
        let item = m[1];
        i += 1;
        // continuation lines (indented, not a new item) belong to the same item
        while (i < lines.length && lines[i].trim() !== "" && /^\s{2,}\S/.test(lines[i]) && !pattern.test(lines[i])) {
          item += ` ${lines[i].trim()}`;
          i += 1;
        }
        items.push(parseInline(item));
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    if (QUOTE.test(line)) {
      const parts: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        parts.push(QUOTE.exec(lines[i])![1]);
        i += 1;
      }
      blocks.push({ type: "quote", children: parseInline(parts.join(" ").trim()) });
      continue;
    }

    // paragraph: consecutive plain lines; a trailing double space or backslash is not needed, lines are joined
    const parts: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && (parts.length === 0 || !isSpecial(lines[i]))) {
      parts.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(parts.join(" ")) });
  }
  return blocks;
}

/** Plain text of some inline nodes (for previews, search snippets and accessibility labels). */
export function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => (n.type === "text" || n.type === "code" ? n.text : inlineText(n.children)))
    .join("");
}
