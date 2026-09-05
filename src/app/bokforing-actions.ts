"use server";

import { revalidatePath } from "next/cache";
import { generateVatReport, markVatReportDeclared, setVatPeriodicity } from "@/lib/accounting/vat";
import { isVatPeriodicity } from "@/lib/accounting/dates";
import {
  bookFSkatt,
  bookTaxAccountDeposit,
  bookVatOnTaxAccount,
  parseTaxAccountStatement,
  reconcileTaxAccount,
  type TaxAccountReconciliation,
} from "@/lib/accounting/tax-account";
import { runBokslutAutomation, closeFiscalYear } from "@/lib/accounting/close";
import { undoExpenseBooking } from "@/lib/services/expenses";
import {
  listVerificationViews,
  postVerificationCorrection,
  type CorrectionIntent,
  type VerificationView,
} from "@/lib/services/verification-correction";
import { generateAnnualReport, advanceAnnualReportStatus } from "@/lib/accounting/annual-report";
import { planAccrualForSource } from "@/lib/accounting/accruals";
import {
  confirmCreditRefundMatch,
  confirmPaymentMatch,
  confirmTaxReductionPayoutMatch,
} from "@/lib/services/payment-matching";
import { registerCreditRefund } from "@/lib/services/invoices";
import { newAttachmentKey, postManualVerification } from "@/lib/services/manual-verification";
import { storeVerificationAttachment } from "@/lib/receipts/verification-attachment";
import { parseReceiptDataUrl } from "@/lib/receipts/receipt-file";
import { verificationLabel } from "@/lib/accounting/engine";
import { db } from "@/lib/store";
import type { AnnualReport, VerificationAttachment } from "@/lib/types";
import { withBusiness, withBusinessRead } from "@/lib/auth/session";

/**
 * Serveråtgärder för bokföringen. Tunna omslag runt domänlagret –
 * all logik och validering bor i src/lib/accounting. Allt körs i
 * tenantkontext (withBusiness) – atomär commit mot Postgres i Supabase-läge.
 */

function refresh() {
  revalidatePath("/", "layout");
}

type Result = { ok: true } | { ok: false; error: string };

async function run(
  fn: () => void,
  capability: "vat" | "year_end" | "write_accounting" | "correct_voucher" | "match_payment"
): Promise<Result> {
  try {
    await withBusiness(() => {
      fn();
      refresh();
    }, { capability });
    return { ok: true };
  } catch (e) {
    refresh();
    return { ok: false, error: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function generateVatReportAction(periodKey: string): Promise<Result> {
  return run(() => generateVatReport(periodKey, "anvandare"), "vat");
}

export async function markVatDeclaredAction(reportId: string): Promise<Result> {
  return run(() => markVatReportDeclared(reportId, "anvandare"), "vat");
}

export async function setVatPeriodicityAction(periodicity: string): Promise<Result> {
  if (!isVatPeriodicity(periodicity)) return { ok: false, error: "Okänd momsperiod." };
  return run(() => setVatPeriodicity(periodicity, "anvandare"), "vat");
}

export async function bookVatOnTaxAccountAction(reportId: string): Promise<Result> {
  return run(() => void bookVatOnTaxAccount(reportId, "anvandare"), "vat");
}

export async function bookFSkattAction(month: string): Promise<Result> {
  return run(() => void bookFSkatt(month, "anvandare"), "write_accounting");
}

export async function bookTaxAccountDepositAction(txId: string): Promise<Result> {
  return run(() => void bookTaxAccountDeposit(txId, "anvandare"), "write_accounting");
}

/**
 * Avstämning mot skattekontoutdraget. Läser bara – utdraget lagras aldrig, på
 * samma sätt som bankavstämningen härleds i stället för att sparas.
 */
export async function reconcileTaxAccountAction(
  text: string
): Promise<{ ok: true; result: TaxAccountReconciliation; parsed: number } | { ok: false; error: string }> {
  try {
    return await withBusinessRead(() => {
      const statement = parseTaxAccountStatement(text);
      if (statement.length === 0) {
        return { ok: false as const, error: "Hittade inga rader. Varje rad ska börja med datum (2026-05-12) och sluta med belopp." };
      }
      return { ok: true as const, result: reconcileTaxAccount(statement), parsed: statement.length };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function runBokslutAutomationAction(
  fiscalYearId: string
): Promise<Result & { depreciations?: number; accruals?: number }> {
  try {
    const res = await withBusiness(() => {
      const out = runBokslutAutomation(fiscalYearId, "anvandare");
      refresh();
      return out;
    }, { capability: "year_end" });
    return { ok: true, ...res };
  } catch (e) {
    refresh();
    return { ok: false, error: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function closeFiscalYearAction(fiscalYearId: string): Promise<Result> {
  return run(() => closeFiscalYear(fiscalYearId, "anvandare"), "year_end");
}

export async function undoExpenseBookingAction(expenseId: string): Promise<Result> {
  return run(() => undoExpenseBooking(expenseId, "anvandare"), "write_accounting");
}

export type CorrectVerificationResult =
  | {
      ok: true;
      originalId: string;
      originalLabel: string;
      reversalId: string;
      reversalLabel: string;
      replacementId?: string;
      replacementLabel?: string;
      idempotent: boolean;
      views: VerificationView[];
    }
  | { ok: false; error: string };

export async function correctVerificationAction(
  verificationId: string,
  intent: CorrectionIntent
): Promise<CorrectVerificationResult> {
  try {
    const posted = await withBusiness(() => {
      const out = postVerificationCorrection(verificationId, intent, "anvandare");
      refresh();
      return out;
    }, { capability: "correct_voucher" });
    return {
      ok: true,
      originalId: posted.original.id,
      originalLabel: posted.originalLabel,
      reversalId: posted.reversal.id,
      reversalLabel: posted.reversalLabel,
      replacementId: posted.replacement?.id,
      replacementLabel: posted.replacementLabel,
      idempotent: posted.idempotent,
      views: listVerificationViews(),
    };
  } catch (e) {
    refresh();
    return { ok: false, error: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function generateAnnualReportAction(fiscalYearId: string): Promise<Result> {
  return run(() => generateAnnualReport(fiscalYearId, "anvandare"), "year_end");
}

export async function advanceAnnualReportStatusAction(
  reportId: string,
  to: AnnualReport["status"]
): Promise<Result> {
  return run(() => advanceAnnualReportStatus(reportId, to, "anvandare"), "year_end");
}

/* ---------------------- Betalningsmatchning (bekräfta) ---------------------- */

/** Bekräfta ett matchningsförslag: boka det faktiska bankbeloppet mot fakturan. */
export async function confirmPaymentMatchAction(txId: string, invoiceId: string): Promise<Result> {
  return run(() => confirmPaymentMatch(txId, invoiceId, "anvandare"), "match_payment");
}

/** Bekräfta en föreslagen ROT/RUT-utbetalning från Skatteverket. */
export async function confirmRotPayoutAction(txId: string): Promise<Result> {
  return run(() => confirmTaxReductionPayoutMatch(txId), "match_payment");
}

/**
 * Markera återbetalning till kund som gjord. Med en utgående banktransaktion
 * bokas den; utan bokförs utbetalningen direkt (1510 D / 1930 K).
 */
export async function registerCreditRefundAction(invoiceId: string, txId?: string): Promise<Result> {
  return run(() => {
    if (txId) confirmCreditRefundMatch(txId, invoiceId);
    else registerCreditRefund(invoiceId, {});
  }, "match_payment");
}

export async function planAccrualAction(input: {
  sourceType: "utgift" | "leverantorsfaktura";
  sourceId: string;
  fromDate: string;
  toDate: string;
  fiscalYearId: string;
}): Promise<Result> {
  return run(() => {
    const data = db();
    if (input.sourceType === "utgift") {
      const expense = data.expenses.find((e) => e.id === input.sourceId);
      if (!expense) throw new Error("Utgiften finns inte.");
      planAccrualForSource({ type: "utgift", expense }, { fromDate: input.fromDate, toDate: input.toDate }, input.fiscalYearId, "anvandare");
    } else {
      const invoice = data.supplierInvoices.find((s) => s.id === input.sourceId);
      if (!invoice) throw new Error("Leverantörsfakturan finns inte.");
      planAccrualForSource({ type: "leverantorsfaktura", invoice }, { fromDate: input.fromDate, toDate: input.toDate }, input.fiscalYearId, "anvandare");
    }
  }, "write_accounting");
}

/* --------------------------- Manuellt verifikat ---------------------------- */

export interface ManualVerificationFormLine {
  account: number;
  debit?: number;
  credit?: number;
  note?: string;
}

export interface ManualVerificationFormInput {
  date?: string;
  transactionDate?: string;
  description: string;
  explanation?: string;
  lines: ManualVerificationFormLine[];
  /** Underlaget som data-URL (bild eller PDF). Lagras innan verifikationen bokförs. */
  attachmentDataUrl?: string;
  attachmentFilename?: string;
  /**
   * Klienten som bokföringen gäller. Konsultytan skickar den uttryckligen så
   * att verifikatet aldrig hamnar hos fel klient om cookien pekar någon annanstans;
   * withBusiness kontrollerar medlemskapet innan något bokförs.
   */
  businessId?: string;
}

export type ManualVerificationResult =
  | { ok: true; id: string; label: string; total: number }
  | { ok: false; error: string };

/**
 * Bokför ett manuellt verifikat. Samma väg som all annan bokföring
 * (postVerification), med serie M och underlaget som bilaga. Bilagan lagras
 * FÖRE bokföringen: går lagringen fel bokförs ingenting, så en verifikation
 * pekar aldrig på ett underlag som inte finns.
 */
export async function postManualVerificationAction(
  input: ManualVerificationFormInput
): Promise<ManualVerificationResult> {
  try {
    const posted = await withBusiness(
      async () => {
        let attachment: VerificationAttachment | undefined;
        if (input.attachmentDataUrl) {
          const file = parseReceiptDataUrl(input.attachmentDataUrl);
          if (!file) throw new Error("Underlaget kunde inte läsas. Försök ladda upp filen igen.");
          attachment = await storeVerificationAttachment(
            newAttachmentKey(),
            input.attachmentFilename?.trim() || "underlag",
            file
          );
        }
        const verification = postManualVerification(
          {
            date: input.date,
            transactionDate: input.transactionDate,
            description: input.description,
            explanation: input.explanation,
            lines: input.lines,
            attachment,
          },
          "anvandare"
        );
        refresh();
        return verification;
      },
      { capability: "write_accounting", businessId: input.businessId }
    );
    return {
      ok: true,
      id: posted.id,
      label: verificationLabel(posted),
      total: posted.entries.reduce((s, e) => s + e.debit, 0),
    };
  } catch (e) {
    refresh();
    return { ok: false, error: e instanceof Error ? e.message : "Verifikatet kunde inte bokföras." };
  }
}
