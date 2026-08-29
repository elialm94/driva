import { NextRequest, NextResponse } from "next/server";
import { resetDemoData, resetToEmptyCompany } from "@/lib/store";
import { buildScaleData } from "@/lib/dev/scale-data";
import { isSupabaseMode } from "@/lib/storage/config";

/**
 * Dev-verktyg: byt mellan demodata, ett helt tomt företag och en syntetisk
 * stordatabas (skalprov). Finns inte i produktion.
 *
 *   POST /api/dev/reset  { "mode": "empty" }  → tomt företag
 *   POST /api/dev/reset  { "mode": "seed" }   → demodata
 *   POST /api/dev/reset  { "mode": "scale" }  → ~5 000 kunder, ~2 000 uppdrag,
 *                                               ~10 000 fakturor, ~20 000+ huvudboksrader
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Inte tillgängligt i produktion" }, { status: 404 });
  }
  if (isSupabaseMode()) {
    return NextResponse.json(
      { error: "Endast JSON-läget. Mot Supabase: använd npm run db:seed." },
      { status: 400 }
    );
  }
  const body = (await req.json().catch(() => ({}))) as { mode?: string };
  if (body.mode === "empty") {
    resetToEmptyCompany();
    return NextResponse.json({ ok: true, mode: "empty" });
  }
  if (body.mode === "seed") {
    resetDemoData();
    return NextResponse.json({ ok: true, mode: "seed" });
  }
  if (body.mode === "scale") {
    const stats = buildScaleData();
    return NextResponse.json({ ok: true, mode: "scale", ...stats });
  }
  return NextResponse.json({ error: "mode måste vara \"empty\", \"seed\" eller \"scale\"" }, { status: 400 });
}
