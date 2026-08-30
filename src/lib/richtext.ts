/**
 * Rik text för dokumentens beskrivning (offerter + fakturor).
 *
 * Lagringsformatet är en STRIKT delmängd av TipTap/ProseMirror-dokument-JSON –
 * aldrig HTML. Vitlistan är avsiktligt liten för konsekventa, professionella
 * dokument:
 *
 *   Noder:  doc, paragraph, heading (nivå 1–3), bulletList, orderedList,
 *           listItem, text, hardBreak, horizontalRule
 *   Marks:  bold, italic, underline, link (endast http/https/mailto)
 *
 * `sanitizeRichText` är den enda vägen in i domänen och körs vid VARJE
 * servergräns (spara-actions, AI-utdata). Den släpper bara igenom vitlistan,
 * klampar rubriknivåer, kastar okända attribut och begränsar storlek/djup.
 *
 * Markdown-hjälparna (`richTextToMarkdown`/`markdownToRichText`) är egna,
 * deterministiska implementationer av exakt samma delmängd – de används för
 * AI-flödet (modellen läser/skriver markdown, aldrig HTML eller rå JSON).
 */

/* --------------------------------- Typer --------------------------------- */

export type RichTextMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "link"; attrs: { href: string } };

export interface RichTextTextNode {
  type: "text";
  text: string;
  marks?: RichTextMark[];
}

export interface RichTextHardBreak {
  type: "hardBreak";
}

export type RichTextInline = RichTextTextNode | RichTextHardBreak;

export interface RichTextParagraph {
  type: "paragraph";
  content?: RichTextInline[];
}

export interface RichTextHeading {
  type: "heading";
  attrs: { level: 1 | 2 | 3 };
  content?: RichTextInline[];
}

export interface RichTextListItem {
  type: "listItem";
  content: RichTextListItemBlock[];
}

export type RichTextListItemBlock = RichTextParagraph | RichTextBulletList | RichTextOrderedList;

export interface RichTextBulletList {
  type: "bulletList";
  content: RichTextListItem[];
}

export interface RichTextOrderedList {
  type: "orderedList";
  content: RichTextListItem[];
}

export interface RichTextHorizontalRule {
  type: "horizontalRule";
}

export type RichTextBlock =
  | RichTextParagraph
  | RichTextHeading
  | RichTextBulletList
  | RichTextOrderedList
  | RichTextHorizontalRule;

export interface RichTextDoc {
  type: "doc";
  content: RichTextBlock[];
}

/* --------------------------------- Gränser -------------------------------- */

/** Tak för serialiserad JSON – skyddar lagring och publika sidor. */
export const RICHTEXT_MAX_JSON_CHARS = 40_000;
/** Tak för ren text – innehåll bortom taket klipps blockvis. */
export const RICHTEXT_MAX_TEXT_CHARS = 10_000;
/** Maxdjup för nästlade listor (dokument → block → listItem → lista → …). */
export const RICHTEXT_MAX_DEPTH = 10;

/* ------------------------------- Sanering -------------------------------- */

type UnknownRecord = Record<string, unknown>;

function asRecord(v: unknown): UnknownRecord | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as UnknownRecord) : null;
}

/** Endast http/https/mailto. javascript:, data: och allt annat avvisas. */
export function sanitizeLinkHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const href = raw.trim();
  if (href.length === 0 || href.length > 2000) return null;
  if (/^https?:\/\/\S+$/i.test(href)) return href;
  if (/^mailto:\S+@\S+$/i.test(href)) return href;
  return null;
}

/** Kontrolltecken och radbrytningar hör inte hemma i textnoder (hardBreak finns). */
function cleanText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\r\n\t]/g, " ").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

const MARK_ORDER: Record<RichTextMark["type"], number> = { bold: 0, italic: 1, underline: 2, link: 3 };

/** Vitlistade marks, deduplicerade och i kanonisk ordning (deterministisk hashyta). */
function sanitizeMarks(raw: unknown): RichTextMark[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = new Map<RichTextMark["type"], RichTextMark>();
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    if (rec.type === "bold" || rec.type === "italic" || rec.type === "underline") {
      if (!out.has(rec.type)) out.set(rec.type, { type: rec.type });
    } else if (rec.type === "link") {
      const href = sanitizeLinkHref(asRecord(rec.attrs)?.href);
      if (href && !out.has("link")) out.set("link", { type: "link", attrs: { href } });
    }
  }
  if (out.size === 0) return undefined;
  return [...out.values()].sort((a, b) => MARK_ORDER[a.type] - MARK_ORDER[b.type]);
}

function sanitizeInline(raw: unknown): RichTextInline[] {
  if (!Array.isArray(raw)) return [];
  const out: RichTextInline[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    if (rec.type === "text") {
      const text = cleanText(rec.text);
      if (text === null) continue;
      const marks = sanitizeMarks(rec.marks);
      out.push(marks ? { type: "text", text, marks } : { type: "text", text });
    } else if (rec.type === "hardBreak") {
      out.push({ type: "hardBreak" });
    }
    // Allt annat (bilder, mentions, okända inline-noder) kastas.
  }
  // Inledande/avslutande hardBreaks utan text runt sig ger bara tomrum.
  while (out.length > 0 && out[0].type === "hardBreak") out.shift();
  while (out.length > 0 && out[out.length - 1].type === "hardBreak") out.pop();
  return out;
}

function clampHeadingLevel(raw: unknown): 1 | 2 | 3 {
  const n = typeof raw === "number" ? Math.trunc(raw) : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(3, Math.max(1, n)) as 1 | 2 | 3;
}

function sanitizeListItems(raw: unknown, depth: number): RichTextListItem[] {
  if (!Array.isArray(raw) || depth > RICHTEXT_MAX_DEPTH) return [];
  const items: RichTextListItem[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec || rec.type !== "listItem") continue;
    const blocks: RichTextListItemBlock[] = [];
    if (Array.isArray(rec.content)) {
      for (const child of rec.content) {
        const childRec = asRecord(child);
        if (!childRec) continue;
        if (childRec.type === "paragraph") {
          const content = sanitizeInline(childRec.content);
          blocks.push(content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" });
        } else if (childRec.type === "bulletList" || childRec.type === "orderedList") {
          const nested = sanitizeListItems(childRec.content, depth + 1);
          if (nested.length > 0) blocks.push({ type: childRec.type, content: nested });
        }
        // Rubriker/HR m.m. inuti listpunkter stöds inte – kastas.
      }
    }
    if (blocks.length === 0) blocks.push({ type: "paragraph" });
    items.push({ type: "listItem", content: blocks });
  }
  return items;
}

function sanitizeBlocks(raw: unknown, depth: number): RichTextBlock[] {
  if (!Array.isArray(raw) || depth > RICHTEXT_MAX_DEPTH) return [];
  const out: RichTextBlock[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    if (rec.type === "paragraph") {
      const content = sanitizeInline(rec.content);
      out.push(content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" });
    } else if (rec.type === "heading") {
      const content = sanitizeInline(rec.content);
      const level = clampHeadingLevel(asRecord(rec.attrs)?.level);
      out.push(content.length > 0 ? { type: "heading", attrs: { level }, content } : { type: "heading", attrs: { level } });
    } else if (rec.type === "bulletList" || rec.type === "orderedList") {
      const items = sanitizeListItems(rec.content, depth + 1);
      if (items.length > 0) out.push({ type: rec.type, content: items });
    } else if (rec.type === "horizontalRule") {
      out.push({ type: "horizontalRule" });
    }
    // Okända block (tabeller, bilder, rå HTML-noder …) kastas.
  }
  return out;
}

/** Klipp blockvis så att den totala textmängden håller sig under taket. */
function capTextLength(blocks: RichTextBlock[]): RichTextBlock[] {
  let budget = RICHTEXT_MAX_TEXT_CHARS;

  function capInline(content: RichTextInline[] | undefined): RichTextInline[] | undefined {
    if (!content) return content;
    const out: RichTextInline[] = [];
    for (const node of content) {
      if (budget <= 0) break;
      if (node.type === "hardBreak") {
        out.push(node);
        continue;
      }
      if (node.text.length <= budget) {
        budget -= node.text.length;
        out.push(node);
      } else {
        const text = node.text.slice(0, budget);
        budget = 0;
        if (text.length > 0) out.push(node.marks ? { type: "text", text, marks: node.marks } : { type: "text", text });
      }
    }
    return out.length > 0 ? out : undefined;
  }

  function capItems(items: RichTextListItem[]): RichTextListItem[] {
    const out: RichTextListItem[] = [];
    for (const item of items) {
      if (budget <= 0) break;
      const blocks: RichTextListItemBlock[] = [];
      for (const block of item.content) {
        if (budget <= 0) break;
        if (block.type === "paragraph") {
          const content = capInline(block.content);
          blocks.push(content ? { type: "paragraph", content } : { type: "paragraph" });
        } else {
          const nested = capItems(block.content);
          if (nested.length > 0) blocks.push({ type: block.type, content: nested });
        }
      }
      if (blocks.length === 0) blocks.push({ type: "paragraph" });
      out.push({ type: "listItem", content: blocks });
    }
    return out;
  }

  const out: RichTextBlock[] = [];
  for (const block of blocks) {
    if (budget <= 0) break;
    if (block.type === "paragraph" || block.type === "heading") {
      const content = capInline(block.content);
      if (block.type === "heading") {
        out.push(content ? { type: "heading", attrs: block.attrs, content } : { type: "heading", attrs: block.attrs });
      } else {
        out.push(content ? { type: "paragraph", content } : { type: "paragraph" });
      }
    } else if (block.type === "horizontalRule") {
      out.push(block);
    } else {
      const items = capItems(block.content);
      if (items.length > 0) out.push({ type: block.type, content: items });
    }
  }
  return out;
}

/**
 * Vitlistesanering av okänd JSON till en giltig RichTextDoc.
 * Returnerar undefined för allt som är tomt, ogiltigt eller inte ett dokument –
 * "inget innehåll" lagras alltid som frånvarande fält, aldrig som tomt dokument.
 */
export function sanitizeRichText(input: unknown): RichTextDoc | undefined {
  const rec = asRecord(input);
  if (!rec || rec.type !== "doc") return undefined;
  let blocks = sanitizeBlocks(rec.content, 1);
  if (blocks.length === 0) return undefined;
  blocks = capTextLength(blocks);
  let doc: RichTextDoc = { type: "doc", content: blocks };
  if (isRichTextEmpty(doc)) return undefined;
  // JSON-taket i sista hand (strukturtung skräpdata med lite text): klipp bakifrån.
  while (doc.content.length > 1 && JSON.stringify(doc).length > RICHTEXT_MAX_JSON_CHARS) {
    doc = { type: "doc", content: doc.content.slice(0, -1) };
  }
  if (JSON.stringify(doc).length > RICHTEXT_MAX_JSON_CHARS) return undefined;
  if (isRichTextEmpty(doc)) return undefined;
  return doc;
}

/* ----------------------------- Kanonisk form ----------------------------- */

/**
 * Nyckelsorterad djupkopia för hashning. jsonb i Postgres bevarar inte
 * nyckelordning, så contentHash för offertversioner måste räknas på en
 * kanonisk form som överlever en databasrundresa.
 */
export function canonicalRichText(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalRichText);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalRichText((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/* ------------------------------- Ren text -------------------------------- */

function inlineToPlain(content: RichTextInline[] | undefined): string {
  if (!content) return "";
  return content.map((n) => (n.type === "hardBreak" ? "\n" : n.text)).join("");
}

function listToPlain(items: RichTextListItem[], ordered: boolean, indent: string): string[] {
  const lines: string[] = [];
  items.forEach((item, i) => {
    const marker = ordered ? `${i + 1}. ` : "- ";
    let first = true;
    for (const block of item.content) {
      if (block.type === "paragraph") {
        const text = inlineToPlain(block.content);
        if (first) {
          lines.push(`${indent}${marker}${text}`);
          first = false;
        } else if (text.length > 0) {
          lines.push(`${indent}  ${text}`);
        }
      } else {
        if (first) {
          lines.push(`${indent}${marker}`);
          first = false;
        }
        lines.push(...listToPlain(block.content, block.type === "orderedList", `${indent}  `));
      }
    }
  });
  return lines;
}

/** Ren text för AI-underlag, e-post och tomhetskontroll. Ingen markdown-syntax i löptext. */
export function richTextToPlain(doc: RichTextDoc | null | undefined): string {
  if (!doc || !Array.isArray(doc.content)) return "";
  const parts: string[] = [];
  for (const block of doc.content) {
    if (block.type === "paragraph" || block.type === "heading") {
      const text = inlineToPlain(block.content);
      if (text.trim().length > 0) parts.push(text);
    } else if (block.type === "bulletList" || block.type === "orderedList") {
      const lines = listToPlain(block.content, block.type === "orderedList", "");
      if (lines.length > 0) parts.push(lines.join("\n"));
    }
    // horizontalRule bidrar inte med text.
  }
  return parts.join("\n\n");
}

/** Tomt = ingen läsbar text alls (enbart HR/tomma stycken räknas som tomt). */
export function isRichTextEmpty(doc: RichTextDoc | null | undefined): boolean {
  if (!doc) return true;
  return richTextToPlain(doc).trim().length === 0;
}

/* ------------------------------- Markdown -------------------------------- */
/*
 * Egen, deterministisk serialisering/parsning av exakt samma delmängd:
 *   # ## ###   rubriker (nivå 1–3)
 *   - punkt    punktlista (även * + •)   1. punkt   numrerad lista
 *   **fet**    *kursiv* eller _kursiv_   ++understruken++   [text](url)   ---   hård radbrytning = enkel \n
 * Nästlade listor indenteras med två mellanslag per nivå.
 * HTML tolkas ALDRIG – okänd syntax blir bokstavlig text.
 */

function escapeInline(text: string): string {
  return text.replace(/([\\*_[\]+])/g, "\\$1");
}

function inlineToMarkdown(content: RichTextInline[] | undefined): string {
  if (!content) return "";
  return content
    .map((node) => {
      if (node.type === "hardBreak") return "\n";
      let s = escapeInline(node.text);
      const marks = node.marks ?? [];
      if (marks.some((m) => m.type === "italic")) s = `*${s}*`;
      if (marks.some((m) => m.type === "bold")) s = `**${s}**`;
      if (marks.some((m) => m.type === "underline")) s = `++${s}++`;
      const link = marks.find((m) => m.type === "link");
      if (link && link.type === "link") s = `[${s}](${link.attrs.href})`;
      return s;
    })
    .join("");
}

function listToMarkdown(items: RichTextListItem[], ordered: boolean, depth: number): string[] {
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  items.forEach((item, i) => {
    const marker = ordered ? `${i + 1}. ` : "- ";
    const contIndent = indent + " ".repeat(marker.length);
    let first = true;
    for (const block of item.content) {
      if (block.type === "paragraph") {
        const text = inlineToMarkdown(block.content).split("\n");
        for (const [j, line] of text.entries()) {
          if (first && j === 0) {
            lines.push(`${indent}${marker}${line}`);
            first = false;
          } else {
            lines.push(`${contIndent}${line}`);
          }
        }
        if (first) {
          lines.push(`${indent}${marker}`);
          first = false;
        }
      } else {
        if (first) {
          lines.push(`${indent}${marker}`);
          first = false;
        }
        lines.push(...listToMarkdown(block.content, block.type === "orderedList", depth + 1));
      }
    }
  });
  return lines;
}

/** Serialisera till markdown-delmängden (AI-indata). */
export function richTextToMarkdown(doc: RichTextDoc | null | undefined): string {
  if (!doc || !Array.isArray(doc.content)) return "";
  const parts: string[] = [];
  for (const block of doc.content) {
    if (block.type === "heading") {
      parts.push(`${"#".repeat(block.attrs.level)} ${inlineToMarkdown(block.content)}`);
    } else if (block.type === "paragraph") {
      parts.push(inlineToMarkdown(block.content));
    } else if (block.type === "horizontalRule") {
      parts.push("---");
    } else {
      parts.push(listToMarkdown(block.content, block.type === "orderedList", 0).join("\n"));
    }
  }
  return parts.join("\n\n").trim();
}

/* ----------------------------- Markdown-parser ---------------------------- */

interface InlineParseResult {
  nodes: RichTextInline[];
}

function pushText(nodes: RichTextInline[], text: string, marks: RichTextMark[]): void {
  if (text.length === 0) return;
  const last = nodes[nodes.length - 1];
  const sortedMarks = marks.length > 0 ? [...marks].sort((a, b) => MARK_ORDER[a.type] - MARK_ORDER[b.type]) : undefined;
  if (
    last &&
    last.type === "text" &&
    JSON.stringify(last.marks ?? []) === JSON.stringify(sortedMarks ?? [])
  ) {
    last.text += text;
    return;
  }
  nodes.push(sortedMarks ? { type: "text", text, marks: sortedMarks } : { type: "text", text });
}

function withMark(marks: RichTextMark[], mark: RichTextMark): RichTextMark[] {
  if (marks.some((m) => m.type === mark.type)) return marks;
  return [...marks, mark];
}

/** Rekursiv inline-parser: escapes, [text](url), **fet**, *kursiv*, _kursiv_. */
function parseInlineInto(nodes: RichTextInline[], src: string, marks: RichTextMark[]): void {
  let i = 0;
  let literal = "";
  const flush = () => {
    pushText(nodes, literal, marks);
    literal = "";
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length) {
      literal += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "[") {
      const closeBracket = findClosingBracket(src, i);
      if (closeBracket !== -1 && src[closeBracket + 1] === "(") {
        const closeParen = src.indexOf(")", closeBracket + 2);
        if (closeParen !== -1) {
          const label = src.slice(i + 1, closeBracket);
          const href = sanitizeLinkHref(src.slice(closeBracket + 2, closeParen));
          if (href) {
            flush();
            parseInlineInto(nodes, label, withMark(marks, { type: "link", attrs: { href } }));
            i = closeParen + 1;
            continue;
          }
        }
      }
      literal += ch;
      i += 1;
      continue;
    }
    if (src.startsWith("++", i)) {
      const close = src.indexOf("++", i + 2);
      if (close !== -1 && close > i + 2) {
        flush();
        parseInlineInto(nodes, src.slice(i + 2, close), withMark(marks, { type: "underline" }));
        i = close + 2;
        continue;
      }
      literal += "++";
      i += 2;
      continue;
    }
    if (src.startsWith("**", i)) {
      let close = src.indexOf("**", i + 2);
      // Stjärnrun-tvetydighet (***): om innertexten har en obalanserad enkel
      // stjärna hör nästa stjärna till kursiven, inte fetstilens stängning.
      // Så parsas **fet *kursiv i*** och ***allt*** deterministiskt rätt.
      while (close !== -1 && src[close + 2] === "*" && countUnescapedStars(src.slice(i + 2, close)) % 2 === 1) {
        close += 1;
      }
      if (close !== -1 && close > i + 2) {
        flush();
        parseInlineInto(nodes, src.slice(i + 2, close), withMark(marks, { type: "bold" }));
        i = close + 2;
        continue;
      }
      literal += "**";
      i += 2;
      continue;
    }
    if (ch === "*" || ch === "_") {
      const close = src.indexOf(ch, i + 1);
      if (close !== -1 && close > i + 1) {
        flush();
        parseInlineInto(nodes, src.slice(i + 1, close), withMark(marks, { type: "italic" }));
        i = close + 1;
        continue;
      }
      literal += ch;
      i += 1;
      continue;
    }
    literal += ch;
    i += 1;
  }
  flush();
}

/** Antal oescapade * i en delsträng (för stjärnrun-tvetydigheten ovan). */
function countUnescapedStars(src: string): number {
  return src.replace(/\\./g, "").split("*").length - 1;
}

/** Hitta matchande ] med stöd för escapade tecken. */
function findClosingBracket(src: string, open: number): number {
  for (let i = open + 1; i < src.length; i += 1) {
    if (src[i] === "\\") {
      i += 1;
      continue;
    }
    if (src[i] === "]") return i;
  }
  return -1;
}

function parseInline(src: string): InlineParseResult {
  const nodes: RichTextInline[] = [];
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    if (i > 0) nodes.push({ type: "hardBreak" });
    parseInlineInto(nodes, line, []);
  });
  // Ta bort tomma kantbrytningar (samma regel som saneraren).
  while (nodes.length > 0 && nodes[0].type === "hardBreak") nodes.shift();
  while (nodes.length > 0 && nodes[nodes.length - 1].type === "hardBreak") nodes.pop();
  return { nodes };
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const LIST_ITEM_RE = /^(\s*)(?:([-*+•])|(\d{1,3})[.)])\s+(.*)$/;

interface ListFrame {
  list: RichTextBulletList | RichTextOrderedList;
  indent: number;
}

/**
 * Deterministisk parser för markdown-delmängden. Rader som inte matchar
 * någon känd konstruktion blir vanliga stycken – HTML och okänd syntax
 * tolkas aldrig, de blir bokstavlig text.
 */
export function markdownToRichText(markdown: string): RichTextDoc | undefined {
  if (typeof markdown !== "string") return undefined;
  const blocks: RichTextBlock[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");

  let paragraph: string[] = [];
  let listStack: ListFrame[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const { nodes } = parseInline(paragraph.join("\n"));
    blocks.push(nodes.length > 0 ? { type: "paragraph", content: nodes } : { type: "paragraph" });
    paragraph = [];
  };

  const closeLists = () => {
    if (listStack.length > 0 && listStack[0]) blocks.push(listStack[0].list);
    listStack = [];
  };

  const lastItemOfStack = (): RichTextListItem | null => {
    const frame = listStack[listStack.length - 1];
    if (!frame) return null;
    return frame.list.content[frame.list.content.length - 1] ?? null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");

    if (line.trim().length === 0) {
      flushParagraph();
      // Blankrad inuti en lista tolereras (modeller skriver ofta "glesa" listor)
      // – listan stängs först när något som inte är en listrad dyker upp.
      continue;
    }

    const heading = HEADING_RE.exec(line.trim());
    if (heading) {
      flushParagraph();
      closeLists();
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
      const { nodes } = parseInline(heading[2].trim());
      blocks.push(nodes.length > 0 ? { type: "heading", attrs: { level }, content: nodes } : { type: "heading", attrs: { level } });
      continue;
    }

    if (HR_RE.test(line.trim())) {
      flushParagraph();
      closeLists();
      blocks.push({ type: "horizontalRule" });
      continue;
    }

    const item = LIST_ITEM_RE.exec(line);
    if (item) {
      flushParagraph();
      const indent = item[1].length;
      const ordered = item[3] !== undefined;
      const text = item[4];

      // Poppa djupare nivåer tills toppen matchar indraget.
      while (listStack.length > 1 && indent < listStack[listStack.length - 1].indent) {
        listStack.pop();
      }

      const top = listStack[listStack.length - 1];
      const type = ordered ? ("orderedList" as const) : ("bulletList" as const);

      if (!top) {
        const list = { type, content: [] as RichTextListItem[] };
        listStack.push({ list, indent });
      } else if (indent > top.indent && listStack.length < RICHTEXT_MAX_DEPTH) {
        // Nästlad lista under senaste punkten.
        const parent = lastItemOfStack();
        const list = { type, content: [] as RichTextListItem[] };
        if (parent) {
          parent.content.push(list);
          listStack.push({ list, indent });
        } else {
          closeLists();
          listStack.push({ list, indent });
        }
      } else if (top.list.type !== type) {
        // Ny listtyp på samma nivå: stäng och börja om.
        closeLists();
        const list = { type, content: [] as RichTextListItem[] };
        listStack.push({ list, indent });
      }

      const frame = listStack[listStack.length - 1];
      const { nodes } = parseInline(text.trim());
      frame.list.content.push({
        type: "listItem",
        content: [nodes.length > 0 ? { type: "paragraph", content: nodes } : { type: "paragraph" }],
      });
      continue;
    }

    // Indragen fortsättningsrad i en lista → hård radbrytning i senaste punkten.
    if (listStack.length > 0 && /^\s{2,}/.test(line)) {
      const last = lastItemOfStack();
      const para = last?.content.find((b): b is RichTextParagraph => b.type === "paragraph");
      if (last && para) {
        const { nodes } = parseInline(line.trim());
        if (nodes.length > 0) {
          para.content = [...(para.content ?? []), { type: "hardBreak" }, ...nodes];
        }
        continue;
      }
    }

    closeLists();
    paragraph.push(line.trim());
  }

  flushParagraph();
  closeLists();

  if (blocks.length === 0) return undefined;
  return { type: "doc", content: blocks };
}
