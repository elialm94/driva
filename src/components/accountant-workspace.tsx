import { datumKort, kr } from "@/lib/format";

/** Statusraden under klientens namn på konsultytan. */
export function accountantStatusText(input: {
  bookedThrough?: string;
  bankOk: boolean;
  bankUnexplained?: number;
  nextVatDue?: string;
}): string {
  const parts: string[] = [];
  parts.push(
    input.bookedThrough ? `Bokföring uppdaterad t.o.m. ${datumKort(input.bookedThrough)}` : "Bokföring öppen"
  );
  if (input.bankOk) parts.push("Bank avstämd ✓");
  else if (input.bankUnexplained && Math.abs(input.bankUnexplained) >= 1) {
    parts.push(`Bank differens ${kr(Math.abs(input.bankUnexplained))}`);
  } else {
    parts.push("Bank ej avstämd");
  }
  if (input.nextVatDue) parts.push(`Nästa moms ${datumKort(input.nextVatDue)}`);
  return parts.join(" · ");
}
