/**
 * GET /api/bank/tink/callback – TINK_REDIRECT_URI.
 *
 * Tink Link skickar användaren hit (helsidesnavigering) med
 *   ?credentials_id=…&state=…                 vid lyckad koppling
 *   ?error=…&error_reason=…&message=…&state=… vid fel/avbrutet
 *
 * Kräver användarens session (cookie följer med på toppnivå-navigeringen;
 * utan session skickar proxyn till /login?next=… och tillbaka hit). Företaget
 * löses ur sessionen – aldrig ur URL:en – och state måste matcha det vi
 * sparade när flödet startade (CSRF + rätt företag). Kodutbyte, konto- och
 * transaktionshämtning sker på servern; svaret är alltid en redirect till
 * Bank-fliken med ett kort statusord – ingen Tink-JSON når webbläsaren.
 */
import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { withBusiness } from "@/lib/auth/session";
import { selectBankProvider } from "@/lib/banking/select";
import { userFacingBankError } from "@/lib/banking/errors";

export const dynamic = "force-dynamic";

type BankNotice = "kopplad" | "avbrutet" | "fel";

function bankTab(request: NextRequest, notice: BankNotice, error?: string): NextResponse {
  const url = new URL("/ekonomi", request.url);
  url.searchParams.set("flik", "bank");
  url.searchParams.set("bank", notice);
  if (error) url.searchParams.set("meddelande", error);
  return NextResponse.redirect(url, { status: 303 });
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  try {
    const outcome = await withBusiness(
      () =>
        selectBankProvider().handleCallback({
          credentialsId: q.get("credentials_id") ?? q.get("credentialsId"),
          state: q.get("state"),
          error: q.get("error"),
          errorReason: q.get("error_reason"),
          message: q.get("message"),
        }),
      { retry: false }
    );
    revalidatePath("/ekonomi");
    if (outcome === "connected") return bankTab(request, "kopplad");
    if (outcome === "cancelled") return bankTab(request, "avbrutet");
    return bankTab(request, "fel");
  } catch (err) {
    console.error("[bank] callback misslyckades:", err instanceof Error ? err.message : err);
    return bankTab(request, "fel", userFacingBankError(err));
  }
}
