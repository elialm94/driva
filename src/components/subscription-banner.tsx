import Link from "next/link";
import type { BillingAccess } from "@/lib/billing/state";

/**
 * Bannern visas bara när något faktiskt behöver göras: företaget är
 * skrivskyddat eller en betalning har misslyckats. Under provperioden visas
 * ingenting här – dagarna kvar står diskret under Inställningar → Konto.
 */
export function SubscriptionBanner({ access }: { access: BillingAccess }) {
  if (access.mode !== "read_only" && access.reason !== "grace") return null;
  const readOnly = access.mode === "read_only";
  return (
    <div
      className={
        readOnly
          ? "flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line bg-canvas px-4 py-2 text-[13px] text-ink"
          : "flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-500/40 bg-amber-50 px-4 py-2 text-[13px] text-neutral-900"
      }
      data-subscription-banner={access.reason}
      role="status"
    >
      <span className="font-semibold">{readOnly ? "Skrivskyddat" : "Betalning väntar"}</span>
      <span>
        {readOnly
          ? "Provperioden eller abonnemanget har tagit slut. Allt går att läsa och exportera; för att ändra behöver företaget ett abonnemang."
          : "Den senaste betalningen gick inte igenom. Uppdatera kortet så att inget avbryts."}
      </span>
      <Link href="/installningar?flik=konto" className="font-semibold underline underline-offset-2">
        {readOnly ? "Teckna abonnemang" : "Hantera betalning"}
      </Link>
    </div>
  );
}
