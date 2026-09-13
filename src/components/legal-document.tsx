import Link from "next/link";
import type { LegalDocumentMeta, LegalSection } from "@/lib/legal/documents";
import { LEGAL_DRAFT_NOTICE, formatSwedishDate } from "@/lib/legal/documents";
import type { LegalEntityStatus } from "@/lib/legal/entity";

/**
 * Gemensam rendering av Fervas juridiska dokument: rubrik, version och
 * giltighet, utkastmarkering, öppen varning när avtalsparten inte är
 * konfigurerad – och avsnitten. Ingen text hittas på här.
 */
export function LegalDocument({
  meta,
  sections,
  entity,
  intro,
}: {
  meta: LegalDocumentMeta;
  sections: LegalSection[];
  entity: LegalEntityStatus;
  intro?: React.ReactNode;
}) {
  return (
    <article data-legal-document={meta.id} data-legal-version={meta.version}>
      <h1 className="text-3xl font-semibold tracking-tight">{meta.title}</h1>
      <p className="mt-2 text-sm text-muted">
        Version {meta.version} · gäller från {formatSwedishDate(meta.effectiveFrom)}.
      </p>
      <p className="mt-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink" data-legal-draft>
        {LEGAL_DRAFT_NOTICE}
      </p>
      {!entity.complete ? (
        <p className="mt-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-ink" data-legal-entity-missing>
          Avtalspartens uppgifter är inte konfigurerade i den här miljön ({entity.missing.join(", ")}). Texten visar
          därför &quot;{"[avtalspart ej konfigurerad – uppgift saknas]"}&quot; i stället för ett bolagsnamn. Inget
          bolagsnamn hittas på.
        </p>
      ) : null}
      {intro ? <div className="mt-6">{intro}</div> : null}
      <div className="mt-8 space-y-8">
        {sections.map((s) => (
          <section key={s.title}>
            <h2 className="text-lg font-semibold">{s.title}</h2>
            {s.body.map((p, i) => (
              <p key={i} className="mt-2 leading-relaxed text-soft">
                {p}
              </p>
            ))}
            {s.bullets && s.bullets.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 leading-relaxed text-soft">
                {s.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
      <nav className="mt-12 flex flex-wrap gap-4 border-t border-line pt-6 text-sm text-muted" aria-label="Juridiska dokument">
        <Link href="/villkor" className="hover:text-ink">
          Allmänna villkor
        </Link>
        <Link href="/integritet" className="hover:text-ink">
          Integritetspolicy
        </Link>
        <Link href="/bitradesavtal" className="hover:text-ink">
          Personuppgiftsbiträdesavtal
        </Link>
        <Link href="/underbitraden" className="hover:text-ink">
          Underbiträden
        </Link>
      </nav>
    </article>
  );
}
