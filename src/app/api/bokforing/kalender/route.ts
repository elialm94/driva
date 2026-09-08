import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";
import { authorityCalendarIcs } from "@/lib/accounting/skatteverket-calendar";
import { withBusinessRead } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Kalenderfil (ICS) med kommande datum till Skatteverket och Bolagsverket.
 * Samma poster som Bokföring → Kommande. Inloggad läsning räcker – ingen
 * mutering. Lägg in filen i Kalender, Google eller Outlook.
 */
export async function GET(req: NextRequest) {
  return withBusinessRead(() => {
    const origin = req.nextUrl.origin;
    const ics = authorityCalendarIcs({
      companyName: db().settings.name,
      origin,
    });
    return new NextResponse(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="skatteverket.ics"',
        "Cache-Control": "no-store",
      },
    });
  });
}
