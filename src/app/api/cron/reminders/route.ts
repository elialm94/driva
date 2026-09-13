import { NextRequest, NextResponse } from "next/server";
import { runAutomaticReminders } from "@/lib/services/automatic-reminders";
import { withBusinessRead } from "@/lib/auth/session";
import { isSupabaseMode } from "@/lib/storage/config";
import { listActiveBusinessIds } from "@/lib/storage/list-businesses";
import { runWithTenant } from "@/lib/storage/adapter-supabase";
import { recordCronRun } from "@/lib/platform/ops";
import { reportSafeError } from "@/lib/observability/report";

export const dynamic = "force-dynamic";

/**
 * Daglig körning: offertuppföljning efter 7 dagar och fakturapåminnelse
 * efter förfallodagen. Skyddas av CRON_SECRET (Vercel Cron skickar den).
 *
 * JSON-läge: det aktiva företaget. Supabase: alla skarpa, aktiva tenants.
 * retry:false så ett mejl inte skickas två gånger vid CAS-omkörning.
 */
export async function GET(req: NextRequest) {
  const started = Date.now();
  const secret = process.env.CRON_SECRET;
  const sent = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? req.nextUrl.searchParams.get("secret");
  if (!secret || sent !== secret) {
    return NextResponse.json({ ok: false, error: "Obehörig." }, { status: 401 });
  }

  if (!isSupabaseMode()) {
    const result = await withBusinessRead(() => runAutomaticReminders());
    await recordCronRun("reminders", { businesses: 1, errors: result.errors.length, extra: { quotes: result.quotes, invoices: result.invoices } }, Date.now() - started);
    return NextResponse.json({ ok: true, businesses: 1, ...result });
  }

  const ids = await listActiveBusinessIds();
  let quotes = 0;
  let invoices = 0;
  const errors: string[] = [];
  for (const businessId of ids) {
    try {
      const result = await runWithTenant(
        { businessId, userId: null, access: "write", retry: false },
        () => runAutomaticReminders()
      );
      quotes += result.quotes;
      invoices += result.invoices;
      errors.push(...result.errors.map((e) => `${businessId}: ${e}`));
    } catch (e) {
      errors.push(`${businessId}: ${e instanceof Error ? e.message : "okänt fel"}`);
    }
  }
  await recordCronRun("reminders", { businesses: ids.length, errors: errors.length, extra: { quotes, invoices } }, Date.now() - started);
  if (errors.length > 0) {
    reportSafeError(new Error(`Påminnelsecron: ${errors.length} av ${ids.length} företag misslyckades`), {
      route: "/api/cron/reminders",
      integration: "cron",
      extra: { businesses: ids.length, errors: errors.length },
    });
  }
  return NextResponse.json({ ok: true, businesses: ids.length, quotes, invoices, errors });
}
