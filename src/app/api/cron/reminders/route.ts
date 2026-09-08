import { NextRequest, NextResponse } from "next/server";
import { runAutomaticReminders } from "@/lib/services/automatic-reminders";
import { withBusinessRead } from "@/lib/auth/session";
import { isSupabaseMode } from "@/lib/storage/config";

export const dynamic = "force-dynamic";

/**
 * Daglig körning: offertuppföljning efter 7 dagar och fakturapåminnelse
 * efter förfallodagen. Skyddas av CRON_SECRET (Vercel Cron skickar den).
 *
 * I demo/JSON-läge körs det mot det aktiva företaget. I Supabase behövs
 * tenantkontext per företag – då lämnar vi en ärlig 501 tills jobbet
 * loopar över tenants (ingen tyst halv-körning).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const sent = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? req.nextUrl.searchParams.get("secret");
  if (!secret || sent !== secret) {
    return NextResponse.json({ ok: false, error: "Obehörig." }, { status: 401 });
  }
  if (isSupabaseMode()) {
    return NextResponse.json(
      { ok: false, error: "Automatiska påminnelser per tenant är inte kopplade i Supabase-läget ännu." },
      { status: 501 }
    );
  }
  const result = await withBusinessRead(() => runAutomaticReminders());
  return NextResponse.json({ ok: true, ...result });
}
