/**
 * Minimal, säker XML-läsare för prisfiler och XLSX-interna delar.
 *
 * Medvetet begränsad: element, attribut, text och CDATA. Ingen DTD, inga
 * externa entiteter, inga processinstruktioner som körs – ett dokument med
 * <!DOCTYPE eller <!ENTITY avvisas (XXE/"billion laughs"). Djup- och
 * storlekstak gör att en fientlig fil inte kan äta minnet.
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Sammanslagen egen text (inte barnens). */
  text: string;
}

export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlParseError";
  }
}

const MAX_DEPTH = 64;
const MAX_ELEMENTS = 2_000_000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeXmlEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/** Lokalt namn utan namnrymdsprefix: "ns:Artikel" → "Artikel". */
export function localName(name: string): string {
  const i = name.indexOf(":");
  return i >= 0 ? name.slice(i + 1) : name;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    attrs[m[1]] = decodeXmlEntities(m[2] ?? m[3] ?? "");
  }
  return attrs;
}

/** Tolka ett helt XML-dokument till ett elementträd. Kastar XmlParseError. */
export function parseXml(input: string): XmlElement {
  let src = input;
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  if (/<!DOCTYPE/i.test(src) || /<!ENTITY/i.test(src)) {
    throw new XmlParseError("XML-filen innehåller DOCTYPE/ENTITY-deklarationer, som inte stöds.");
  }

  const root: XmlElement = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  let i = 0;
  let elements = 0;
  const n = src.length;

  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      appendText(stack[stack.length - 1], src.slice(i));
      break;
    }
    if (lt > i) appendText(stack[stack.length - 1], src.slice(i, lt));

    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      if (end < 0) throw new XmlParseError("Oavslutad kommentar i XML-filen.");
      i = end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9);
      if (end < 0) throw new XmlParseError("Oavslutad CDATA i XML-filen.");
      const current = stack[stack.length - 1];
      current.text += src.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (src.startsWith("<?", lt)) {
      const end = src.indexOf("?>", lt + 2);
      if (end < 0) throw new XmlParseError("Oavslutad XML-deklaration.");
      i = end + 2;
      continue;
    }
    if (src.startsWith("<!", lt)) {
      throw new XmlParseError("XML-filen innehåller en deklaration som inte stöds.");
    }

    const gt = findTagEnd(src, lt);
    if (gt < 0) throw new XmlParseError("Oavslutad tagg i XML-filen.");
    const tag = src.slice(lt + 1, gt);
    i = gt + 1;

    if (tag.startsWith("/")) {
      const name = tag.slice(1).trim();
      const current = stack[stack.length - 1];
      if (stack.length === 1 || current.name !== name) {
        throw new XmlParseError(`Sluttaggen </${name}> matchar inte öppningstaggen.`);
      }
      current.text = current.text.trim();
      stack.pop();
      continue;
    }

    const selfClosing = tag.endsWith("/");
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const nameEnd = body.search(/[\s/]/);
    const name = (nameEnd < 0 ? body : body.slice(0, nameEnd)).trim();
    if (!name) throw new XmlParseError("Tagg utan namn i XML-filen.");
    const attrs = nameEnd < 0 ? {} : parseAttrs(body.slice(nameEnd));
    const el: XmlElement = { name, attrs, children: [], text: "" };
    elements += 1;
    if (elements > MAX_ELEMENTS) throw new XmlParseError("XML-filen innehåller för många element.");
    stack[stack.length - 1].children.push(el);
    if (!selfClosing) {
      if (stack.length >= MAX_DEPTH) throw new XmlParseError("XML-filen är för djupt nästlad.");
      stack.push(el);
    }
  }

  if (stack.length !== 1) throw new XmlParseError("XML-filen är inte komplett (taggar saknar avslut).");
  if (root.children.length !== 1) {
    throw new XmlParseError("XML-filen måste ha exakt ett rotelement.");
  }
  return root.children[0];
}

function appendText(el: XmlElement, raw: string): void {
  if (!raw) return;
  el.text += decodeXmlEntities(raw);
}

/** Hitta ">" som avslutar taggen – citerade attributvärden får innehålla ">". */
function findTagEnd(src: string, start: number): number {
  let quote: string | null = null;
  for (let j = start + 1; j < src.length; j++) {
    const ch = src[j];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return j;
  }
  return -1;
}

export function childrenNamed(el: XmlElement, name: string): XmlElement[] {
  const wanted = localName(name).toLowerCase();
  return el.children.filter((c) => localName(c.name).toLowerCase() === wanted);
}

export function firstChild(el: XmlElement, name: string): XmlElement | undefined {
  return childrenNamed(el, name)[0];
}

/** Hela textinnehållet, inklusive barnens. */
export function textContent(el: XmlElement): string {
  if (el.children.length === 0) return el.text;
  return [el.text, ...el.children.map(textContent)].filter(Boolean).join(" ").trim();
}
