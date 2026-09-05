/**
 * Beställningsmejlet till grossisten: ämne, textversion, HTML-tabell samt
 * bilagor (CSV + PDF). Ren funktion av snapshoten – samma innehåll varje gång
 * (det som skickas är det som fryses på ordern).
 */
import type { PurchaseOrderSentSnapshot, PurchaseOrderSnapshotLine } from "../types";
import { datumLang } from "../format";
import { DELIVERY_MODE_LABELS } from "../wholesalers/labels";
import { formatOre } from "../wholesalers/money";
import { buildSimplePdfPages, type PdfRule, type PdfTextLine, type SimplePdfSpec } from "../pdf/simple-pdf";
import { escapeHtml } from "./templates";

export type PurchaseOrderMailInput = Omit<PurchaseOrderSentSnapshot, "sentAt" | "textBody" | "transport" | "subject" | "to" | "cc" | "replyTo" | "channel"> & {
  reference: string;
  replyTo: string;
};

export function purchaseOrderSubject(input: { reference: string; companyName: string; customerNumber: string }): string {
  return `Beställning ${input.reference} – ${input.companyName} – kundnr ${input.customerNumber}`;
}

function qtyLabel(line: PurchaseOrderSnapshotLine): string {
  const qty = line.qty.toLocaleString("sv-SE");
  return `${qty} ${line.unit}${line.packSize ? ` (förp. ${line.packSize.toLocaleString("sv-SE")})` : ""}`;
}

function deliveryLines(input: PurchaseOrderMailInput): string[] {
  const out = [`${DELIVERY_MODE_LABELS[input.delivery.mode]}`];
  if (input.delivery.mode === "pickup" && input.delivery.store) out.push(`Butik/hämtställe: ${input.delivery.store}`);
  if (input.delivery.mode === "delivery" && input.delivery.address) out.push(`Leveransadress: ${input.delivery.address}`);
  if (input.delivery.requestedDate) out.push(`Önskat datum: ${datumLang(input.delivery.requestedDate)}`);
  return out;
}

export const REPLY_INSTRUCTION =
  "Svara på det här mejlet med er orderbekräftelse (ordernummer, bekräftade antal, priser och leveransdatum). Svaret hamnar automatiskt hos oss.";

export function purchaseOrderText(input: PurchaseOrderMailInput): string {
  const lines: string[] = [
    `Beställning ${input.reference}`,
    "",
    `Från: ${input.companyName} (org.nr ${input.orgNumber})`,
    `Kundnummer hos ${input.wholesalerName}: ${input.customerNumber}`,
    `Beställare: ${input.orderer.name}, ${input.orderer.email}, ${input.orderer.phone}`,
    `Uppdrag/märkning: ${input.jobTitle}`,
    `Vår referens: ${input.reference}`,
    "",
    ...deliveryLines(input),
    "",
    "Artiklar:",
  ];
  input.lines.forEach((l, i) => {
    const parts = [
      `${i + 1}. ${l.articleNumber ? `Art.nr ${l.articleNumber} – ` : ""}${l.name}`,
      `   Antal: ${qtyLabel(l)}`,
    ];
    if (l.eNumber) parts.push(`   E-nr: ${l.eNumber}`);
    if (l.rskNumber) parts.push(`   RSK: ${l.rskNumber}`);
    if (l.note) parts.push(`   Kommentar: ${l.note}`);
    lines.push(...parts);
  });
  if (input.message) {
    lines.push("", "Meddelande:", input.message);
  }
  lines.push("", REPLY_INSTRUCTION, "", `Med vänliga hälsningar`, input.orderer.name, input.companyName);
  return lines.join("\n");
}

export function purchaseOrderHtml(input: PurchaseOrderMailInput): string {
  const rows = input.lines
    .map(
      (l, i) => `<tr>
  <td style="padding:6px 8px;border-bottom:1px solid #e8e4dc;font-size:13px;color:#6b665c;">${i + 1}</td>
  <td style="padding:6px 8px;border-bottom:1px solid #e8e4dc;font-size:14px;">${escapeHtml(l.articleNumber ?? "–")}</td>
  <td style="padding:6px 8px;border-bottom:1px solid #e8e4dc;font-size:14px;">${escapeHtml(l.name)}${
    l.eNumber || l.rskNumber
      ? `<br><span style="font-size:12px;color:#6b665c;">${[l.eNumber ? `E-nr ${escapeHtml(l.eNumber)}` : "", l.rskNumber ? `RSK ${escapeHtml(l.rskNumber)}` : ""].filter(Boolean).join(" · ")}</span>`
      : ""
  }${l.note ? `<br><span style="font-size:12px;color:#6b665c;">${escapeHtml(l.note)}</span>` : ""}</td>
  <td style="padding:6px 8px;border-bottom:1px solid #e8e4dc;font-size:14px;white-space:nowrap;text-align:right;">${escapeHtml(qtyLabel(l))}</td>
</tr>`,
    )
    .join("\n");
  const meta: [string, string][] = [
    ["Från", `${input.companyName} (org.nr ${input.orgNumber})`],
    ["Kundnummer", input.customerNumber],
    ["Beställare", `${input.orderer.name}, ${input.orderer.email}, ${input.orderer.phone}`],
    ["Uppdrag/märkning", input.jobTitle],
    ["Vår referens", input.reference],
    ["Leverans", deliveryLines(input).join(" · ")],
  ];
  return `<!DOCTYPE html>
<html lang="sv">
<body style="margin:0;padding:0;background:#f6f5f2;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:#1a1916;">
  <div style="max-width:680px;margin:24px auto;padding:28px 24px;background:#fff;border-radius:16px;border:1px solid #e8e4dc;">
    <p style="margin:0 0 6px;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:#6b665c;">Beställning</p>
    <h1 style="margin:0 0 16px;font-size:22px;">${escapeHtml(input.reference)}</h1>
    <table style="border-collapse:collapse;margin:0 0 20px;">
      ${meta
        .map(
          ([k, v]) =>
            `<tr><td style="padding:2px 12px 2px 0;font-size:13px;color:#6b665c;vertical-align:top;">${escapeHtml(k)}</td><td style="padding:2px 0;font-size:14px;">${escapeHtml(v)}</td></tr>`,
        )
        .join("\n")}
    </table>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #1a1916;font-size:12px;">#</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #1a1916;font-size:12px;">Art.nr</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #1a1916;font-size:12px;">Benämning</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #1a1916;font-size:12px;">Antal</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    ${input.message ? `<p style="margin:20px 0 0;font-size:14px;line-height:1.55;"><strong>Meddelande:</strong><br>${escapeHtml(input.message).replace(/\n/g, "<br>")}</p>` : ""}
    <p style="margin:24px 0 0;padding:12px 14px;background:#f6f5f2;border-radius:12px;font-size:14px;line-height:1.5;">${escapeHtml(REPLY_INSTRUCTION)}</p>
    <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#6b665c;">${escapeHtml(input.orderer.name)} · ${escapeHtml(input.companyName)} · Skickat via Ferva</p>
  </div>
</body>
</html>`;
}

/** CSV-cell: citera, dubbla citat, neutralisera formler (=, +, -, @). */
export function csvCell(value: string | number | undefined | null): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function purchaseOrderCsv(input: PurchaseOrderMailInput): string {
  const header = ["Referens", "Artikelnummer", "E-nummer", "RSK-nummer", "Benämning", "Antal", "Enhet", "Förpackning", "Kommentar"];
  const rows = input.lines.map((l) =>
    [
      input.reference,
      l.articleNumber ?? "",
      l.eNumber ?? "",
      l.rskNumber ?? "",
      l.name,
      l.qty.toLocaleString("sv-SE"),
      l.unit,
      l.packSize != null ? l.packSize.toLocaleString("sv-SE") : "",
      l.note ?? "",
    ]
      .map(csvCell)
      .join(";"),
  );
  // BOM så att Excel läser å/ä/ö rätt.
  return `\ufeff${[header.map(csvCell).join(";"), ...rows].join("\r\n")}\r\n`;
}

const PDF_TOP = 60;
const PDF_BOTTOM = 790;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function purchaseOrderPdf(input: PurchaseOrderMailInput): Buffer {
  const pages: SimplePdfSpec[] = [];
  let lines: PdfTextLine[] = [];
  let rules: PdfRule[] = [];
  let y = PDF_TOP;
  let pageNo = 1;

  const newPage = () => {
    pages.push({ lines, rules });
    lines = [];
    rules = [];
    y = PDF_TOP;
    pageNo += 1;
    lines.push({ x: 56, y, text: `Beställning ${input.reference} – sida ${pageNo}`, size: 10, bold: true });
    y += 24;
    header();
  };
  const header = () => {
    rules.push({ x: 56, y: y - 12, width: 483 });
    lines.push({ x: 56, y, text: "Art.nr", size: 9, bold: true });
    lines.push({ x: 150, y, text: "Benämning", size: 9, bold: true });
    lines.push({ x: 450, y, text: "Antal", size: 9, bold: true });
    y += 6;
    rules.push({ x: 56, y, width: 483 });
    y += 16;
  };

  lines.push({ x: 56, y, text: input.companyName, size: 18, bold: true });
  lines.push({ x: 380, y, text: `Beställning ${input.reference}`, size: 14, bold: true });
  y += 18;
  lines.push({ x: 56, y, text: `Org.nr ${input.orgNumber} · Skickat via Ferva`, size: 9 });
  y += 26;
  const meta: [string, string][] = [
    ["Till", input.wholesalerName],
    ["Kundnummer", input.customerNumber],
    ["Beställare", `${input.orderer.name}, ${input.orderer.phone}`],
    ["E-post", input.orderer.email],
    ["Uppdrag", truncate(input.jobTitle, 70)],
    ...deliveryLines(input).map((d, i) => [i === 0 ? "Leverans" : "", d] as [string, string]),
  ];
  for (const [label, value] of meta) {
    if (label) lines.push({ x: 56, y, text: label, size: 9 });
    lines.push({ x: 150, y, text: truncate(value, 80), size: 10, bold: label !== "" });
    y += 15;
  }
  y += 14;
  header();

  input.lines.forEach((l) => {
    const extra = [l.eNumber ? `E-nr ${l.eNumber}` : "", l.rskNumber ? `RSK ${l.rskNumber}` : "", l.note ?? ""]
      .filter(Boolean)
      .join(" · ");
    const needed = extra ? 30 : 17;
    if (y + needed > PDF_BOTTOM) newPage();
    lines.push({ x: 56, y, text: truncate(l.articleNumber ?? "–", 16), size: 10 });
    lines.push({ x: 150, y, text: truncate(l.name, 58), size: 10 });
    lines.push({ x: 450, y, text: qtyLabel(l), size: 10 });
    y += 15;
    if (extra) {
      lines.push({ x: 150, y, text: truncate(extra, 80), size: 8 });
      y += 13;
    }
    y += 2;
  });

  if (input.message) {
    if (y + 60 > PDF_BOTTOM) newPage();
    y += 12;
    lines.push({ x: 56, y, text: "Meddelande", size: 9, bold: true });
    y += 14;
    for (const row of input.message.split(/\r?\n/).slice(0, 12)) {
      lines.push({ x: 56, y, text: truncate(row, 95), size: 10 });
      y += 14;
    }
  }
  if (y + 40 > PDF_BOTTOM) newPage();
  y += 16;
  rules.push({ x: 56, y: y - 12, width: 483 });
  lines.push({ x: 56, y, text: truncate(REPLY_INSTRUCTION, 100), size: 9 });
  pages.push({ lines, rules });
  return buildSimplePdfPages(pages);
}

/** Förväntad inköpskostnad – bara när alla rader har inköpspris. */
export function expectedCostOre(lines: PurchaseOrderSnapshotLine[]): number | undefined {
  if (lines.length === 0 || lines.some((l) => l.unitCostOre == null)) return undefined;
  return lines.reduce((sum, l) => sum + Math.round(l.qty * (l.unitCostOre ?? 0)), 0);
}

export function expectedCostLabel(ore: number | undefined): string {
  return ore == null ? "Inköpspris saknas på någon rad" : formatOre(ore);
}
