import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseMode } from "@/lib/storage/config";
import { cleanupExpiredDemoBusinesses } from "@/lib/storage/adapter-supabase";

export const dynamic = "force-dynamic";
// Städsvepet kan radera många företag i en körning – ge det gott om tid.
export const maxDuration = 300;

/**
 * Cron-städning av utgångna demosessioner (vercel.json: en gång i timmen).
 * Raderingsvillkoret är hårdkodat i SQL-funktionen: is_demo = true AND
 * demo_expires_at < now() – riktiga företag kan aldrig träffas, oavsett vem
 * som anropar routen. Auth: Vercel Cron skickar Authorization: Bearer
 * CRON_SECRET när miljövariabeln är satt; utan CRON_SECRET vägrar routen.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Obehörig." }, { status: 401 });
  }
  if (!isSupabaseMode()) {
    return NextResponse.json({ ok: true, removed: 0, note: "JSON-läge – inget att städa." });
  }
  try {
    // Batchar tills svepet är tomt (skyddstak så en körning aldrig lööpar).
    let removed = 0;
    for (let i = 0; i < 40; i++) {
      const ids = await cleanupExpiredDemoBusinesses(25);
      removed += ids.length;
      if (ids.length < 25) break;
    }
    if (removed > 0) console.info(`[driva:demo] städade ${removed} utgångna demosessioner`);
    return NextResponse.json({ ok: true, removed });
  } catch (e) {
    console.error(`[driva:demo] cron-städning misslyckades: ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "Städningen misslyckades." }, { status: 500 });
  }
}
