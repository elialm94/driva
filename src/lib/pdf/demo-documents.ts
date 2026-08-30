/**
 * Demodokument: riktiga, deterministiska PDF:er för inboxens demoposter.
 *
 * Nycklas på bilagans storageKey (demo/<inboxpost>/<filnamn>). Datumen räknas
 * relativt "nu" med samma logik som seeden så att PDF och tolkade fält alltid
 * pekar på samma dagar oavsett när demon körs.
 *
 * VIKTIGT för demo-berättelsen: Byggmax-fakturans PDF visar det RÄTTA
 * totalbeloppet (2 340 kr) medan Drivas tolkning i demon läst fel (875 kr,
 * låg konfidens) – det är själva poängen med "Kontrollera belopp".
 */
import { buildSimplePdf, type PdfTextLine, type PdfRule, type SimplePdfSpec } from "./simple-pdf";

function dateDaysAgo(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

/* ------------------------------ Layouthjälpare ----------------------------- */

interface DocRow {
  text: string;
  qty?: string;
  amount: string;
}

function invoiceSpec(input: {
  brand: string;
  brandDetail: string;
  title: string;
  meta: [string, string][];
  rows: DocRow[];
  netLabel: string;
  net: string;
  vat: string;
  total: string;
  paymentLines: string[];
  footer: string;
}): SimplePdfSpec {
  const lines: PdfTextLine[] = [];
  const rules: PdfRule[] = [];

  lines.push({ x: 56, y: 70, text: input.brand, size: 22, bold: true });
  lines.push({ x: 56, y: 88, text: input.brandDetail, size: 9 });
  lines.push({ x: 400, y: 70, text: input.title, size: 15, bold: true });

  let y = 130;
  for (const [label, value] of input.meta) {
    lines.push({ x: 56, y, text: label, size: 9 });
    lines.push({ x: 170, y, text: value, size: 10, bold: true });
    y += 16;
  }

  y += 18;
  rules.push({ x: 56, y: y - 12, width: 483 });
  lines.push({ x: 56, y, text: "Beskrivning", size: 9, bold: true });
  lines.push({ x: 360, y, text: "Antal", size: 9, bold: true });
  lines.push({ x: 470, y, text: "Belopp", size: 9, bold: true });
  y += 6;
  rules.push({ x: 56, y, width: 483 });
  y += 18;
  for (const row of input.rows) {
    lines.push({ x: 56, y, text: row.text, size: 10 });
    if (row.qty) lines.push({ x: 360, y, text: row.qty, size: 10 });
    lines.push({ x: 470, y, text: row.amount, size: 10 });
    y += 17;
  }
  y += 4;
  rules.push({ x: 56, y, width: 483 });
  y += 18;
  lines.push({ x: 330, y, text: input.netLabel, size: 10 });
  lines.push({ x: 470, y, text: input.net, size: 10 });
  y += 16;
  lines.push({ x: 330, y, text: "Moms 25 %", size: 10 });
  lines.push({ x: 470, y, text: input.vat, size: 10 });
  y += 20;
  lines.push({ x: 330, y, text: "Att betala", size: 13, bold: true });
  lines.push({ x: 452, y, text: input.total, size: 13, bold: true });
  y += 30;

  rules.push({ x: 56, y: y - 12, width: 483 });
  for (const paymentLine of input.paymentLines) {
    lines.push({ x: 56, y, text: paymentLine, size: 10, bold: !paymentLine.includes(":") });
    y += 15;
  }
  lines.push({ x: 56, y: 800, text: input.footer, size: 8 });
  return { lines, rules };
}

function receiptSpec(input: {
  brand: string;
  store: string;
  date: string;
  rows: DocRow[];
  total: string;
  vat: string;
  paymentLine: string;
  footer: string;
}): SimplePdfSpec {
  const lines: PdfTextLine[] = [];
  const rules: PdfRule[] = [];
  const left = 170;
  lines.push({ x: left, y: 80, text: input.brand, size: 18, bold: true });
  lines.push({ x: left, y: 98, text: input.store, size: 9 });
  lines.push({ x: left, y: 112, text: `Datum: ${input.date}`, size: 9 });
  rules.push({ x: left, y: 126, width: 250 });
  let y = 148;
  for (const row of input.rows) {
    lines.push({ x: left, y, text: row.text, size: 10 });
    lines.push({ x: left + 190, y, text: row.amount, size: 10 });
    y += 16;
  }
  rules.push({ x: left, y: y - 6, width: 250 });
  y += 14;
  lines.push({ x: left, y, text: "TOTALT", size: 12, bold: true });
  lines.push({ x: left + 170, y, text: input.total, size: 12, bold: true });
  y += 18;
  lines.push({ x: left, y, text: `Varav moms 25 %: ${input.vat}`, size: 9 });
  y += 16;
  lines.push({ x: left, y, text: input.paymentLine, size: 9 });
  y += 24;
  lines.push({ x: left, y, text: input.footer, size: 8 });
  return { lines, rules };
}

/* ------------------------------- Dokumenten -------------------------------- */

/** Fall A – kvitto: Bauhaus 875 kr, betalt med företagskort. */
function bauhausReceipt(): SimplePdfSpec {
  return receiptSpec({
    brand: "BAUHAUS",
    store: "Bauhaus Sickla · Simbagatan 12, Nacka · Org.nr 556035-9074",
    date: dateDaysAgo(3),
    rows: [
      { text: "Skruv träskruv 4,5x60 250-p", amount: "189,00" },
      { text: "Trälist furu 21x43 3,6 m (6 st)", amount: "414,00" },
      { text: "Fogsvans 550 mm", amount: "272,00" },
    ],
    total: "875,00",
    vat: "175,00",
    paymentLine: "Betalt med kort ****3412 (företagskort)",
    footer: "Tack för ditt köp! Öppet köp 60 dagar mot kvitto.",
  });
}

/** Fall B – leverantörsfaktura: Beijer Bygg 18 500 kr, komplett och betalbar. */
function beijerInvoice(): SimplePdfSpec {
  return invoiceSpec({
    brand: "BEIJER BYGG",
    brandDetail: "Beijer Byggmaterial AB · Org.nr 556012-5220 · Momsreg SE556012522001",
    title: "FAKTURA",
    meta: [
      ["Fakturanummer", "BB-48211"],
      ["Fakturadatum", dateDaysAgo(2)],
      ["Förfallodatum", dateDaysAgo(-10)],
      ["Kund", "Södermalms Snickeri AB (kundnr 88 412)"],
      ["Er referens", "Altanprojekt Tantogatan"],
    ],
    rows: [
      { text: "Tryckimpregnerad regel 45x145", qty: "84 m", amount: "6 260,00" },
      { text: "Trallskruv C4 4,2x55 (5 000-p)", qty: "2 st", amount: "2 980,00" },
      { text: "Plywood 12 mm 1200x2400", qty: "9 st", amount: "4 560,00" },
    ],
    netLabel: "Netto",
    net: "14 800,00",
    vat: "3 700,00",
    total: "18 500,00 kr",
    paymentLines: [
      "Betalningsinformation",
      "Bankgiro: 123-4567",
      "OCR: 48211",
      "Villkor: 10 dagar netto. Dröjsmålsränta enligt räntelagen.",
    ],
    footer: "Beijer Byggmaterial AB · Box 815, 251 08 Helsingborg · beijerbygg.se",
  });
}

/**
 * Fall C – leverantörsfaktura som behöver kontroll: Byggmax.
 * PDF:ens riktiga totalbelopp är 2 340,00 kr – demons tolkning läste 875 kr
 * med låg konfidens, och användaren rättar mot den här filen.
 */
function byggmaxInvoice(): SimplePdfSpec {
  return invoiceSpec({
    brand: "BYGGMAX",
    brandDetail: "Byggmax AB · Hornstull, Stockholm · Org.nr 556645-6215",
    title: "FAKTURA",
    meta: [
      ["Fakturanummer", "BM-73821"],
      ["Fakturadatum", dateDaysAgo(1)],
      ["Förfallodatum", dateDaysAgo(-14)],
      ["Kund", "Södermalms Snickeri AB"],
    ],
    rows: [
      { text: "Gipsskiva 13 mm 900x2500", qty: "10 st", amount: "1 150,00" },
      { text: "Skruvdragarbits PZ2 (10-p)", qty: "2 st", amount: "98,00" },
      { text: "Byggfolie 0,2 mm 2,6x25 m", qty: "1 st", amount: "624,00" },
    ],
    netLabel: "Netto",
    net: "1 872,00",
    vat: "468,00",
    total: "2 340,00 kr",
    paymentLines: [
      "Betalningsinformation",
      "Bankgiro: 5786-8140",
      "OCR: 7382101",
      "Villkor: 15 dagar netto.",
    ],
    footer: "Byggmax AB · Armégatan 38, 171 71 Solna · byggmax.se",
  });
}

/* --------------------------------- Register -------------------------------- */

const DEMO_DOCUMENTS: Record<string, () => SimplePdfSpec> = {
  "demo/inbox-mail-bauhaus/kvitto-bauhaus.pdf": bauhausReceipt,
  "demo/inbox-mail-beijer/BB-48211.pdf": beijerInvoice,
  "demo/inbox-mail-byggmax/faktura-byggmax.pdf": byggmaxInvoice,
};

export function isDemoDocumentKey(storageKey: string): boolean {
  return storageKey in DEMO_DOCUMENTS;
}

/** Generera demodokumentets PDF-bytes, eller undefined för okända nycklar. */
export function demoDocumentPdf(storageKey: string): Buffer | undefined {
  const spec = DEMO_DOCUMENTS[storageKey];
  return spec ? buildSimplePdf(spec()) : undefined;
}
