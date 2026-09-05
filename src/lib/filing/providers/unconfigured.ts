/**
 * UnconfiguredFilingProvider – riktigt företag utan avtal om maskinell
 * inlämning. Varje väg ut kastar FilingNotConfiguredError.
 *
 * Att svara ärligt är hela poängen: filerna som Driva bygger är kompletta och
 * går att lämna in i Skatteverkets och Bolagsverkets e-tjänster på egen hand.
 * Det som saknas är avtalet för att skicka dem maskinellt, och då ska
 * användaren få veta just det – inte en kvittens som inte betyder något.
 */
import type { FilingKind } from "../../types";
import { FilingNotConfiguredError } from "../errors";
import type { FilingProvider, FilingReceiptOutcome, FilingSubmitOutcome } from "../provider";

export class UnconfiguredFilingProvider implements FilingProvider {
  readonly name = "live" as const;

  supports(_kind: FilingKind): boolean {
    return false;
  }

  async submit(): Promise<FilingSubmitOutcome> {
    throw new FilingNotConfiguredError();
  }

  async fetchReceipt(): Promise<FilingReceiptOutcome> {
    throw new FilingNotConfiguredError();
  }
}
