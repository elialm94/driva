/**
 * Flersidig A4-PDF (1.4) för affärsdokument.
 *
 * Helvetica + WinAnsi (å/ä/ö), sidbrytning per block, sidnummer,
 * JPEG/PNG-logotyp inbäddad (inga externa assets vid render).
 */

import { inflateSync, deflateSync } from "zlib";

export const PAGE_WIDTH = 595;
export const PAGE_HEIGHT = 842;
export const MARGIN = 50;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
export const PAGE_BOTTOM = 62;

type Align = "left" | "right" | "center";

interface PdfImage {
  name: string;
  width: number;
  height: number;
  bytes: Buffer;
  filter: "DCTDecode" | "FlateDecode";
}

type DrawOp =
  | { kind: "text"; x: number; y: number; text: string; size: number; bold: boolean; align: Align; gray?: number }
  | { kind: "rule"; x: number; y: number; width: number; thickness: number; gray?: number }
  | { kind: "rect"; x: number; y: number; width: number; height: number; gray: number; fill: boolean }
  | { kind: "image"; x: number; y: number; width: number; height: number; name: string };

interface PageBuf {
  ops: DrawOp[];
}

function pdfString(text: string): string {
  let out = "";
  for (const ch of text) {
    if (ch === "(" || ch === ")" || ch === "\\") {
      out += `\\${ch}`;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 32) continue;
    if (code < 128) out += ch;
    else if (code <= 255) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += "?";
  }
  return out;
}

/** Ungefärliga Helvetica-bredder (WinAnsi) i 1000-enheter. */
function charWidth(code: number, bold: boolean): number {
  const wide = bold ? 1.08 : 1;
  if (code === 32) return 278 * wide;
  if (code >= 48 && code <= 57) return 556 * wide;
  if (code === 105 || code === 108 || code === 116 || code === 102 || code === 106 || code === 73) return 278 * wide;
  if (code === 109 || code === 119 || code === 77 || code === 87) return 833 * wide;
  if (code > 127) return 611 * wide;
  return 556 * wide;
}

export function measureText(text: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 32) continue;
    w += (charWidth(Math.min(code, 255), bold) * size) / 1000;
  }
  return w;
}

export function wrapText(text: string, size: number, maxWidth: number, bold = false): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const out: string[] = [];
  for (const para of normalized.split("\n")) {
    if (!para) {
      out.push("");
      continue;
    }
    const words = para.split(/\s+/);
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (measureText(next, size, bold) <= maxWidth) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      if (measureText(word, size, bold) <= maxWidth) {
        line = word;
        continue;
      }
      let chunk = "";
      for (const ch of word) {
        const tryChunk = chunk + ch;
        if (measureText(tryChunk, size, bold) <= maxWidth) chunk = tryChunk;
        else {
          if (chunk) out.push(chunk);
          chunk = ch;
        }
      }
      line = chunk;
    }
    if (line) out.push(line);
  }
  return out.length ? out : [""];
}

export class A4Document {
  private pages: PageBuf[] = [{ ops: [] }];
  private y = MARGIN + 8;
  private images = new Map<string, PdfImage>();
  private imageSeq = 0;
  draftWatermark = false;

  get pageCount(): number {
    return this.pages.length;
  }

  currentY(): number {
    return this.y;
  }

  remaining(): number {
    return PAGE_HEIGHT - PAGE_BOTTOM - this.y;
  }

  private page(): PageBuf {
    return this.pages[this.pages.length - 1];
  }

  newPage(): void {
    this.pages.push({ ops: [] });
    this.y = MARGIN + 8;
  }

  ensureSpace(needed: number): void {
    if (this.remaining() < needed) this.newPage();
  }

  addImageFromDataUrl(dataUrl: string): { name: string; width: number; height: number } | null {
    const parsed = decodeLogoDataUrl(dataUrl);
    if (!parsed) return null;
    const name = `Im${++this.imageSeq}`;
    this.images.set(name, { name, ...parsed });
    return { name, width: parsed.width, height: parsed.height };
  }

  text(x: number, text: string, opts?: { size?: number; bold?: boolean; align?: Align; gray?: number }): number {
    const size = opts?.size ?? 10;
    const bold = opts?.bold ?? false;
    const align = opts?.align ?? "left";
    this.page().ops.push({ kind: "text", x, y: this.y, text, size, bold, align, gray: opts?.gray });
    return measureText(text, size, bold);
  }

  line(text: string, opts?: { size?: number; bold?: boolean; x?: number; maxWidth?: number; gray?: number; align?: Align }): void {
    const size = opts?.size ?? 10;
    this.ensureSpace(size + 4);
    this.text(opts?.x ?? MARGIN, text, opts);
    this.y += size + 4;
  }

  wrapped(text: string, opts?: { size?: number; bold?: boolean; x?: number; maxWidth?: number; gray?: number; leading?: number }): void {
    const size = opts?.size ?? 10;
    const leading = opts?.leading ?? size + 3;
    const maxWidth = opts?.maxWidth ?? CONTENT_WIDTH;
    const x = opts?.x ?? MARGIN;
    const lines = wrapText(text, size, maxWidth, opts?.bold);
    for (const row of lines) {
      this.ensureSpace(leading);
      this.text(x, row, { size, bold: opts?.bold, gray: opts?.gray });
      this.y += leading;
    }
  }

  gap(n = 8): void {
    this.y += n;
  }

  rule(opts?: { x?: number; width?: number; thickness?: number; gray?: number }): void {
    this.ensureSpace(6);
    this.page().ops.push({
      kind: "rule",
      x: opts?.x ?? MARGIN,
      y: this.y,
      width: opts?.width ?? CONTENT_WIDTH,
      thickness: opts?.thickness ?? 0.6,
      gray: opts?.gray,
    });
    this.y += 6;
  }

  rect(x: number, y: number, width: number, height: number, gray: number, fill = false): void {
    this.page().ops.push({ kind: "rect", x, y, width, height, gray, fill });
  }

  drawImage(name: string, x: number, width: number, height: number): void {
    this.page().ops.push({ kind: "image", x, y: this.y, width, height, name });
  }

  moveTo(y: number): void {
    this.y = y;
  }

  build(): Buffer {
    const pageCount = this.pages.length;
    for (let i = 0; i < pageCount; i++) {
      if (this.draftWatermark) stampDraft(this.pages[i]);
      if (pageCount > 1) {
        this.pages[i].ops.push({
          kind: "text",
          x: PAGE_WIDTH / 2,
          y: PAGE_HEIGHT - 36,
          text: `Sida ${i + 1} av ${pageCount}`,
          size: 8,
          bold: false,
          align: "center",
          gray: 0.45,
        });
      }
    }

    const objects: (string | { stream: Buffer; dict: string })[] = [];
    const add = (obj: string | { stream: Buffer; dict: string }) => {
      objects.push(obj);
      return objects.length;
    };

    const font1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const font2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

    const imageIds = new Map<string, number>();
    for (const img of this.images.values()) {
      const dict =
        `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${img.filter} /Length ${img.bytes.length} >>`;
      imageIds.set(img.name, add({ stream: img.bytes, dict }));
    }

    const pageIds: number[] = [];
    for (const page of this.pages) {
      const xobjects = [...imageIds.entries()].map(([name, id]) => `/${name} ${id} 0 R`).join(" ");
      const content = pageContent(page.ops);
      const contentId = add({
        stream: Buffer.from(content, "latin1"),
        dict: `<< /Length ${Buffer.byteLength(content, "latin1")} >>`,
      });
      const resources =
        `<< /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >>` +
        (xobjects ? ` /XObject << ${xobjects} >>` : "") +
        ` >>`;
      pageIds.push(
        add(
          `<< /Type /Page /Parent __PAGES__ 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources ${resources} /Contents ${contentId} 0 R >>`
        )
      );
    }

    const pagesId = add(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`
    );
    const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

    const finalized = objects.map((obj) => {
      if (typeof obj === "string") return obj.replace("__PAGES__", String(pagesId));
      return obj;
    });

    let body = Buffer.from("%PDF-1.4\n", "latin1");
    const offsets: number[] = [];
    finalized.forEach((obj, i) => {
      offsets.push(body.length);
      if (typeof obj === "string") {
        body = Buffer.concat([body, Buffer.from(`${i + 1} 0 obj\n${obj}\nendobj\n`, "latin1")]);
      } else {
        const head = Buffer.from(`${i + 1} 0 obj\n${obj.dict}\nstream\n`, "latin1");
        const tail = Buffer.from("\nendstream\nendobj\n", "latin1");
        body = Buffer.concat([body, head, obj.stream, tail]);
      }
    });

    const xrefOffset = body.length;
    let xref = `xref\n0 ${finalized.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
      xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    const trailer = `trailer\n<< /Size ${finalized.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.concat([body, Buffer.from(xref + trailer, "latin1")]);
  }
}

function stampDraft(page: PageBuf): void {
  page.ops.unshift({
    kind: "text",
    x: PAGE_WIDTH / 2,
    y: 36,
    text: "UTKAST",
    size: 28,
    bold: true,
    align: "center",
    gray: 0.72,
  });
}

function pageY(fromTop: number): number {
  return PAGE_HEIGHT - fromTop;
}

function pageContent(ops: DrawOp[]): string {
  const parts: string[] = [];
  for (const op of ops) {
    if (op.kind === "rule") {
      const y = pageY(op.y);
      const g = op.gray ?? 0.25;
      parts.push(`${g} g ${op.x} ${y} ${op.width} ${op.thickness ?? 0.6} re f 0 g`);
    } else if (op.kind === "rect") {
      const y = pageY(op.y + op.height);
      parts.push(`${op.gray} g ${op.x} ${y} ${op.width} ${op.height} re ${op.fill ? "f" : "s"} 0 g`);
    } else if (op.kind === "image") {
      const y = pageY(op.y + op.height);
      parts.push(`q ${op.width} 0 0 ${op.height} ${op.x} ${y} cm /${op.name} Do Q`);
    } else {
      const size = op.size;
      const font = op.bold ? "/F2" : "/F1";
      const y = pageY(op.y + size * 0.8);
      let x = op.x;
      const w = measureText(op.text, size, op.bold);
      if (op.align === "right") x = op.x - w;
      if (op.align === "center") x = op.x - w / 2;
      const gray = op.gray ?? 0;
      const color = gray === 0 ? "" : `${gray} g `;
      const reset = gray === 0 ? "" : " 0 g";
      parts.push(`${color}BT ${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfString(op.text)}) Tj ET${reset}`);
    }
  }
  return parts.join("\n");
}

function decodeLogoDataUrl(dataUrl: string): Omit<PdfImage, "name"> | null {
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const kind = match[1].toLowerCase();
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  } catch {
    return null;
  }
  if (kind === "jpeg" || kind === "jpg") {
    const dim = jpegSize(bytes);
    if (!dim) return null;
    return { width: dim.w, height: dim.h, bytes, filter: "DCTDecode" };
  }
  const png = pngToRgb(bytes);
  if (!png) return null;
  const compressed = deflateSync(png.rgb);
  return { width: png.width, height: png.height, bytes: compressed, filter: "FlateDecode" };
}

function jpegSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/** 8-bit RGB/RGBA/grayscale PNG → rå RGB. */
function pngToRgb(buf: Buffer): { width: number; height: number; rgb: Buffer } | null {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(sig)) return null;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  let offset = 8;
  while (offset + 12 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[12] !== 0) return null;
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + len;
  }
  if (!width || !height || bitDepth !== 8) return null;
  if (![0, 2, 4, 6].includes(colorType)) return null;
  if (width * height > 2_000_000) return null;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const bpp = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
  const stride = width * bpp;
  const expected = height * (stride + 1);
  if (raw.length < expected) return null;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const slice = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const prev = y > 0 ? rows[y - 1] : Buffer.alloc(stride);
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = prev[x];
      const upLeft = x >= bpp ? prev[x - bpp] : 0;
      const v = slice[x];
      if (filter === 0) row[x] = v;
      else if (filter === 1) row[x] = (v + left) & 255;
      else if (filter === 2) row[x] = (v + up) & 255;
      else if (filter === 3) row[x] = (v + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) row[x] = (v + paeth(left, up, upLeft)) & 255;
      else return null;
    }
    rows.push(row);
  }
  const rgb = Buffer.alloc(width * height * 3);
  let o = 0;
  for (const row of rows) {
    for (let x = 0; x < width; x++) {
      if (colorType === 0) {
        const g = row[x];
        rgb[o++] = g;
        rgb[o++] = g;
        rgb[o++] = g;
      } else if (colorType === 2) {
        rgb[o++] = row[x * 3];
        rgb[o++] = row[x * 3 + 1];
        rgb[o++] = row[x * 3 + 2];
      } else if (colorType === 4) {
        const g = row[x * 2];
        rgb[o++] = g;
        rgb[o++] = g;
        rgb[o++] = g;
      } else {
        rgb[o++] = row[x * 4];
        rgb[o++] = row[x * 4 + 1];
        rgb[o++] = row[x * 4 + 2];
      }
    }
  }
  return { width, height, rgb };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
