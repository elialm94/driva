"use server";

import { revalidatePath } from "next/cache";
import { generateVatReport, markVatReportDeclared } from "@/lib/accounting/vat";
import { runBokslutAutomation, closeFiscalYear } from "@/lib/accounting/close";
import { undoExpenseBooking } from "@/lib/services/expenses";
import { generateAnnualReport, advanceAnnualReportStatus } from "@/lib/accounting/annual-report";
import { planAccrualForSource } from "@/lib/accounting/accruals";
import {
  confirmCreditRefundMatch,
  confirmPaymentMatch,
  confirmTaxReductionPayoutMatch,
} from "@/lib/services/payment-matching";
import { registerCreditRefund } from "@/lib/services/invoices";
import { db } from "@/lib/store";
import type { AnnualReport } from "@/lib/types";
import { withBusiness } from "@/lib/auth/session";

/**
 * Serveråtgärder för bokföringen. Tunna omslag runt domänlagret –
 * all logik och validering bor i src/lib/accounting. Allt körs i
 * tenantkontext (withBusiness) – atomär commit mot Postgres i Supabase-läge.
 */

function refresh() {
  revalidatePath("/", "layout");
}

type Result = { ok: true } | { ok: false; error: string };

async function run(fn: () => void): Promise<Result> {
  try {
    await withBusiness(() => {
      fn();
      refresh();
    });
    return { ok: true };
  } catch (e) {
    refresh();
    return { ok: false, error: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function generateVatReportAction(periodKey: string): Promise<Result> {
  return run(() => generateVatReport(periodKey, "anvandare"));
}

export async function markVatDeclaredAction(reportId: string): Promise<Result> {
  return run(() => markVatReportDeclared(reportId, "anvandare"));
}

export async function runBokslutAutomationAction(
  fiscalYearId: string
): Promise<Result & { depreciations?: number; accruals?: number }> {
  try {
    const res = await withBusiness(() => {
      const out = runBokslutAutomation(fiscalYearId, "anvandare");
      refresh();
      return out;
    });
    return { ok: true, ...res };
  } catch (e) {
    refresh();
    return { ok: false, error: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function closeFiscalYearAction(fiscalYearId: string): Promise<Result> {
  return run(() => closeFiscalYear(fiscalYearId, "anvandare"));
}

export async function undoExpenseBookingAction(expenseId: string): Promise<Result> {
  return run(() => undoExpenseBooking(expenseId, "anvandare"));
}

export async function generateAnnualReportAction(fiscalYearId: string): Promise<Result> {
  return run(() => generateAnnualReport(fiscalYearId, "anvandare"));
}

export async function advanceAnnualReportStatusAction(
  reportId: string,
  to: AnnualReport["status"]
): Promise<Result> {
  return run(() => advanceAnnualReportStatus(reportId, to, "anvandare"));
}

/* ---------------------- Betalningsmatchning (bekräfta) ---------------------- */

/** Bekräfta ett matchningsförslag: boka det faktiska bankbeloppet mot fakturan. */
export async function confirmPaymentMatchAction(txId: string, invoiceId: string): Promise<Result> {
  return run(() => confirmPaymentMatch(txId, invoiceId, "anvandare"));
}

/** Bekräfta en föreslagen ROT/RUT-utbetalning från Skatteverket. */
export async function confirmRotPayoutAction(txId: string): Promise<Result> {
  return run(() => confirmTaxReductionPayoutMatch(txId));
}

/**
 * Markera återbetalning till kund som gjord. Med en utgående banktransaktion
 * bokas den; utan bokförs utbetalningen direkt (1510 D / 1930 K).
 */
export async function registerCreditRefundAction(invoiceId: string, txId?: string): Promise<Result> {
  return run(() => {
    if (txId) confirmCreditRefundMatch(txId, invoiceId);
    else registerCreditRefund(invoiceId, {});
  });
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
  });
}
