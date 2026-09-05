"use server";

import { revalidatePath } from "next/cache";
import { withBusiness } from "@/lib/auth/session";
import { closePeriod, PeriodCloseError } from "@/lib/accounting/period-close";

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
