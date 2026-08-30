/**
 * Bankfiler (pain.001) för leverantörsbetalningar – V1 utan bankintegration.
 *
 * Flödet: bokförd faktura med VERIFIERADE betalningsuppgifter → [Skapa
 * bankfil] → validera → generera pain.001.001.03 → spara PaymentFile +
 * instruktionerna får status PAYMENT_FILE_CREATED → användaren laddar ned
 * filen och godkänner betalningen i sin internetbank. Driva påstår ALDRIG
 * att banken tagit emot något.
 *
 * Dubbelbetalningsskydd: en faktura kan bara ingå i EN aktiv fil (vakt här +
 * partiellt unikt index i Postgres). Regenerering ersätter den gamla filen
 * (status REPLACED + replacedByFileId) – skapar aldrig en parallell.
 */
import { db, save } from "../store";
import { uid } from "../ids";
import { kr } from "../format";
import { logActivity } from "./activity";
import { getPaymentExportProvider } from "../banking/payment-export";
import type { PaymentExportInstruction } from "../banking/payment-export";
import { isValidIban } from "../banking/pain001";
import { paymentDetailsInfo, guessPaymentMethod } from "./payment-details";
import {
  activePaymentForInvoice,
  getSupplierInvoice,
  paymentDetailsBlockedReason,
  prepareSupplierPayment,
  remainingAmountForInvoice,
} from "./supplier-payments";
import type { PaymentFile, SupplierInvoice, SupplierPayment } from "../types";

export function paymentFiles(): PaymentFile[] {
  return db().paymentFiles ?? [];
}

export function getPaymentFile(id: string): PaymentFile | undefined {
  return paymentFiles().find((f) => f.id === id);
}

/** Aktiv (nedladdningsbar) fil som fakturan ingår i, om någon. */
export function activePaymentFileForInvoice(invoiceId: string): PaymentFile | undefined {
  return paymentFiles().find((f) => f.status === "CREATED" && f.supplierInvoiceIds.includes(invoiceId));
}

/* -------------------------------- Validering ------------------------------- */

export interface PayerAccountInfo {
  ok: boolean;
  /** Exakt problem på svenska när ok = false. */
  problem?: string;
  bankName?: string;
  iban?: string;
  bic?: string;
}

/** Företagets betalkonto (pain.001-debitorn) ur inställningarna. */
export function payerAccountInfo(): PayerAccountInfo {
  const s = db().settings;
  const iban = s.payerIban?.replace(/\s/g, "").toUpperCase() ?? "";
  if (!iban) {
    return {
      ok: false,
      problem: "Företagets betalkonto saknas. Lägg till det under Inställningar → Företag (Bank & betalkonto).",
    };
  }
  if (!isValidIban(iban)) {
    return {
      ok: false,
      problem: `Företagets betalkonto (${s.payerIban}) är inte ett giltigt IBAN. Kontrollera det under Inställningar.`,
    };
  }
  return {
    ok: true,
    ...(s.payerBankName ? { bankName: s.payerBankName } : {}),
    iban,
    ...(s.payerBic ? { bic: s.payerBic.trim().toUpperCase() } : {}),
  };
}

/** Kort kontovisning för bekräftelser: "SEB · ****4512". */
export function payerAccountLabel(): string | undefined {
  const info = payerAccountInfo();
  if (!info.ok || !info.iban) return undefined;
  const last4 = info.iban.slice(-4);
  return info.bankName ? `${info.bankName} · ****${last4}` : `****${last4}`;
}

/**
 * Exakta hinder för att ta med fakturan i en bankfil – tom lista = redo.
 * Samma vakt för UI, AI och service (aldrig ett generiskt XML-fel, krav 35).
 */
export function paymentFileBlockersForInvoice(invoiceId: string): string[] {
  const invoice = getSupplierInvoice(invoiceId);
  if (!invoice) return ["Leverantörsfakturan finns inte."];
  const problems: string[] = [];
  if (invoice.accountingStatus !== "bokford") {
    problems.push(`Fakturan från ${invoice.supplier} är inte bokförd ännu.`);
  }
  if (invoice.status === "betald" || remainingAmountForInvoice(invoice) <= 0) {
    problems.push(`Fakturan från ${invoice.supplier} är redan betald.`);
  }
  const details = paymentDetailsInfo(invoice);
  if (details.cause === "MISSING") {
    problems.push(`${invoice.supplier} saknar verifierade betalningsuppgifter.`);
  } else if (details.cause === "EXTRACTION_UNCERTAIN") {
    problems.push(
      `Betalningsuppgifterna för ${invoice.supplier} kunde inte läsas säkert – kontrollera och godkänn dem först.`
    );
  } else if (details.cause === "AWAITING_SUPPLIER") {
    problems.push(paymentDetailsBlockedReason("AWAITING_SUPPLIER", invoice.supplier)!);
  } else if (details.cause === "CHANGED") {
    problems.push(
      `${invoice.supplier} har nya betalningsuppgifter som behöver kontrolleras innan en bankfil kan skapas.`
    );
  }
  const active = activePaymentForInvoice(invoice.id);
  if (active?.status === "PAYMENT_FILE_CREATED" && activePaymentFileForInvoice(invoice.id)) {
    problems.push(
      `Fakturan från ${invoice.supplier} ingår redan i en aktiv bankfil. Hämta filen igen eller skapa en ny som ersätter den.`
    );
  } else if (active && (active.status === "SUBMITTED_TO_BANK" || active.status === "AWAITING_APPROVAL" || active.status === "SCHEDULED")) {
    problems.push(`Betalningen till ${invoice.supplier} är redan hos banken.`);
  } else if (active?.destinationChanged) {
    problems.push(
      `${invoice.supplier} har nya betalningsuppgifter som behöver kontrolleras innan en bankfil kan skapas.`
    );
  }
  return [...new Set(problems)];
}

/** Alla hinder för en filförfrågan (företagskonto + per faktura). */
export function paymentFileBlockers(supplierInvoiceIds: string[]): string[] {
  const problems: string[] = [];
  if (supplierInvoiceIds.length === 0) problems.push("Välj minst en faktura att betala.");
  const payer = payerAccountInfo();
  if (!payer.ok && payer.problem) problems.push(payer.problem);
  for (const id of supplierInvoiceIds) problems.push(...paymentFileBlockersForInvoice(id));
  return [...new Set(problems)];
}

/* --------------------------------- Skapande -------------------------------- */

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Bankdatum kan inte ligga i det förflutna – förfallna betalas i dag. */
function executionDate(scheduledDate: string): string {
  const today = todayIso();
  const wanted = scheduledDate.slice(0, 10);
  return wanted < today ? today : wanted;
}

/** driva-betalningar-2026-08-30.xml, med -2/-3 vid flera filer samma dag. */
function nextFilename(date: string): string {
  const base = `driva-betalningar-${date}`;
  const taken = new Set(paymentFiles().map((f) => f.filename));
  if (!taken.has(`${base}.xml`)) return `${base}.xml`;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}.xml`)) return `${base}-${n}.xml`;
  }
}

/** GrpHdr/MsgId – unik per företag, max 35 tecken. */
function nextMessageId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "-");
  const suffix = uid().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `DRIVA-${stamp}-${suffix}`;
}

/** EndToEndId/InstrId ur instruktionens id (uuid utan bindestreck ≤ 35 tecken). */
function endToEndIdFor(payment: SupplierPayment): string {
  return payment.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 35).toUpperCase();
}

function exportInstruction(payment: SupplierPayment, invoice: SupplierInvoice): PaymentExportInstruction {
  const method = guessPaymentMethod(payment.recipientAccount);
  return {
    instructionId: endToEndIdFor(payment),
    endToEndId: endToEndIdFor(payment),
    amount: payment.amount,
    currency: "SEK",
    requestedExecutionDate: executionDate(payment.scheduledDate),
    recipientName: payment.recipientName,
    recipientAccount: { kind: method, account: payment.recipientAccount },
    ...(payment.ocr ?? invoice.ocr
      ? { ocr: payment.ocr ?? invoice.ocr }
      : { message: `Faktura ${invoice.invoiceNumber}`.slice(0, 140) }),
  };
}

export type CreatePaymentFileResult =
  | { ok: true; file: PaymentFile; payments: SupplierPayment[] }
  | { ok: false; problems: string[] };

export interface CreatePaymentFileInput {
  supplierInvoiceIds: string[];
  by?: "anvandare" | "assistent";
  /** Regenerering: filen som ska ersättas (status REPLACED, aldrig parallell). */
  replacesFileId?: string;
}

/**
 * Skapa bankfilen: validera ALLT först (exakta fel), förbered/återanvänd
 * instruktionerna, generera pain.001 via exportprovidern och persistera.
 * En fil kan bära flera betalningar (multi-payment, krav 17).
 */
export function createPaymentFile(input: CreatePaymentFileInput): CreatePaymentFileResult {
  const ids = [...new Set(input.supplierInvoiceIds)];
  const replaces = input.replacesFileId ? getPaymentFile(input.replacesFileId) : undefined;
  if (input.replacesFileId && (!replaces || replaces.status !== "CREATED")) {
    return { ok: false, problems: ["Bankfilen som skulle ersättas finns inte eller är inte aktiv."] };
  }

  // Vid regenerering är fakturorna med i den gamla filen – släpp dem logiskt
  // först så att dubbelfilsvakten inte blockerar ersättningen.
  if (replaces) {
    for (const p of db().supplierPayments ?? []) {
      if (p.paymentFileId !== replaces.id) continue;
      if (p.status === "PAYMENT_FILE_CREATED") p.status = "READY";
      p.paymentFileId = undefined;
      p.updatedAt = new Date().toISOString();
    }
    replaces.status = "REPLACED";
  }

  const problems = paymentFileBlockers(ids);
  if (problems.length > 0) {
    if (replaces) {
      // Återställ ersättningen – gamla filen förblir den aktiva.
      replaces.status = "CREATED";
      for (const p of db().supplierPayments ?? []) {
        if (replaces.paymentIds.includes(p.id)) {
          if (p.status === "READY") p.status = "PAYMENT_FILE_CREATED";
          p.paymentFileId = replaces.id;
        }
      }
    }
    return { ok: false, problems };
  }

  const payer = payerAccountInfo();
  const pairs: { invoice: SupplierInvoice; payment: SupplierPayment }[] = [];
  for (const id of ids) {
    const invoice = getSupplierInvoice(id)!;
    const payment = prepareSupplierPayment({ supplierInvoiceId: id });
    pairs.push({ invoice, payment });
  }

  const now = new Date();
  const request = {
    messageId: nextMessageId(now),
    createdAt: now.toISOString(),
    payer: {
      name: db().settings.name,
      orgNumber: db().settings.orgNumber,
      iban: payer.iban!,
      ...(payer.bic ? { bic: payer.bic } : {}),
    },
    instructions: pairs.map(({ invoice, payment }) => exportInstruction(payment, invoice)),
  };

  const provider = getPaymentExportProvider("ISO20022_PAIN001");
  const built = provider.build(request);
  if (!built.ok) return { ok: false, problems: built.problems };

  const file: PaymentFile = {
    id: `pf-${uid()}`,
    filename: nextFilename(todayIso()),
    messageId: request.messageId,
    format: "ISO20022_PAIN001",
    paymentIds: pairs.map((p) => p.payment.id),
    supplierInvoiceIds: pairs.map((p) => p.invoice.id),
    totalAmount: pairs.reduce((sum, p) => sum + p.payment.amount, 0),
    currency: "SEK",
    xml: built.content,
    status: "CREATED",
    createdAt: now.toISOString(),
    createdBy: input.by ?? "anvandare",
  };
  const data = db();
  data.paymentFiles ??= [];
  data.paymentFiles.push(file);
  if (replaces) replaces.replacedByFileId = file.id;

  const nowIso = now.toISOString();
  for (const { invoice, payment } of pairs) {
    payment.status = "PAYMENT_FILE_CREATED";
    payment.paymentFileId = file.id;
    payment.updatedAt = nowIso;
    syncInboxAfterFile(invoice);
  }

  const who = pairs.length === 1 ? pairs[0].invoice.supplier : `${pairs.length} leverantörer`;
  logActivity(
    `Bankfil ${file.filename} skapades för ${who} (${kr(file.totalAmount)}). Ladda upp den i internetbanken och godkänn betalningen där.`
  );
  save();
  return { ok: true, file, payments: pairs.map((p) => p.payment) };
}

/** Fakturans inboxpost lämnar "ny" när bankfilen är skapad – blockern är löst. */
function syncInboxAfterFile(invoice: SupplierInvoice): void {
  if (!invoice.inboxItemId) return;
  const item = (db().inboxItems ?? []).find((i) => i.id === invoice.inboxItemId);
  if (!item || item.status !== "ny") return;
  item.status = "behandlad";
  item.processedAt = item.processedAt ?? new Date().toISOString();
}

/**
 * Regenerera en aktiv fil (t.ex. efter ändrat betaldatum): den gamla blir
 * REPLACED med pekare till ersättaren. Fakturorna hamnar aldrig i två aktiva
 * filer (krav 34).
 */
export function regeneratePaymentFile(
  fileId: string,
  by: "anvandare" | "assistent" = "anvandare"
): CreatePaymentFileResult {
  const file = getPaymentFile(fileId);
  if (!file) return { ok: false, problems: ["Bankfilen finns inte."] };
  if (file.status === "REPLACED") {
    return { ok: false, problems: ["Bankfilen är redan ersatt av en nyare fil."] };
  }
  if (file.status === "CANCELLED") {
    return { ok: false, problems: ["Bankfilen är makulerad – skapa en ny bankfil från fakturorna i stället."] };
  }
  return createPaymentFile({ supplierInvoiceIds: file.supplierInvoiceIds, by, replacesFileId: fileId });
}

/** Fakturor som är redo för bankfil just nu (för batch-åtgärden på Ekonomi). */
export function invoicesReadyForPaymentFile(): SupplierInvoice[] {
  return db()
    .supplierInvoices.filter((s) => paymentFileBlockersForInvoice(s.id).length === 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
