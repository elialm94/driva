"use server";

import { revalidatePath } from "next/cache";
import { withBusiness } from "@/lib/auth/session";
import { selectBankProvider } from "@/lib/banking/select";
import { BankConnectionError, BankNotConfiguredError, userFacingBankError } from "@/lib/banking/errors";
import { activeBankConnection, upsertBankConnection } from "@/lib/banking/connection-state";

/**
 * Bankkoppling (Open Banking AIS via Tink, mock i demo).
 *
 * Alla anrop går via withBusiness (tenantkontext + roll). Retry vid
 * samtidighetskonflikt är AV: flödena pratar med Tink och får aldrig köras om
 * automatiskt. Fel mot användaren är alltid en svensk mening (errors.ts) –
 * aldrig rå Tink-JSON eller stackspår.
 */
const NO_RETRY = { retry: false } as const;

export type BankActionResult =
  | { ok: true; redirectTo?: string; imported?: number }
  | { ok: false; error: string };

function refresh() {
  revalidatePath("/ekonomi");
  revalidatePath("/", "layout");
}

function toError(err: unknown): { ok: false; error: string } {
  if (err instanceof BankConnectionError || err instanceof BankNotConfiguredError) {
    return { ok: false, error: err.message };
  }
  // Behörighets-/sessionfel bär redan en svensk text från withBusiness.
  const message = err instanceof Error ? err.message : "";
  if (message.startsWith("Du har inte") || message.startsWith("Den här åtgärden") || message.startsWith("Demon har")) {
    return { ok: false, error: message };
  }
  console.error("[bank] åtgärd misslyckades:", err);
  return { ok: false, error: userFacingBankError(err) };
}

/**
 * Koppla företagskonto. Live: returnerar Tink Link-URL:en som klienten
 * navigerar till med window.location (helsida – aldrig iframe). Mock: kopplar
 * direkt och returnerar Bank-fliken.
 */
export async function connectBankAction(): Promise<BankActionResult> {
  try {
    const result = await withBusiness(() => selectBankProvider().startConnect(), NO_RETRY);
    refresh();
    if (result.kind === "redirect") return { ok: true, redirectTo: result.url };
    return { ok: true, redirectTo: "/ekonomi?flik=bank&bank=kopplad" };
  } catch (err) {
    return toError(err);
  }
}

/** Uppdatera: hämta nya transaktioner från banken och kör dem genom matchningen. */
export async function refreshBankAction(): Promise<BankActionResult> {
  try {
    const result = await withBusiness(() => selectBankProvider().refresh(), NO_RETRY);
    refresh();
    return { ok: true, imported: result.imported };
  } catch (err) {
    return toError(err);
  }
}

/** Koppla från: återkalla Tink-åtkomsten. Transaktioner och verifikationer stannar. */
export async function disconnectBankAction(): Promise<BankActionResult> {
  try {
    await withBusiness(() => selectBankProvider().disconnect(), NO_RETRY);
    refresh();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

/** Avbryt ett påbörjat (pending) flöde utan att ha varit hos banken. */
export async function cancelBankConnectAction(): Promise<BankActionResult> {
  try {
    await withBusiness(() => {
      const row = activeBankConnection();
      if (!row || row.status !== "pending") return;
      upsertBankConnection({
        provider: row.provider,
        status: row.credentialsId ? "connected" : row.revokedAt ? "revoked" : "disconnected",
        pendingState: undefined,
        pendingStateExpiresAt: undefined,
      });
    }, NO_RETRY);
    refresh();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}
