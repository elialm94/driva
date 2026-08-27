"use server";

import { revalidatePath } from "next/cache";
import { generateVatReport, markVatReportDeclared } from "@/lib/accounting/vat";
import { runBokslutAutomation, closeFiscalYear } from "@/lib/accounting/close";
import { undoExpenseBooking } from "@/lib/services/expenses";
import { generateAnnualReport, advanceAnnualReportStatus } from "@/lib/accounting/annual-report";
import { planAccrualForSource } from "@/lib/accounting/accruals";
import { db } from "@/lib/store";
import type { AnnualReport } from "@/lib/types";

/**
 * Serveråtgärder för bokföringen. Tunna omslag runt domänlagret –
 * all logik och validering bor i src/lib/accounting.
 */

function refresh() {
  revalidatePath("/", "layout");
}

type Result = { ok: true } | { ok: false; error: string };

function run(fn: () => void): Result {
  try {
    fn();
    refresh();
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
    const res = runBokslutAutomation(fiscalYearId, "anvandare");
    refresh();
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
