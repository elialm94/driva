import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_DRAFT_NOTICE } from "@/lib/legal/documents";
import { legalEntityStatus, legalEntityLabel } from "@/lib/legal/entity";
import { activeProviders } from "@/lib/legal/providers";

export const metadata: Metadata = {
  title: "Underbiträden",
  description: "Leverantörer som behandlar personuppgifter för tjänsten Ferva.",
};

export const dynamic = "force-dynamic";

/**
 * Publik underbiträdeslista, härledd från leverantörsregistret. Bara
 * leverantörer som faktiskt är aktiva i miljön visas.
 */
export default function UnderbitradenPage() {
  const entity = legalEntityStatus();
  const providers = activeProviders();
  const updated = new Date().toISOString().slice(0, 10);
  return (
    <article data-legal-document="underbitraden">
      <h1 className="text-3xl font-semibold tracking-tight">Underbiträden och leverantörer</h1>
      <p className="mt-2 text-sm text-muted">Listan genereras ur Fervas leverantörsregister · kontrollerad {updated}.</p>
      <p className="mt-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink" data-legal-draft>
        {LEGAL_DRAFT_NOTICE}
      </p>
      <p className="mt-6 leading-relaxed text-soft">
        {legalEntityLabel(entity)} anlitar följande leverantörer för att driva Ferva. Listan omfattar bara leverantörer
        som är påslagna i den här miljön. Ändringar meddelas enligt punkt 5 i{" "}
        <Link href="/bitradesavtal" className="underline hover:text-ink">
          personuppgiftsbiträdesavtalet
        </Link>
        .
      </p>

      {providers.length === 0 ? (
        <p className="mt-8 text-soft">Inga externa leverantörer är aktiva i den här miljön.</p>
      ) : (
        <div className="mt-8 space-y-5">
          {providers.map((p) => (
            <section key={p.id} className="rounded-2xl border border-line bg-card p-5" data-provider={p.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold">{p.name}</h2>
                <span className="text-xs uppercase tracking-wide text-muted">{p.role}</span>
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[140px_1fr]">
                <dt className="text-muted">Ändamål</dt>
                <dd className="text-soft">{p.purpose}</dd>
                <dt className="text-muted">Uppgifter</dt>
                <dd className="text-soft">{p.dataTypes.join("; ")}</dd>
                <dt className="text-muted">Region</dt>
                <dd className="text-soft">{p.region}</dd>
                {p.transfer ? (
                  <>
                    <dt className="text-muted">Överföring</dt>
                    <dd className="text-soft">{p.transfer}</dd>
                  </>
                ) : null}
                <dt className="text-muted">Avtal</dt>
                <dd className="text-soft">
                  {p.termsUrl ? (
                    <a href={p.termsUrl} className="underline hover:text-ink" rel="noopener noreferrer" target="_blank">
                      Villkor
                    </a>
                  ) : (
                    <span data-provider-terms-missing>Avtalslänk saknas – kompletteras när avtalet är klart.</span>
                  )}
                  {p.dpaUrl ? (
                    <>
                      {" · "}
                      <a href={p.dpaUrl} className="underline hover:text-ink" rel="noopener noreferrer" target="_blank">
                        Personuppgiftsbiträdesavtal
                      </a>
                    </>
                  ) : null}
                </dd>
              </dl>
            </section>
          ))}
        </div>
      )}

      <p className="mt-8 text-sm text-muted">
        Typsnitt levereras från Fervas egna servrar (inga anrop till Google Fonts vid besök). Kortuppgifter hanteras
        enbart av Stripe och når aldrig Ferva.
      </p>
    </article>
  );
}
