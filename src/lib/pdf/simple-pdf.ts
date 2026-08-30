/**
 * Minimal, deterministisk PDF 1.4-generator för demodokument.
 *
 * Skriver riktiga PDF-objekt (katalog, sidor, Helvetica med WinAnsi-kodning
 * så att å/ä/ö renderas, innehållsström, korrekt xref-tabell med byteoffsets)
 * – filerna öppnas i webbläsarens inbyggda PDF-läsare. Ingen komprimering,
 * inga tidsstämplar: samma indata ger alltid exakt samma bytes.
 *
 * Detta är INTE en generell PDF-motor – bara det som behövs för att rendera
 * trovärdiga svenska kvitton/fakturor för demo och tester.
 */

export interface PdfTextLine {
  x: number;
  /** Avstånd från sidans överkant (punkter). */
  y: number;
  text: string;
  size?: number;
  bold?: boolean;
}

export interface PdfRule {
  x: number;
  y: number;
  width: number;
  /** Tjocklek i punkter (default 0.7). */
  thickness?: number;
}

export interface SimplePdfSpec {
  lines: PdfTextLine[];
  rules?: PdfRule[];
}

const PAGE_WIDTH = 595; // A4 i punkter
const PAGE_HEIGHT = 842;

/** PDF-strängescape + Latin-1 (WinAnsi täcker svenska tecken). */
function pdfString(text: string): string {
  let out = "";
  for (const ch of text) {
    if (ch === "(" || ch === ")" || ch === "\\") {
      out += `\\${ch}`;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 32) continue;
    if (code < 128) {
      out += ch;
    } else if (code <= 255) {
      out += `\\${code.toString(8).padStart(3, "0")}`;
    } else {
      out += "?"; // utanför WinAnsi – demodokumenten håller sig till Latin-1
    }
  }
  return out;
}

function contentStream(spec: SimplePdfSpec): string {
  const parts: string[] = [];
  for (const rule of spec.rules ?? []) {
    const y = PAGE_HEIGHT - rule.y;
    const h = rule.thickness ?? 0.7;
    parts.push(`${rule.x} ${y} ${rule.width} ${h} re f`);
  }
  for (const line of spec.lines) {
    const size = line.size ?? 11;
    const font = line.bold ? "/F2" : "/F1";
    const y = PAGE_HEIGHT - line.y;
    parts.push(`BT ${font} ${size} Tf 1 0 0 1 ${line.x} ${y} Tm (${pdfString(line.text)}) Tj ET`);
  }
  return parts.join("\n");
}

/** Serialisera dokumentet till giltiga PDF-bytes (Latin-1-buffert). */
export function buildSimplePdf(spec: SimplePdfSpec): Buffer {
  const content = contentStream(spec);
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, "latin1");
}
