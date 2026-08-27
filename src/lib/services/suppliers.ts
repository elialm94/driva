import { db, save } from "../store";
import { uid } from "../ids";
import type { SupplierInvoice } from "../types";
import { categoryByKey, entriesSupplierInvoiceReceived, guessCategory } from "../bas";
import { kr, isoDaysFromNow } from "../format";
import { logActivity } from "./activity";
import { postVerification } from "../accounting/engine";
import { clampToOpenDate } from "../accounting/fiscal";

/**
 * Leverantörsfakturans livscykel: Mottagen → Bokförd → Betald.
 *
 * Mottagning och bokföring sker i ett steg (kostnad + ingående moms mot
 * leverantörsskuld 2440) – det är korrekt enligt faktureringsmetoden och
 * betyder att skulden syns i balansen direkt. Betalningen (2440 mot 1930)
 * bokförs av `paySupplierInvoice` i banking.ts när pengarna dras.
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
  by?: "anvandare" | "assistent";
}

export function receiveSupplierInvoice(input: ReceiveSupplierInvoiceInput): SupplierInvoice {
  const data = db();
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error("Beloppet måste vara ett positivt heltal i kronor.");
  if (!Number.isInteger(input.vatAmount) || input.vatAmount < 0 || input.vatAmount >= input.amount)
    throw new Error("Momsbeloppet måste vara ett heltal mellan 0 och totalbeloppet.");

  const categoryKey = input.category ?? guessCategory(input.supplier)?.key ?? "ovrigt";
  const cat = categoryByKey(categoryKey);
  const now = new Date().toISOString();
  const date = input.date ?? now;
  const clamped = clampToOpenDate(date);

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
    createdAt: now,
  };

  const ver = postVerification({
    date: clamped.date,
    description: `Leverantörsfaktura ${sup.supplier} ${sup.invoiceNumber}`,
    entries: entriesSupplierInvoiceReceived(categoryKey, sup.amount, cat.vatFree ? 0 : sup.vatAmount),
    source: { type: "leverantorsfaktura", id: sup.id },
    confidence: input.category ? "hog" : "medel",
    createdBy: input.by === "assistent" ? "assistent" : "anvandare",
    explanation: `Fakturan från ${sup.supplier} bokfördes som ${cat.label.toLowerCase()} med leverantörsskuld – skulden syns i bokföringen tills den betalas.${clamped.adjusted ? ` Bokfört ${clamped.date} eftersom perioden för fakturadatumet är låst.` : ""}`,
  });
  sup.verificationId = ver.id;
  data.supplierInvoices.push(sup);
  logActivity(`Leverantörsfaktura från ${sup.supplier} (${kr(sup.amount)}) togs emot och bokfördes. Förfaller ${sup.dueDate.slice(0, 10)}.`, {});
  save();
  return sup;
}

export function listSupplierInvoices(): SupplierInvoice[] {
  return [...db().supplierInvoices].sort((a, b) => b.date.localeCompare(a.date));
}
