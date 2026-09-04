import { db, save } from "../store";
import type { BankTransaction } from "../types";
import {
  getInvoice,
  invoiceOutstanding,
  isOpenReceivable,
  requireCustomer,
} from "./data";
import { creditRefundDue, registerCreditRefund, registerInvoicePayment } from "./invoices";
import {
  ORE_TOLERANS_KR,
  decideFromConfidence,
  type AutopilotOutcome,
} from "../autopilot";
import { kr } from "../format";
import { logActivity } from "./activity";
import { isValidBankgirotOcr } from "../ids";
import { merchantRuleKey } from "./expenses";
import { bookSupplierPaymentFromBank, supplierPayments } from "./supplier-payments";
import { normalizeRecipientAccount } from "../inbox/workflow";
import {
  expectedTaxReductionPayouts,
  registerTaxReductionPayout,
  type ExpectedTaxReductionPayout,
} from "./tax-reduction";

/**
 * Betalningsmatchning – hjärtat i autopiloten för inbetalningar.
 *
 * Signaler (i fallande styrka): exakt OCR-token, fakturanummer, exakt belopp,
 * avsändarnamn, datumnärhet. Konfidensen mappas centralt (autopilot.ts):
 *   * AUTO_EXECUTE  → bokförs direkt med förklaring.
 *   * SUGGEST       → förslag på Hem/Ekonomi som användaren bekräftar.
 *   * REQUIRES_USER → "behöver åtgärd" med härledd diagnos.
 *
 * Idempotens: en banktransaktion kan aldrig bokas två gånger (statusvakt här,
 * unikt index på payments.bank_transaction_id i databasen). Beloppet som
 * bokförs är ALLTID transaktionens faktiska belopp – aldrig fakturans.
 */

/* ------------------------------ Normalisering ------------------------------ */

/** Sifferttokens (≥ 4 siffror) ur referens + beskrivning – exakta tokens, aldrig substrängar. */
export function referenceTokens(tx: Pick<BankTransaction, "reference" | "description">): string[] {
  const text = `${tx.reference ?? ""} ${tx.description ?? ""}`;
  return [...text.matchAll(/\d{4,}/g)].map((m) => m[0]);
}

/** Bankgirot OCR-10-kontroll (samma som `isValidBankgirotOcr` i ids.ts). */
export function luhnValid(token: string): boolean {
  return isValidBankgirotOcr(token);
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(ab|hb|kb|aktiebolag|handelsbolag)\b/g, "")
    .replace(/[^a-zåäö0-9]+/g, " ")
    .trim();
}

/** Avsändarnamn ≈ kundnamn (exakt eller ena innehåller den andra, normaliserat). */
export function counterpartMatchesCustomer(counterpart: string, customerName: string): boolean {
  const a = normalizeName(counterpart);
  const b = normalizeName(customerName);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/* ------------------------------- Kandidater -------------------------------- */

export interface PaymentMatchCandidate {
  invoiceId: string;
  invoiceNumber: number | null;
  customerName: string;
  /** Identitetskonfidens 0–1: hur säkra är vi på att betalningen avser fakturan? */
  confidence: number;
  /** Klartextskäl, t.ex. ["Exakt OCR", "Exakt belopp"]. */
  reasons: string[];
  outstanding: number;
  /** outstanding − tx.amount: >0 underbetalning, <0 överbetalning. */
  diff: number;
}

function daysBetweenIso(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000));
}

/**
 * Poängsätt alla öppna fordringar mot en inkommande transaktion.
 * Deterministiska regler – konfidenssiffrorna bor här och trösklarna i autopilot.ts.
 */
export function scorePaymentCandidates(tx: BankTransaction): PaymentMatchCandidate[] {
  const data = db();
  const tokens = new Set(referenceTokens(tx));
  const open = data.invoices.filter(isOpenReceivable);
  const candidates: PaymentMatchCandidate[] = [];

  // Hur många öppna fakturor delar exakt belopp? (unikhet är en signal)
  const amountMatches = open.filter((i) => {
    const out = invoiceOutstanding(i);
    return Math.abs(out - tx.amount) <= ORE_TOLERANS_KR;
  });

  for (const invoice of open) {
    const customer = requireCustomer(invoice.customerId);
    const outstanding = invoiceOutstanding(invoice);
    const diff = outstanding - tx.amount;
    const reasons: string[] = [];
    let confidence = 0;

    const ocrHit = invoice.ocr && tokens.has(invoice.ocr) && luhnValid(invoice.ocr);
    const numberHit = invoice.number != null && tokens.has(String(invoice.number));
    const amountExact = Math.abs(diff) <= ORE_TOLERANS_KR;
    const nameHit = counterpartMatchesCustomer(tx.counterpart, customer.name);
    const dueNear = daysBetweenIso(tx.date, invoice.dueDate) <= 30;

    if (ocrHit) {
      reasons.push("Exakt OCR");
      confidence = amountExact ? 1 : 0.98;
      if (amountExact) reasons.push(diff === 0 ? "Exakt belopp" : "Belopp inom öres-tolerans");
      else reasons.push(`Beloppet avviker med ${kr(Math.abs(diff))}`);
    } else if (numberHit) {
      reasons.push(`Fakturanummer ${invoice.number} i referensen`);
      if (amountExact) {
        confidence = 0.98;
        reasons.push(diff === 0 ? "Exakt belopp" : "Belopp inom öres-tolerans");
      } else if (nameHit) {
        confidence = 0.9;
        reasons.push("Avsändarnamnet stämmer");
      } else {
        confidence = 0.85;
      }
    } else if (amountExact && amountMatches.length === 1) {
      reasons.push("Exakt belopp (entydigt bland öppna fakturor)");
      if (nameHit) {
        confidence = 0.99;
        reasons.push("Avsändarnamnet stämmer");
      } else if (dueNear) {
        confidence = 0.9;
        reasons.push("Nära förfallodatum");
      } else {
        confidence = 0.85;
      }
    } else if (amountExact && nameHit) {
      // Flera fakturor med samma belopp – namnet avgör om det blir entydigt.
      const sameName = amountMatches.filter((i) =>
        counterpartMatchesCustomer(tx.counterpart, requireCustomer(i.customerId).name)
      );
      reasons.push("Exakt belopp", "Avsändarnamnet stämmer");
      confidence = sameName.length === 1 ? 0.95 : 0.5;
      if (sameName.length > 1) reasons.push("Flera fakturor med samma belopp och kund");
    } else if (nameHit) {
      reasons.push("Avsändarnamnet stämmer (belopp avviker)");
      confidence = 0.6;
    }

    if (confidence > 0) {
      candidates.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        customerName: customer.name,
        confidence,
        reasons,
        outstanding,
        diff,
      });
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/* --------------------------- Härledda förslag (UI) -------------------------- */

export type PaymentSuggestionKind =
  | "match" // trolig faktura – bekräfta bokning
  | "overpayment" // säker faktura men överbetald – kräver beslut
  | "duplicate" // OCR pekar på redan betald faktura
  | "tax_reduction_payout" // Skatteverket-utbetalning mot ROT/RUT-fordran
  | "credit_refund" // utgående betalning som ser ut som återbetalning av kredit
  | "supplier_payment" // utgående betalning mot leverantörsinstruktion
  | "none";

export interface PaymentSuggestion {
  kind: PaymentSuggestionKind;
  outcome: AutopilotOutcome;
  /** Förklaring i klartext ("Matchad på exakt OCR + exakt belopp"). */
  reason: string;
  invoiceId?: string;
  invoiceNumber?: number | null;
  customerName?: string;
  supplierPaymentId?: string;
  /** För ROT-utbetalningar. */
  payout?: ExpectedTaxReductionPayout;
  amount: number;
  diff?: number;
}

function scoreOutgoingSupplierPayments(tx: BankTransaction): PaymentSuggestion | null {
  // PAYMENT_FILE_CREATED räknas som förväntad utbetalning: filen laddades
  // upp i internetbanken utanför Driva, så banktransaktionen är första
  // beviset på att betalningen faktiskt genomfördes.
  const open = supplierPayments().filter(
    (p) =>
      p.status === "PAYMENT_FILE_CREATED" ||
      p.status === "SUBMITTED_TO_BANK" ||
      p.status === "AWAITING_APPROVAL" ||
      p.status === "SCHEDULED"
  );
  if (open.length === 0) return null;
  const amount = Math.abs(tx.amount);
  const tokens = new Set(referenceTokens(tx));
  const txAccount = normalizeRecipientAccount(`${tx.counterpart} ${tx.description} ${tx.reference ?? ""}`);

  let best: { paymentId: string; confidence: number; reasons: string[] } | null = null;
  for (const payment of open) {
    const invoice = db().supplierInvoices.find((s) => s.id === payment.supplierInvoiceId);
    if (!invoice) continue;
    const reasons: string[] = [];
    let confidence = 0;
    if (payment.providerPaymentId && (tx.reference === payment.providerPaymentId || tx.description.includes(payment.providerPaymentId))) {
      reasons.push("Provider-id");
      confidence = 1;
    }
    const amountExact = amount === payment.amount;
    if (amountExact) {
      reasons.push("Exakt belopp");
      confidence = Math.max(confidence, 0.7);
    }
    const ocr = payment.ocr ?? invoice.ocr;
    if (ocr && tokens.has(ocr)) {
      reasons.push("Exakt OCR");
      confidence = Math.max(confidence, amountExact ? 0.99 : 0.9);
    }
    const recipient = normalizeRecipientAccount(payment.recipientAccount);
    const name = merchantRuleKey(payment.recipientName);
    if (recipient && txAccount.includes(recipient)) {
      reasons.push("Mottagarkonto");
      confidence = Math.max(confidence, amountExact ? 0.98 : 0.75);
    } else if (name && (merchantRuleKey(tx.counterpart).includes(name) || name.includes(merchantRuleKey(tx.counterpart)))) {
      reasons.push("Mottagarnamn");
      confidence = Math.max(confidence, amountExact ? 0.95 : 0.65);
    }
    const days = Math.abs(Math.round((Date.parse(tx.date) - Date.parse(payment.scheduledDate)) / 86_400_000));
    if (days <= 5) {
      reasons.push("Nära betaldatum");
      if (confidence >= 0.7) confidence = Math.min(1, confidence + 0.02);
    }
    if (confidence > (best?.confidence ?? 0)) best = { paymentId: payment.id, confidence, reasons };
  }
  if (!best || best.confidence < 0.7) return null;
  const outcome = decideFromConfidence(best.confidence);
  return {
    kind: "supplier_payment",
    outcome,
    reason: `Matchad leverantörsbetalning på ${best.reasons.join(" + ").toLowerCase()}`,
    supplierPaymentId: best.paymentId,
    amount: tx.amount,
  };
}

function skvCounterpart(tx: BankTransaction): boolean {
  return /skatteverket/i.test(`${tx.counterpart} ${tx.description} ${tx.reference ?? ""}`);
}

/**
 * Härlett förslag för en obokad transaktion – används av actionmotorn och
 * bankvyn. Lagras aldrig: förslaget räknas om ur aktuell data varje gång,
 * så det kan inte bli inaktuellt.
 */
export function paymentSuggestionForTransaction(tx: BankTransaction): PaymentSuggestion {
  if (tx.status === "bokford") return { kind: "none", outcome: "BLOCKED", reason: "Redan bokförd", amount: tx.amount };

  if (tx.amount > 0 && skvCounterpart(tx)) {
    const payouts = expectedTaxReductionPayouts();
    const exact = payouts.filter((p) => p.expectedAmount === tx.amount);
    if (exact.length === 1) {
      return {
        kind: "tax_reduction_payout",
        outcome: "AUTO_EXECUTE",
        reason: `Skatteverket som avsändare + exakt belopp för ${exact[0].label}`,
        payout: exact[0],
        amount: tx.amount,
      };
    }
    if (payouts.length === 1 && tx.amount < payouts[0].expectedAmount) {
      return {
        kind: "tax_reduction_payout",
        outcome: "SUGGEST",
        reason: `Skatteverket betalade ${kr(tx.amount)} av väntade ${kr(payouts[0].expectedAmount)} – delvis godkänt?`,
        payout: payouts[0],
        amount: tx.amount,
        diff: payouts[0].expectedAmount - tx.amount,
      };
    }
    if (payouts.length > 0) {
      return {
        kind: "tax_reduction_payout",
        outcome: "REQUIRES_USER",
        reason: "Utbetalning från Skatteverket kunde inte matchas entydigt mot en ROT/RUT-ansökan",
        amount: tx.amount,
      };
    }
    return { kind: "none", outcome: "REQUIRES_USER", reason: "Utbetalning från Skatteverket utan öppen ROT/RUT-fordran", amount: tx.amount };
  }

  if (tx.amount > 0) {
    const candidates = scorePaymentCandidates(tx);
    const best = candidates[0];

    if (!best) {
      // Dubbelbetalning? OCR som pekar på en redan betald faktura.
      const tokens = new Set(referenceTokens(tx));
      const paidHit = db().invoices.find(
        (i) => i.status === "betald" && i.ocr && tokens.has(i.ocr)
      );
      if (paidHit) {
        return {
          kind: "duplicate",
          outcome: "REQUIRES_USER",
          reason: `OCR pekar på faktura #${paidHit.number} som redan är betald – möjlig dubbelbetalning`,
          invoiceId: paidHit.id,
          invoiceNumber: paidHit.number,
          amount: tx.amount,
        };
      }
      return { kind: "none", outcome: "REQUIRES_USER", reason: "Ingen faktura matchar referens, belopp eller avsändare", amount: tx.amount };
    }

    const outcome = decideFromConfidence(best.confidence);
    const overpaid = best.diff < -ORE_TOLERANS_KR;
    if (outcome === "AUTO_EXECUTE" && overpaid) {
      // Överbetalning bokas aldrig automatiskt – människan avgör överskottet.
      return {
        kind: "overpayment",
        outcome: "REQUIRES_USER",
        reason: `${best.reasons.join(" + ")} – betalningen avviker med +${kr(-best.diff)}`,
        invoiceId: best.invoiceId,
        invoiceNumber: best.invoiceNumber,
        customerName: best.customerName,
        amount: tx.amount,
        diff: best.diff,
      };
    }
    return {
      kind: "match",
      outcome,
      reason: `Matchad på ${best.reasons.join(" + ").toLowerCase()}`,
      invoiceId: best.invoiceId,
      invoiceNumber: best.invoiceNumber,
      customerName: best.customerName,
      amount: tx.amount,
      diff: best.diff,
    };
  }

  if (tx.amount < 0) {
    const outgoing = scoreOutgoingSupplierPayments(tx);
    if (outgoing) return outgoing;
  }

  // Utgående betalning: återbetalning av krediterad faktura?
  const refundCandidates = db().invoices.filter((i) => creditRefundDue(i) > 0);
  const refundHit = refundCandidates.find(
    (i) =>
      creditRefundDue(i) === -tx.amount &&
      counterpartMatchesCustomer(tx.counterpart, requireCustomer(i.customerId).name)
  );
  if (refundHit) {
    return {
      kind: "credit_refund",
      outcome: "SUGGEST",
      reason: `Utbetalning till ${requireCustomer(refundHit.customerId).name} med exakt återbetalningsbelopp för krediterad faktura #${refundHit.number}`,
      invoiceId: refundHit.id,
      invoiceNumber: refundHit.number,
      amount: tx.amount,
    };
  }
  return { kind: "none", outcome: "REQUIRES_USER", reason: "Utgående betalning utan känd motpart", amount: tx.amount };
}

/* -------------------------------- Utförande -------------------------------- */

export interface ProcessTransactionResult {
  outcome: "booked" | "suggested" | "unmatched" | "skipped";
  suggestion?: PaymentSuggestion;
}

/**
 * Kör autopiloten på en inkommande banktransaktion. AUTO_EXECUTE bokförs
 * direkt (faktiskt belopp), allt annat parkeras som "behöver åtgärd" med ett
 * härlett förslag. Idempotent: bokförda transaktioner rörs aldrig.
 */
export function processIncomingTransaction(txId: string): ProcessTransactionResult {
  const data = db();
  const tx = data.bankTransactions.find((t) => t.id === txId);
  if (!tx || tx.status === "bokford") return { outcome: "skipped" };
  if (data.payments.some((p) => p.bankTransactionId === txId)) {
    // Domänvakt (DB har unikt index): transaktionen är redan använd.
    tx.status = "bokford";
    save();
    return { outcome: "skipped" };
  }

  const suggestion = paymentSuggestionForTransaction(tx);

  if (suggestion.outcome === "AUTO_EXECUTE" && suggestion.kind === "supplier_payment" && suggestion.supplierPaymentId) {
    const payment = supplierPayments().find((p) => p.id === suggestion.supplierPaymentId);
    if (payment) {
      bookSupplierPaymentFromBank({
        payment,
        bankTransactionId: tx.id,
        matchReason: suggestion.reason,
      });
      return { outcome: "booked", suggestion };
    }
  }

  if (suggestion.outcome === "AUTO_EXECUTE") {
    if (suggestion.kind === "match" && suggestion.invoiceId) {
      registerInvoicePayment(suggestion.invoiceId, {
        amount: tx.amount,
        bankTransactionId: tx.id,
        matchedBy: "auto",
        matchReason: suggestion.reason,
        confidence: 1,
      });
      return { outcome: "booked", suggestion };
    }
    if (suggestion.kind === "tax_reduction_payout" && suggestion.payout) {
      registerTaxReductionPayout({
        jobId: suggestion.payout.jobId,
        invoiceId: suggestion.payout.invoiceId,
        amount: tx.amount,
        bankTransactionId: tx.id,
        matchReason: suggestion.reason,
      });
      return { outcome: "booked", suggestion };
    }
  }

  tx.status = "behover_atgard";
  if (suggestion.kind !== "none") {
    logActivity(
      `En ${tx.amount > 0 ? "inbetalning" : "utbetalning"} på ${kr(Math.abs(tx.amount))} från ${tx.counterpart} väntar på bekräftelse: ${suggestion.reason}.`
    );
    save();
    return { outcome: "suggested", suggestion };
  }
  logActivity(`En inbetalning på ${kr(tx.amount)} från ${tx.counterpart} kunde inte matchas mot någon faktura.`);
  save();
  return { outcome: "unmatched", suggestion };
}

/**
 * Bekräfta ett förslag manuellt (SUGGEST/REQUIRES_USER → människa godkänner).
 * Bokför det FAKTISKA beloppet; överbetalning bokas med överskott som skuld.
 */
export function confirmPaymentMatch(txId: string, invoiceId: string, by: "anvandare" | "assistent" = "anvandare"): void {
  const data = db();
  const tx = data.bankTransactions.find((t) => t.id === txId);
  if (!tx) throw new Error("Banktransaktionen finns inte.");
  if (tx.status === "bokford") throw new Error("Banktransaktionen är redan bokförd.");
  if (tx.amount <= 0) throw new Error("Endast inbetalningar kan matchas mot kundfakturor.");
  const invoice = getInvoice(invoiceId);
  if (!invoice) throw new Error("Fakturan finns inte.");
  void by;
  registerInvoicePayment(invoiceId, {
    amount: tx.amount,
    bankTransactionId: tx.id,
    matchedBy: "manuell",
    matchReason: "Bekräftad manuellt mot föreslagen faktura",
  });
}

/** Bekräfta en föreslagen ROT/RUT-utbetalning (t.ex. delvis godkänd). */
export function confirmTaxReductionPayoutMatch(txId: string): void {
  const data = db();
  const tx = data.bankTransactions.find((t) => t.id === txId);
  if (!tx) throw new Error("Banktransaktionen finns inte.");
  if (tx.status === "bokford") throw new Error("Banktransaktionen är redan bokförd.");
  const suggestion = paymentSuggestionForTransaction(tx);
  if (suggestion.kind !== "tax_reduction_payout" || !suggestion.payout) {
    throw new Error("Transaktionen ser inte ut som en ROT/RUT-utbetalning.");
  }
  registerTaxReductionPayout({
    jobId: suggestion.payout.jobId,
    invoiceId: suggestion.payout.invoiceId,
    amount: tx.amount,
    bankTransactionId: tx.id,
    matchReason: suggestion.reason,
  });
}

/** Bekräfta en utgående transaktion som återbetalning av krediterad faktura. */
export function confirmCreditRefundMatch(txId: string, invoiceId: string): void {
  const data = db();
  const tx = data.bankTransactions.find((t) => t.id === txId);
  if (!tx) throw new Error("Banktransaktionen finns inte.");
  if (tx.status === "bokford") throw new Error("Banktransaktionen är redan bokförd.");
  if (tx.amount >= 0) throw new Error("Endast utgående betalningar kan registreras som återbetalning.");
  registerCreditRefund(invoiceId, { bankTransactionId: txId, amount: -tx.amount });
}
