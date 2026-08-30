import { A4Document, MARGIN, PAGE_WIDTH, wrapText } from "./a4-document";
import type { BusinessPdfModel } from "./document-model";
import { documentPdfFilename } from "./filename";

const COL = {
  desc: MARGIN,
  qty: 318,
  price: 400,
  vat: 458,
  sum: PAGE_WIDTH - MARGIN,
};

export function renderBusinessPdf(model: BusinessPdfModel): { bytes: Buffer; filename: string } {
  const doc = new A4Document();
  doc.draftWatermark = model.draft;
  drawHeader(doc, model);
  drawParties(doc, model);
  if (model.title) {
    doc.gap(10);
    doc.wrapped(model.title, { size: 16, bold: true, leading: 20 });
  }
  if (model.intro) doc.wrapped(model.intro, { size: 10, gray: 0.25, leading: 14 });
  if (model.richText) {
    doc.gap(6);
    doc.wrapped(model.richText, { size: 10, leading: 13 });
  }
  if (model.related) {
    doc.gap(4);
    doc.line(model.related, { size: 9, gray: 0.35 });
  }
  if (model.creditNote) {
    doc.gap(4);
    doc.wrapped(model.creditNote, { size: 10, leading: 13 });
  }
  drawLines(doc, model);
  drawTotals(doc, model);
  if (model.housing && model.housing.length) {
    section(doc, "Bostad");
    doc.wrapped(model.housing.join(" · "), { size: 10, leading: 13 });
  }
  if (model.rotHeading || model.rotBody) {
    section(doc, model.rotHeading || "ROT/RUT");
    if (model.rotBody) doc.wrapped(model.rotBody, { size: 9, leading: 12 });
    if (model.rotHint) {
      doc.gap(3);
      doc.wrapped(model.rotHint, { size: 8, gray: 0.35, leading: 11 });
    }
  }
  if (model.paymentPlan?.length) {
    section(doc, "Betalningsplan");
    for (const step of model.paymentPlan) {
      kvRow(doc, step.label, step.value);
    }
  }
  if (model.paymentTerms) {
    doc.gap(4);
    doc.wrapped(model.paymentTerms, { size: 9, gray: 0.3, leading: 12 });
  }
  if (model.terms) {
    section(doc, "Villkor");
    doc.wrapped(model.terms, { size: 9, leading: 12 });
  }
  if (model.paymentBox?.length) {
    section(doc, "Betalning");
    for (const row of model.paymentBox) kvRow(doc, row.label, row.value, true);
    if (model.paymentNote) {
      doc.gap(3);
      doc.wrapped(model.paymentNote, { size: 9, gray: 0.3, leading: 12 });
    }
  }
  if (model.signHeading) {
    section(doc, model.kind === "offert" ? "Signering" : "Status");
    doc.line(model.signHeading, { size: 11, bold: true });
    if (model.signBody) doc.wrapped(model.signBody, { size: 9, leading: 12 });
  }
  if (model.paidNote) {
    section(doc, "Betalning");
    doc.wrapped(model.paidNote, { size: 10, leading: 13 });
  }
  drawFooter(doc, model);

  const filename =
    model.filename ||
    documentPdfFilename(model.kind, numberFromDoc(model), model.buyerName);
  return { bytes: doc.build(), filename };
}

function numberFromDoc(model: BusinessPdfModel): number | null {
  const raw = model.docNumber.replace(/^#/, "").trim();
  if (raw === "Utkast") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function drawHeader(doc: A4Document, model: BusinessPdfModel): void {
  const seller = model.seller;
  const logo = seller.logoDataUrl ? doc.addImageFromDataUrl(seller.logoDataUrl) : null;
  const top = doc.currentY();
  let textX = MARGIN;
  if (logo) {
    const h = 36;
    const w = Math.min(72, (logo.width / logo.height) * h);
    doc.drawImage(logo.name, MARGIN, w, h);
    textX = MARGIN + w + 10;
  } else if (seller.logoInitials) {
    doc.rect(MARGIN, top, 28, 28, 0.15, true);
    doc.text(MARGIN + 14, seller.logoInitials.slice(0, 3), { size: 10, bold: true, align: "center" });
    textX = MARGIN + 38;
  }
  doc.moveTo(top);
  doc.line(seller.name, { x: textX, size: 13, bold: true });
  const sellerBits = [
    [seller.address, seller.postalCode, seller.city].filter(Boolean).join(", "),
    seller.orgNumber ? `Org.nr ${seller.orgNumber}` : "",
    seller.vatNumber ? `Momsreg.nr ${seller.vatNumber}` : "",
  ].filter(Boolean);
  for (const bit of sellerBits) {
    doc.line(bit, { x: textX, size: 8, gray: 0.35 });
  }
  const headerRightY = top;
  doc.moveTo(headerRightY);
  doc.text(PAGE_WIDTH - MARGIN, model.docType.toUpperCase(), { size: 9, bold: true, align: "right", gray: 0.4 });
  doc.moveTo(headerRightY + 14);
  doc.text(PAGE_WIDTH - MARGIN, model.docNumber, { size: 16, bold: true, align: "right" });
  doc.moveTo(Math.max(doc.currentY(), top + 44));
  doc.gap(6);
  doc.rule();
}

function drawParties(doc: A4Document, model: BusinessPdfModel): void {
  doc.gap(4);
  const start = doc.currentY();
  doc.line("Kund", { size: 8, gray: 0.4, bold: true });
  doc.line(model.buyerName, { size: 11, bold: true });
  for (const line of model.buyerAddress) {
    doc.line(line, { size: 9, gray: 0.25 });
  }
  const afterBuyer = doc.currentY();
  doc.moveTo(start);
  const colX = 320;
  for (const item of model.meta) {
    doc.ensureSpace(22);
    doc.text(colX, item.label, { size: 8, gray: 0.4 });
    doc.moveTo(doc.currentY() + 10);
    doc.text(colX, item.value, { size: 10, bold: true });
    doc.moveTo(doc.currentY() + 14);
  }
  doc.moveTo(Math.max(afterBuyer, doc.currentY()) + 4);
}

function drawLines(doc: A4Document, model: BusinessPdfModel): void {
  doc.gap(8);
  const headerH = 16;
  const drawHead = () => {
    doc.ensureSpace(headerH + 20);
    doc.text(COL.desc, "Beskrivning", { size: 8, bold: true, gray: 0.4 });
    doc.text(COL.qty, "Antal", { size: 8, bold: true, gray: 0.4, align: "right" });
    doc.text(COL.price, "À-pris", { size: 8, bold: true, gray: 0.4, align: "right" });
    doc.text(COL.vat, "Moms", { size: 8, bold: true, gray: 0.4, align: "right" });
    doc.text(COL.sum, "Summa", { size: 8, bold: true, gray: 0.4, align: "right" });
    doc.moveTo(doc.currentY() + 11);
    doc.rule({ thickness: 0.8 });
  };
  drawHead();
  for (const line of model.lines) {
    const descWidth = 250;
    const descLines = wrapLines(line.description, 9, descWidth, true);
    const rowH = descLines.length * 12 + (line.kind ? 10 : 0) + 10;
    if (doc.remaining() < rowH) {
      doc.newPage();
      drawHead();
    }
    descLines.forEach((row, i) => {
      doc.text(COL.desc, row, { size: i === 0 ? 9 : 8, bold: i === 0, gray: i === 0 ? 0 : 0.4 });
      if (i === 0) {
        doc.text(COL.qty, line.qty, { size: 9, align: "right" });
        doc.text(COL.price, line.unitPrice, { size: 9, align: "right" });
        doc.text(COL.vat, line.vat, { size: 9, align: "right" });
        doc.text(COL.sum, line.sum, { size: 9, bold: true, align: "right" });
      }
      doc.moveTo(doc.currentY() + 12);
    });
    if (line.kind) {
      doc.text(COL.desc, line.kind, { size: 8, gray: 0.4 });
      doc.moveTo(doc.currentY() + 10);
    }
    doc.rule({ gray: 0.75, thickness: 0.4 });
  }
}

function wrapLines(text: string, size: number, maxWidth: number, bold: boolean): string[] {
  return wrapText(text, size, maxWidth, bold);
}

function drawTotals(doc: A4Document, model: BusinessPdfModel): void {
  doc.gap(8);
  const blockH = model.totals.length * 14 + 28;
  doc.ensureSpace(blockH);
  const xLabel = 330;
  const xVal = PAGE_WIDTH - MARGIN;
  for (const row of model.totals) {
    doc.text(xLabel, row.label, { size: 9, bold: Boolean(row.emphasis), gray: row.emphasis ? 0 : 0.3 });
    doc.text(xVal, row.value, { size: 9, bold: Boolean(row.emphasis), align: "right" });
    doc.moveTo(doc.currentY() + 14);
  }
  doc.gap(2);
  doc.rule({ x: xLabel, width: xVal - xLabel });
  doc.text(xLabel, model.toPayLabel, { size: 11, bold: true });
  doc.text(xVal, model.toPay, { size: 14, bold: true, align: "right" });
  doc.moveTo(doc.currentY() + 18);
}

function section(doc: A4Document, title: string): void {
  doc.gap(10);
  doc.ensureSpace(28);
  doc.line(title.toUpperCase(), { size: 8, bold: true, gray: 0.4 });
}

function kvRow(doc: A4Document, label: string, value: string, boldValue = false): void {
  doc.ensureSpace(16);
  doc.text(MARGIN, label, { size: 9, gray: 0.3 });
  doc.text(PAGE_WIDTH - MARGIN, value, { size: 9, bold: boldValue, align: "right" });
  doc.moveTo(doc.currentY() + 14);
}

function drawFooter(doc: A4Document, model: BusinessPdfModel): void {
  const seller = model.seller;
  const sate = seller.sate?.trim() || seller.city;
  const pay = [
    seller.bankgiro ? `Bankgiro ${seller.bankgiro}` : "",
    seller.plusgiro ? `PlusGiro ${seller.plusgiro}` : "",
    seller.bankAccount ? `Bankkonto ${seller.bankAccount}` : "",
    seller.iban ? `IBAN ${seller.iban}` : "",
    seller.bic ? `BIC ${seller.bic}` : "",
  ].filter(Boolean);
  const line1 = [
    seller.name,
    seller.orgNumber ? `Org.nr ${seller.orgNumber}` : "",
    seller.vatNumber ? `Momsreg.nr ${seller.vatNumber}` : "",
    sate ? `Säte ${sate}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const line2 = [...pay, seller.email, seller.phone, "Godkänd för F-skatt"].filter(Boolean).join(" · ");
  doc.gap(16);
  doc.rule();
  if (line1) doc.wrapped(line1, { size: 8, gray: 0.4, leading: 11 });
  if (line2) doc.wrapped(line2, { size: 8, gray: 0.4, leading: 11 });
}
