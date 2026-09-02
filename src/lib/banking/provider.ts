/**
 * BankProvider – gränssnittet mot en Open Banking-leverantör (AIS: konto-
 * information). Implementationer:
 *
 *   * LiveTinkProvider (providers/tink.ts) – riktig Tink-sandbox/produktion.
 *     Väljs ENBART när alla TINK_* finns OCH requesten inte är demo.
 *   * MockBankProvider (providers/mock.ts) – /demo, is_demo, JSON-läget.
 *     Noll HTTP mot tink.com; syntetiska transaktioner går genom samma
 *     registerBankTransactions/matchning som riktiga.
 *   * UnconfiguredBankProvider (providers/unconfigured.ts) – riktigt företag
 *     utan miljö: ärligt "Bankkoppling är inte konfigurerad", aldrig låtsas.
 *
 * Inga betalningar (PIS/VRP) – Driva kan inte föra över pengar.
 */
import { createHash, randomBytes } from "node:crypto";

export type StartConnectResult =
  /** Helsidesredirect till Tink Link (window.location – aldrig iframe). */
  | { kind: "redirect"; url: string }
  /** Mock: kopplad direkt, inget att hoppa till. */
  | { kind: "connected" };

/** Query-parametrar Tink Link skickar tillbaka till TINK_REDIRECT_URI. */
export interface BankCallbackInput {
  credentialsId?: string | null;
  state?: string | null;
  error?: string | null;
  errorReason?: string | null;
  message?: string | null;
}

export type BankCallbackOutcome = "connected" | "cancelled" | "error";

export interface ProviderAccount {
  externalId: string;
  name: string;
  /** Maskerat kontonummer för visning. */
  maskedNumber: string;
  /** Hela kronor (ADR-1). */
  balance: number;
  type?: string;
  financialInstitutionId?: string;
}

export interface ProviderTransaction {
  externalId: string;
  /** Leverantörens konto-id (ProviderAccount.externalId). */
  accountExternalId: string;
  /** ISO-datum/tid. */
  date: string;
  /** Hela kronor: positivt = in, negativt = ut. */
  amount: number;
  counterpart: string;
  description: string;
  reference?: string;
}

export interface BankProvider {
  readonly name: "mock" | "tink";
  /** Påbörja kopplingen: skapa/uppdatera användare + Link-URL, sätt status pending. */
  startConnect(): Promise<StartConnectResult>;
  /** Callback från Tink Link: validera state, hämta konton + transaktioner. */
  handleCallback(input: BankCallbackInput): Promise<BankCallbackOutcome>;
  /** Hämta nya transaktioner (Uppdatera). */
  refresh(): Promise<{ imported: number; skipped: number }>;
  listAccounts(): Promise<ProviderAccount[]>;
  listTransactions(input: { accountExternalIds: string[]; since?: string }): Promise<ProviderTransaction[]>;
  /** Koppla från: återkalla åtkomsten hos leverantören. Historik och verifikationer stannar. */
  disconnect(): Promise<void>;
}

/* ------------------------------- CSRF-state -------------------------------- */

export const BANK_STATE_TTL_MS = 15 * 60_000;

/** Kort fingeravtryck av företaget – binder state till rätt tenant utan att läcka id:t. */
export function businessFingerprint(businessId: string): string {
  return createHash("sha256").update(businessId).digest("hex").slice(0, 12);
}

/** Nytt state: slumpad nonce + företagsfingeravtryck. Inget känsligt i värdet. */
export function newConnectState(businessId: string): string {
  return `${randomBytes(16).toString("hex")}.${businessFingerprint(businessId)}`;
}

/**
 * Validera state från callbacken mot det vi sparade när flödet startade.
 * Kräver: identiskt värde, inte utgånget, och rätt företag.
 */
export function isValidConnectState(input: {
  received: string | null | undefined;
  stored: string | null | undefined;
  storedExpiresAt: string | null | undefined;
  businessId: string;
  now?: Date;
}): boolean {
  const received = input.received?.trim();
  const stored = input.stored?.trim();
  if (!received || !stored || received.length > 200) return false;
  if (received !== stored) return false;
  if (!input.storedExpiresAt) return false;
  const expires = new Date(input.storedExpiresAt).getTime();
  if (!Number.isFinite(expires) || (input.now ?? new Date()).getTime() > expires) return false;
  const fingerprint = received.split(".")[1];
  return fingerprint === businessFingerprint(input.businessId);
}
