/**
 * FilingProvider – gränssnittet mot den tjänst som lämnar in deklarationen till
 * myndigheten. Implementationer:
 *
 *   * LiveFilingProvider (providers/live.ts) – riktig inlämningstjänst. Väljs
 *     ENBART när FILING_API_* finns OCH requesten inte är demo.
 *   * MockFilingProvider (providers/mock.ts) – /demo, is_demo, JSON-läget. Noll
 *     HTTP; kvittensen är tydligt märkt som demokvittens.
 *   * UnconfiguredFilingProvider (providers/unconfigured.ts) – riktigt företag
 *     utan avtal: ärligt "inlämning är inte påslagen", aldrig en låtsaskvittens.
 *
 * Providern skickar bara filen vidare. Den bygger inga siffror, den signerar
 * ingenting och den ändrar ingen status – statusmaskinen bor i submission.ts.
 */
import type { FilingAuthority, FilingKind, FilingReceipt, FilingSignature } from "../types";

export type FilingProviderName = "mock" | "live";

/** En fil i inlämningen, med innehållet. INK2 skickar två (BLANKETTER + INFO). */
export interface FilingPayloadFile {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface FilingSubmitInput {
  kind: FilingKind;
  authority: FilingAuthority;
  /** Perioden i klartext, för myndighetens och användarens spårbarhet. */
  label: string;
  orgNumber: string;
  files: FilingPayloadFile[];
  signature: FilingSignature;
  /**
   * Idempotensnyckel = inlämningens id. Ett nätverksfel efter att myndigheten
   * tagit emot filen får inte bli två deklarationer när användaren försöker
   * igen.
   */
  idempotencyKey: string;
}

export type FilingSubmitOutcome =
  /** Mottagen. Kvittensen kan komma direkt eller hämtas senare. */
  | { kind: "accepted"; providerSubmissionId: string; receipt?: FilingReceipt }
  /** Myndigheten sa nej. `reason` är en mening användaren får se. */
  | { kind: "rejected"; reason: string };

export type FilingReceiptOutcome =
  /** Mottagen men ännu inte behandlad – kvittensen finns inte att hämta än. */
  | { kind: "pending" }
  | { kind: "receipt"; receipt: FilingReceipt }
  | { kind: "rejected"; reason: string };

export interface FilingProvider {
  readonly name: FilingProviderName;
  /** Vilka deklarationer den här providern kan lämna in. */
  supports(kind: FilingKind): boolean;
  submit(input: FilingSubmitInput): Promise<FilingSubmitOutcome>;
  /** Hämta kvittensen för en mottagen inlämning. */
  fetchReceipt(providerSubmissionId: string): Promise<FilingReceiptOutcome>;
}
