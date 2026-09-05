/**
 * MockFilingProvider – demo-myndigheten. Används för /demo, is_demo-företaget
 * och JSON-läget. Gör NOLL HTTP-anrop.
 *
 * Mocken tar emot filen och ger den ett id, precis som en riktig tjänst, och
 * kvittensen hämtas i ett andra steg – hela statusmaskinen går alltså att köra
 * i demo. Men den ljuger inte om vad den är: kvittensnumret börjar på DEMO- och
 * kvittensens meddelande säger rakt ut att ingenting har lämnats in.
 */
import type { FilingKind } from "../../types";
import type {
  FilingProvider,
  FilingReceiptOutcome,
  FilingSubmitInput,
  FilingSubmitOutcome,
} from "../provider";

export const DEMO_RECEIPT_NOTE = "Demokvittens – ingenting har lämnats in till myndigheten.";

/** Kvittensnummer ur inlämningens id, så att samma inlämning alltid ger samma nummer. */
function demoReceiptId(providerSubmissionId: string): string {
  return `DEMO-${providerSubmissionId.replace(/[^0-9a-z]/gi, "").slice(-10).toUpperCase()}`;
}

export class MockFilingProvider implements FilingProvider {
  readonly name = "mock" as const;

  supports(_kind: FilingKind): boolean {
    return true;
  }

  async submit(input: FilingSubmitInput): Promise<FilingSubmitOutcome> {
    // En tom fil är ett fel även i demo: mocken ska inte vara mer förlåtande än
    // myndigheten, annars döljer demon en bugg i filgenereringen.
    if (input.files.length === 0 || input.files.every((f) => f.bytes.length === 0)) {
      return { kind: "rejected", reason: "Filen är tom." };
    }
    return { kind: "accepted", providerSubmissionId: `mock-${input.idempotencyKey}` };
  }

  async fetchReceipt(providerSubmissionId: string): Promise<FilingReceiptOutcome> {
    return {
      kind: "receipt",
      receipt: {
        receiptId: demoReceiptId(providerSubmissionId),
        receivedAt: new Date().toISOString(),
        message: DEMO_RECEIPT_NOTE,
      },
    };
  }
}
