/**
 * Klientsäker overflow-lista för verifikationsrader.
 * Inga store/fs-imports – UI får bara läsa flow-kind.
 */

export type VerificationOverflowItem =
  | { kind: "visa_detaljer" }
  | { kind: "ratta_bokforing" }
  | { kind: "fakturan_ar_fel"; invoiceId: string };

export function verificationOverflowItems(
  flow: { kind: string; invoiceId?: string },
  opts: { allowCorrection?: boolean } = {}
): VerificationOverflowItem[] {
  const items: VerificationOverflowItem[] = [{ kind: "visa_detaljer" }];
  if (opts.allowCorrection === false) return items;
  if (flow.kind === "kreditfaktura" && flow.invoiceId) {
    items.push({ kind: "fakturan_ar_fel", invoiceId: flow.invoiceId });
    return items;
  }
  if (flow.kind === "konto" || flow.kind === "avancerad" || flow.kind === "omatcha" || flow.kind === "moms") {
    items.push({ kind: "ratta_bokforing" });
  }
  return items;
}
