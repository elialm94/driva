import type { Metadata } from "next";
import Link from "next/link";
import { SupportMatrixLegend, SupportMatrixView } from "@/components/support-matrix-view";
import { SUPPORT_MATRIX_VERSION } from "@/lib/support/matrix";

export const metadata: Metadata = {
  title: "Vad Ferva stödjer",
  description: "Supportmatrisen: vilka bolag, fall och regler Ferva hanterar, vilka som kräver konsult och vilka som inte stöds ännu.",
};

/**
 * Publik hjälpsida (Hjälp → Vad Ferva stödjer). Villkoren hänvisar hit.
 * Samma matris som onboardingen, konsultvyn och servern använder.
 */
export default function OmfattningPage() {
  return (
    <article data-support-matrix-page>
      <h1 className="text-3xl font-semibold tracking-tight">Vad Ferva stödjer</h1>
      <p className="mt-2 text-sm text-muted">Supportmatris version {SUPPORT_MATRIX_VERSION}.</p>
      <p className="mt-4 leading-relaxed text-soft">
        Ferva är byggt för svenska aktiebolag inom hantverk och service som redovisar enligt K2, fakturerar i Sverige i
        kronor och betalar fast månadslön. Listan nedan är den enda sanningen om vad tjänsten hanterar: onboardingen
        frågar efter den, servern stoppar det som inte stöds även om något kringgås i appen, och din redovisningskonsult
        kan godkänna konsultfallen i sin vy.
      </p>
      <div className="mt-5">
        <SupportMatrixLegend />
      </div>
      <div className="mt-8">
        <SupportMatrixView />
      </div>
      <p className="mt-8 rounded-xl border border-line bg-card px-4 py-3 text-sm leading-relaxed text-soft">
        Inga regler läggs till utan primärkälla, giltighetsdatum, ägare och testmatris. Saknar du ett fall är det inte
        bortglömt – det är inte verifierat. Hör av dig via Hjälp &amp; support i appen.
      </p>
      <nav className="mt-12 flex flex-wrap gap-4 border-t border-line pt-6 text-sm text-muted" aria-label="Juridiska dokument">
        <Link href="/villkor" className="hover:text-ink">
          Allmänna villkor
        </Link>
        <Link href="/integritet" className="hover:text-ink">
          Integritetspolicy
        </Link>
      </nav>
    </article>
  );
}
