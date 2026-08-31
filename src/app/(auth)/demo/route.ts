import { NextResponse, type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isSupabaseMode } from "@/lib/storage/config";
import { clientIpFrom, isDemoLoginConfigured } from "@/lib/auth/demo-session";
import { startDemoSession } from "@/lib/auth/demo-start";

export const dynamic = "force-dynamic";

/**
 * Publik demo-entré: "Se demo" går DIREKT in i produkten – ingen mellansida,
 * inget konto. GET:en startar en riktig, tidsbegränsad demosession på servern
 * (inloggning som demo-användaren + ETT eget demoföretag per besökare) och
 * landar på appens Hem. En besökare med levande demosession återanvänder den.
 *
 * Länkar hit ska vara vanliga <a> (aldrig next/link): en prefetch får inte
 * provisionera tenants. Som extra skydd ignoreras prefetch-requests här.
 */
export async function GET(request: NextRequest) {
  // Prefetch/prerender ska aldrig starta en session eller skapa data.
  const purpose = request.headers.get("sec-purpose") ?? request.headers.get("purpose") ?? "";
  if (
    purpose.includes("prefetch") ||
    purpose.includes("prerender") ||
    request.headers.get("next-router-prefetch") === "1" ||
    request.headers.get("next-router-segment-prefetch") !== null
  ) {
    return new NextResponse(null, { status: 204 });
  }

  // JSON-läget (lokal utveckling) ÄR demon – rakt in i appen.
  if (!isSupabaseMode()) redirect("/");
  if (!isDemoLoginConfigured()) redirect("/login?demo=saknas");

  const result = await startDemoSession(clientIpFrom(await headers()));
  if (!result.ok) {
    redirect(result.reason === "rate_limited" ? "/login?demo=upptagen" : "/login?demo=fel");
  }
  redirect("/");
}
