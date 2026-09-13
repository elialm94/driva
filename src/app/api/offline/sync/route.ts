import { NextResponse } from "next/server";
import { getSessionUser, isDemoSession, withBusiness } from "@/lib/auth/session";
import { requireActor } from "@/lib/collaboration/actor";
import { CollaborationDeniedError } from "@/lib/collaboration/permissions";
import { SubscriptionReadOnlyError } from "@/lib/billing/errors";
import { isSupabaseMode } from "@/lib/storage/config";
import { applyOfflineBatch, MAX_BATCH } from "@/lib/offline/server";
import type { SyncErrorResponse, SyncResponse } from "@/lib/offline/types";

/**
 * Offline-fältlägets synk (spec §9): POST med en omgång köade ärenden.
 *
 * Auth/tenant/capability är EXAKT samma som appens formulär – withBusiness
 * (write) med aktörens roll, abonnemangets skrivskydd och villkorsgrinden.
 * Idempotens per (företag, nyckel) sköts av applyOfflineBatch. Klienten får
 * per ärende: synced | conflict | failed | rejected – aldrig ett halvt svar.
 *
 * Statuskoder klienten agerar på:
 *   401 signed_out  → rensa lokalt offlineinnehåll (sessionen är borta)
 *   403 forbidden   → rensa (ingen åtkomst till företaget / konto inaktiverat)
 *   423 read_only   → behåll kön, visa varför (abonnemang, villkor)
 *   400 bad_request → programmeringsfel i klienten; kön behålls
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 12_000_000;

function err(code: SyncErrorResponse["code"], message: string, status: number) {
  return NextResponse.json<SyncErrorResponse>({ ok: false, code, message }, { status });
}

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return err("bad_request", "Omgången är för stor. Synka färre ärenden åt gången.", 413);

  if (isSupabaseMode() && !(await getSessionUser()) && !(await isDemoSession())) {
    return err("signed_out", "Du är utloggad. Logga in igen för att synka.", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err("bad_request", "Ogiltig begäran.", 400);
  }
  const mutations = (body as { mutations?: unknown } | null)?.mutations;
  if (!Array.isArray(mutations)) return err("bad_request", "Ogiltig begäran.", 400);
  if (mutations.length > MAX_BATCH) return err("bad_request", `Max ${MAX_BATCH} ärenden per omgång.`, 400);

  try {
    const results = await withBusiness(() => applyOfflineBatch(mutations, requireActor()));
    return NextResponse.json<SyncResponse>({ ok: true, results, serverTime: new Date().toISOString() });
  } catch (e) {
    if (e instanceof SubscriptionReadOnlyError) return err("read_only", e.message, 423);
    if (e instanceof CollaborationDeniedError) return err("forbidden", e.message, 403);
    const message = e instanceof Error ? e.message : "";
    if (message === "bad_request") return err("bad_request", "Ogiltig begäran.", 400);
    if (/inte åtkomst|inaktiverat|avstängt/i.test(message)) return err("forbidden", message, 403);
    if (/Villkoren har uppdaterats/.test(message)) return err("read_only", message, 423);
    // NEXT_REDIRECT från requireUser (session försvann mitt i) = utloggad.
    if (typeof (e as { digest?: unknown })?.digest === "string" && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) {
      return err("signed_out", "Du är utloggad. Logga in igen för att synka.", 401);
    }
    return err("server_error", "Kunde inte synka just nu. Ändringarna ligger kvar på enheten.", 500);
  }
}
