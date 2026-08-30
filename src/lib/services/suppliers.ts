import { db, save } from "../store";
import { uid } from "../ids";
import type { SupplierInvoice } from "../types";
import { categoryByKey, entriesSupplierInvoiceReceived, guessCategory } from "../bas";
import { kr, isoDaysFromNow } from "../format";
import { logActivity } from "./activity";
import { postVerification } from "../accounting/engine";
import { clampToOpenDate } from "../accounting/fiscal";
import { merchantRuleKey } from "./expenses";
import { prepareSupplierPayment } from "./supplier-payments";
import { guessPaymentMethod, paymentDetailsInfo } from "./payment-details";

/**
 * Leverantörsfakturans livscykel: Mottagen → Bokförd → Betalning förberedd → Betald.
 *
 * Mottagning och bokföring sker i ett steg (kostnad + ingående moms mot
 * leverantörsskuld 2440) – det är korrekt enligt faktureringsmetoden och
 * betyder att skulden syns i balansen direkt. Betalningen (2440 mot 1930)
 * bokförs när banktransaktionen matchas – inte när instruktionen skapas.
 */
export interface ReceiveSupplierInvoiceInput {
  supplier: string;
  invoiceNumber: string;
  /** Fakturadatum (ISO). Default nu. */
  date?: string;
  /** Förfallodatum (ISO). Default 30 dagar. */
  dueDate?: string;
  /** Totalbelopp inkl. moms, hela kronor. */
  amount: number;
  /** Momsbelopp, hela kronor. */
  vatAmount: number;
  description: string;
  /** Utgiftskategori (nyckel i EXPENSE_CATEGORIES). Gissas från leverantören om utelämnad. */
  category?: string;
  ocr?: string;
  bankgiro?: string;
  recipientAccount?: string;
  /**
   * Varifrån betalningsuppgifterna kommer:
   *   "document" (default) – säker läsning ur dokumentet → VERIFIED med proveniens.
   *   "document_confirmed" – dokument + mänsklig kontroll (Kontrollera/Godkänn).
   *   "document_uncertain" – osäker läsning → EXTRACTION_UNCERTAIN-kandidat som
   *   aldrig hamnar i betalbara fält förrän en människa godkänt den.
   */
  detailsProvenance?: "document" | "document_confirmed" | "document_uncertain";
  inboxItemId?: string;
  book?: boolean;
  by?: "anvandare" | "assistent";
}

export function findDuplicateSupplierInvoice(supplier: string, invoiceNumber: string): SupplierInvoice | undefined {
  const number = invoiceNumber.trim().toLowerCase();
  const key = merchantRuleKey(supplier);
  if (!number) return undefined;
  return db().supplierInvoices.find(
    (s) => s.invoiceNumber.trim().toLowerCase() === number && (!key || merchantRuleKey(s.supplier) === key)
  );
}

export function receiveSupplierInvoice(input: ReceiveSupplierInvoiceInput): SupplierInvoice {
  const data = db();
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error("Beloppet måste vara ett positivt heltal i kronor.");
  if (!Number.isInteger(input.vatAmount) || input.vatAmount < 0 || input.vatAmount >= input.amount)
    throw new Error("Momsbeloppet måste vara ett heltal mellan 0 och totalbeloppet.");

  const duplicate = findDuplicateSupplierInvoice(input.supplier, input.invoiceNumber);
  if (duplicate) {
    if (input.inboxItemId && !duplicate.inboxItemId) duplicate.inboxItemId = input.inboxItemId;
    // Svar/ny version av samma faktura kan komplettera saknade uppgifter.
    const account = (input.recipientAccount ?? input.bankgiro ?? "").trim();
    if (account) {
      attachExtractedPaymentDetails(duplicate.id, {
        account,
        ocr: input.ocr,
        provenance: input.detailsProvenance ?? "document",
        by: input.by,
      });
    }
    save();
    return duplicate;
  }

  const categoryKey = input.category ?? guessCategory(input.supplier)?.key ?? "ovrigt";
  const now = new Date().toISOString();
  const date = input.date ?? now;
  const shouldBook = input.book !== false;

  const sup: SupplierInvoice = {
    id: uid(),
    supplier: input.supplier,
    invoiceNumber: input.invoiceNumber,
    date,
    dueDate: input.dueDate ?? isoDaysFromNow(30),
    amount: input.amount,
    vatAmount: input.vatAmount,
    description: input.description,
    category: categoryKey,
    status: "obetald",
    accountingStatus: "obokford",
    createdAt: now,
  };
  const account = (input.recipientAccount ?? input.bankgiro ?? "").trim();
  if (account && input.detailsProvenance === "document_uncertain") {
    // Osäker läsning: kandidat – hamnar aldrig i betalbara fält, och OCR:n
    // hålls också tillbaka tills en människa kontrollerat uppgifterna.
    sup.paymentDetails = {
      state: "EXTRACTION_UNCERTAIN",
      candidate: { account, ...(input.ocr?.trim() ? { ocr: input.ocr.trim() } : {}) },
    };
  } else if (account) {
    if (input.ocr?.trim()) sup.ocr = input.ocr.trim();
    sup.recipientAccount = account;
    const method = guessPaymentMethod(account);
    if (method === "bankgiro") sup.bankgiro = account;
    sup.paymentDetails = {
      state: "VERIFIED",
      verified: {
        method,
        account,
        ...(sup.ocr ? { ocr: sup.ocr } : {}),
        source: input.detailsProvenance === "document_confirmed" ? "document_confirmed" : "document",
        verifiedAt: now,
        verifiedBy: input.by === "assistent" ? "assistent" : "anvandare",
      },
    };
  } else {
    if (input.ocr?.trim()) sup.ocr = input.ocr.trim();
    sup.paymentDetails = { state: "MISSING" };
  }
  if (input.inboxItemId) sup.inboxItemId = input.inboxItemId;

  data.supplierInvoices.push(sup);
  if (shouldBook) bookSupplierInvoice(sup.id, { by: input.by, category: categoryKey });
  else save();
  return getSupplierInvoiceOrThrow(sup.id);
}

export function bookSupplierInvoice(
  id: string,
  opts: { by?: "anvandare" | "assistent"; category?: string } = {}
): SupplierInvoice {
  const sup = getSupplierInvoiceOrThrow(id);
  if (sup.accountingStatus === "bokford" && sup.verificationId) return sup;

  const categoryKey = opts.category ?? sup.category ?? guessCategory(sup.supplier)?.key ?? "ovrigt";
  const cat = categoryByKey(categoryKey);
  const clamped = clampToOpenDate(sup.date);
  const ver = postVerification({
    date: clamped.date,
    description: `Leverantörsfaktura ${sup.supplier} ${sup.invoiceNumber}`,
    entries: entriesSupplierInvoiceReceived(categoryKey, sup.amount, cat.vatFree ? 0 : sup.vatAmount),
    source: { type: "leverantorsfaktura", id: sup.id },
    confidence: opts.category ? "hog" : "medel",
    createdBy: opts.by === "assistent" ? "assistent" : "anvandare",
    explanation: `Fakturan från ${sup.supplier} bokfördes som ${cat.label.toLowerCase()} med leverantörsskuld – skulden syns i bokföringen tills den betalas.${clamped.adjusted ? ` Bokfört ${clamped.date} eftersom perioden för fakturadatumet är låst.` : ""}`,
  });
  sup.category = categoryKey;
  sup.verificationId = ver.id;
  sup.accountingStatus = "bokford";
  logActivity(`Leverantörsfaktura från ${sup.supplier} (${kr(sup.amount)}) togs emot och bokfördes. Förfaller ${sup.dueDate.slice(0, 10)}.`, {});
  if (sup.bankgiro || sup.recipientAccount) {
    try {
      prepareSupplierPayment({ supplierInvoiceId: sup.id });
    } catch {
      // Saknade uppgifter lämnar fakturan bokförd utan instruktion.
    }
  }
  save();
  return sup;
}

function getSupplierInvoiceOrThrow(id: string): SupplierInvoice {
  const sup = db().supplierInvoices.find((s) => s.id === id);
  if (!sup) throw new Error("Leverantörsfakturan finns inte.");
  return sup;
}

/**
 * Komplettera en faktura som väntar på betalningsuppgifter (MISSING,
 * AWAITING_SUPPLIER eller EXTRACTION_UNCERTAIN) med uppgifter ur ett nytt
 * dokument/svar. Säker läsning → VERIFIED (proveniens document; skiljer den
 * sig från verifierad historik flaggas den som ändrad vid förberedelsen).
 * Osäker läsning → ny kandidat som människan får kontrollera. Redan
 * verifierade uppgifter skrivs ALDRIG över här.
 */
export function attachExtractedPaymentDetails(
  invoiceId: string,
  input: {
    account: string;
    ocr?: string;
    provenance: "document" | "document_confirmed" | "document_uncertain";
    by?: "anvandare" | "assistent";
  }
): SupplierInvoice | undefined {
  const sup = db().supplierInvoices.find((s) => s.id === invoiceId);
  if (!sup || sup.status === "betald") return undefined;
  const account = input.account.trim();
  if (!account) return undefined;
  const cause = paymentDetailsInfo(sup).cause;
  if (cause !== "MISSING" && cause !== "AWAITING_SUPPLIER" && cause !== "EXTRACTION_UNCERTAIN") return undefined;

  const request = sup.paymentDetails?.request;
  if (input.provenance === "document_uncertain") {
    sup.paymentDetails = {
      state: "EXTRACTION_UNCERTAIN",
      candidate: { account, ...(input.ocr?.trim() ? { ocr: input.ocr.trim() } : {}) },
      ...(request ? { request } : {}),
    };
    logActivity(`${sup.supplier} ${sup.invoiceNumber} fick nya betalningsuppgifter som behöver kontrolleras.`);
    return sup;
  }

  if (input.ocr?.trim() && !sup.ocr) sup.ocr = input.ocr.trim();
  sup.recipientAccount = account;
  const method = guessPaymentMethod(account);
  if (method === "bankgiro") sup.bankgiro = account;
  sup.paymentDetails = {
    state: "VERIFIED",
    verified: {
      method,
      account,
      ...(sup.ocr ? { ocr: sup.ocr } : {}),
      source: input.provenance === "document_confirmed" ? "document_confirmed" : "document",
      verifiedAt: new Date().toISOString(),
      verifiedBy: input.by === "assistent" ? "assistent" : "anvandare",
    },
  };
  logActivity(`${sup.supplier} ${sup.invoiceNumber} kompletterades med betalningsuppgifter.`);
  if (sup.accountingStatus === "bokford") {
    try {
      prepareSupplierPayment({ supplierInvoiceId: sup.id });
    } catch {
      // T.ex. ändrad destination – hanteras som egen uppmärksamhet.
    }
  }
  return sup;
}

export function listSupplierInvoices(): SupplierInvoice[] {
  return [...db().supplierInvoices].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Fält som får ändras i efterhand utan att röra bokförda belopp eller
 * betalningsuppgifter. Belopp/moms rättas via rättelseflödet, konto/OCR via
 * verifieringsflödena i payment-details – aldrig via en generisk fältändring.
 */
export type SupplierInvoiceEditableField = "description" | "dueDate" | "invoiceNumber";

const EDITABLE_FIELD_LABELS: Record<SupplierInvoiceEditableField, string> = {
  description: "beskrivningen",
  dueDate: "förfallodatumet",
  invoiceNumber: "fakturanumret",
};

export function updateSupplierInvoiceField(input: {
  invoiceId: string;
  field: SupplierInvoiceEditableField;
  value: string;
  by?: "anvandare" | "assistent";
}): SupplierInvoice {
  const sup = db().supplierInvoices.find((s) => s.id === input.invoiceId);
  if (!sup) throw new Error("Leverantörsfakturan finns inte.");
  if (sup.status === "betald") throw new Error("Fakturan är betald – uppgifterna kan inte ändras längre.");
  if (!(input.field in EDITABLE_FIELD_LABELS)) {
    throw new Error(
      "Bara beskrivning, förfallodatum och fakturanummer kan ändras här. Belopp rättas via bokföringen och betalningsuppgifter via kontrollflödet."
    );
  }
  const value = input.value.trim();

  // Datum/nummer låses när fakturan ingår i en aktiv betalning/bankfil –
  // annars glider fil och faktura isär.
  if (input.field !== "description") {
    const active = (db().supplierPayments ?? []).find(
      (p) =>
        p.supplierInvoiceId === sup.id &&
        (p.status === "PAYMENT_FILE_CREATED" ||
          p.status === "SUBMITTED_TO_BANK" ||
          p.status === "AWAITING_APPROVAL" ||
          p.status === "SCHEDULED")
    );
    if (active) {
      throw new Error(
        active.status === "PAYMENT_FILE_CREATED"
          ? "Fakturan ingår i en skapad bankfil – ersätt eller makulera filen innan uppgifterna ändras."
          : "Betalningen är redan hos banken – uppgifterna kan inte ändras."
      );
    }
  }

  if (input.field === "description") {
    if (!value) throw new Error("Beskrivningen kan inte vara tom.");
    sup.description = value;
  } else if (input.field === "dueDate") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Ange förfallodatumet som ÅÅÅÅ-MM-DD.");
    sup.dueDate = `${value}T10:00:00.000Z`;
    // Förberedd (ej skickad) betalning följer det nya förfallodatumet.
    const prepared = (db().supplierPayments ?? []).find(
      (p) => p.supplierInvoiceId === sup.id && (p.status === "READY" || p.status === "DRAFT")
    );
    if (prepared) {
      prepared.scheduledDate = sup.dueDate;
      prepared.updatedAt = new Date().toISOString();
    }
  } else {
    if (!value) throw new Error("Fakturanumret kan inte vara tomt.");
    const duplicate = findDuplicateSupplierInvoice(sup.supplier, value);
    if (duplicate && duplicate.id !== sup.id) {
      throw new Error(`Det finns redan en faktura från ${sup.supplier} med nummer ${value}.`);
    }
    sup.invoiceNumber = value;
  }

  logActivity(
    `${sup.supplier} ${sup.invoiceNumber}: ${EDITABLE_FIELD_LABELS[input.field]} uppdaterades${input.by === "assistent" ? " av assistenten" : ""}.`
  );
  save();
  return sup;
}
