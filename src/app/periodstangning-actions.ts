"use server";

import { revalidatePath } from "next/cache";
import { withBusiness } from "@/lib/auth/session";
import { closeAllReadyMonths, closePeriod, PeriodCloseError } from "@/lib/accounting/period-close";

/**
 * Serveråtgärd för periodstängning. Tunt omslag runt accounting/period-close.
 *
 * Behörigheten är `period_close`: månadsavstämningen är byråns löpande arbete,
 * och en läsande revisor låser ingen period.
 */

export async function closePeriodAction(
  periodKey: string,
  businessId?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await withBusiness(async () => closePeriod(periodKey, "anvandare"), {
      capability: "period_close",
      businessId,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof PeriodCloseError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "Perioden kunde inte stängas." };
  }
}

export async function closeAllReadyMonthsAction(
  businessId?: string
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const closed = await withBusiness(async () => closeAllReadyMonths("anvandare"), {
      capability: "period_close",
      businessId,
    });
    revalidatePath("/", "layout");
    return { ok: true, count: closed.length };
  } catch (e) {
    if (e instanceof PeriodCloseError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "Månaderna kunde inte stängas." };
  }
}
