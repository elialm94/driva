/**
 * Bankkonton, bankkoppling, banktransaktioner och lärda motpartsregler.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

import type { ID } from "./common";

/* ---------------------------------- Bank ------------------------------------- */

export interface BankAccount {
  id: ID;
  provider: "mock" | "tink";
  name: string;
  accountNumber: string;
  balance: number;
  connectedAt: string;
  /** Leverantörens konto-id (Tink account id). Gör återimport av konton idempotent. */
  externalId?: string;
}

/**
 * Bankkopplingens livscykel (en koppling per företag):
 *   disconnected → pending (användaren är hos banken via Tink Link)
 *   → connected (credentials finns, transaktioner hämtas)
 *   → revoked (Koppla från: Tink-åtkomsten återkallad; historiken kvar)
 *   error = banken/Tink sa nej eller fel vid hämtning – användaren kan försöka igen.
 */
export type BankConnectionStatus = "disconnected" | "pending" | "connected" | "error" | "revoked";

/**
 * Bankkopplingen (Open Banking AIS via Tink, eller mock i demo).
 *
 * Tokens och Tink-id:n är SERVER-ONLY: raden nås bara av serverrollen (ingen
 * RLS-policy för authenticated) och UI:t läser en projektion (bankConnectionView)
 * som aldrig innehåller hemligheter.
 */
export interface BankConnection {
  id: ID;
  provider: "mock" | "tink";
  status: BankConnectionStatus;
  /** Tink permanent user: external_user_id = företagets id. */
  externalUserId?: string;
  tinkUserId?: string;
  /** Tink credentials-id (bankmedgivandet). Töms vid Koppla från. */
  credentialsId?: string;
  /** Cachad användartoken (server-only). Nya hämtas via authorization-grant när den gått ut. */
  accessToken?: string;
  accessTokenExpiresAt?: string;
  /** CSRF-state för pågående Tink Link-flöde (server-only). */
  pendingState?: string;
  pendingStateExpiresAt?: string;
  bankName?: string;
  /** Maskerat kontonummer för visning, t.ex. "···· 4512". */
  maskedAccount?: string;
  lastSyncAt?: string;
  /** Senaste användarvänliga felet (svenska, aldrig rå Tink-JSON). */
  lastError?: string;
  connectedAt?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Banktransaktionens livscykel: ny → bokford (matchad + verifikation) eller
 * behover_atgard (ingen säker matchning – väntar på människa). Matchnings-
 * förslag härleds vid läsning (services/payment-matching.ts) och lagras inte.
 */
export type TxStatus = "ny" | "bokford" | "behover_atgard";

export interface BankTransaction {
  id: ID;
  accountId: ID;
  /**
   * Leverantörens transaktions-id. Gör återimport idempotent: samma id kan
   * aldrig skapa en dubblett (unikt index i DB + domänvakt vid import).
   */
  externalId?: string;
  date: string;
  /** Positivt = inbetalning, negativt = utbetalning. Hela kronor (öre avrundas vid importgränsen – se README-ADR). */
  amount: number;
  counterpart: string;
  description: string;
  reference?: string;
  status: TxStatus;
  matchedType?: "faktura" | "utgift" | "leverantorsfaktura" | "skatt" | "skattereduktion" | "aterbetalning" | "ovrigt";
  matchedId?: ID;
  verificationId?: ID;
}

/** Lärd kategoriregel per leverantör (normaliserat namn som nyckel). */
export interface MerchantCategoryRule {
  /** Kategori-nyckel ur EXPENSE_CATEGORIES. */
  category: string;
  /** Antal gånger användaren bekräftat/valt kategorin för leverantören. */
  count: number;
  lastUsedAt: string;
  /** Räknas upp varje gång valet för leverantören byts – loggade beslut pekar på versionen. */
  version?: number;
}

/** Lärd regel för vad en banktransaktion från en motpart är (nyckel ur banking/bank-kinds.ts). */
export interface BankCounterpartRule {
  /** Typ ur BANK_KINDS, t.ex. "bankavgift" eller "redan_bokford". */
  kind: string;
  /** Antal gånger användaren bokfört motparten som typen. */
  count: number;
  lastUsedAt: string;
  /** Motpartsnamnet som det såg ut senast – för inställningar och förklaringar. */
  counterpart: string;
  /** Räknas upp varje gång typen för motparten byts – loggade beslut pekar på versionen. */
  version?: number;
}
