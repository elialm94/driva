import type { Supplier } from "@/lib/types";
import { Card } from "./ui";

/**
 * Leverantörsregistret (importerat under Kom igång eller tillagt manuellt).
 * Visas under Ekonomi → Utgifter när det finns poster. Betalningsuppgifter
 * här är förslag – en leverantörsfaktura blir aldrig betalbar utan att
 * uppgifterna verifieras i inboxens flöde.
 */
export function SupplierRegister({ suppliers }: { suppliers: Supplier[] }) {
  if (suppliers.length === 0) return null;
  const sorted = suppliers.slice().sort((a, b) => a.name.localeCompare(b.name, "sv"));
  return (
    <Card className="mt-6 overflow-hidden" data-supplier-register>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Leverantörer</p>
        <p className="text-[13px] text-muted">
          {sorted.length} {sorted.length === 1 ? "leverantör" : "leverantörer"} · kontakt- och betalningsuppgifter som förslag vid nya fakturor
        </p>
      </div>
      <ul className="mt-3 divide-y divide-line/70 border-t border-line/70">
        {sorted.map((s) => {
          const payment = s.bankgiro ? `Bankgiro ${s.bankgiro}` : s.plusgiro ? `Plusgiro ${s.plusgiro}` : s.bankAccount ? `Bankkonto ${s.bankAccount}` : s.iban ? `IBAN ${s.iban}` : null;
          return (
            <li key={s.id} className="grid gap-1 px-5 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0">
                <p className="truncate text-[14.5px] font-medium text-ink">{s.name}</p>
                <p className="truncate text-[13px] text-soft">
                  {[s.orgNumber, s.email, s.phone].filter(Boolean).join(" · ") || "Inga kontaktuppgifter"}
                </p>
              </div>
              <p className="text-[13px] text-muted tabular">{payment ?? "Inga betalningsuppgifter"}</p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
