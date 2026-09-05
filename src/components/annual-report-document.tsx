import type { AnnualReport, CompanySettings, ReportRow } from "@/lib/types";
import { kr, datumNumeriskt, datumLang } from "@/lib/format";

/**
 * Årsredovisningen som dokument. Samma renderare används på skärmen och i
 * A4-vyn – det som skrivs under och det som läses ska aldrig kunna gå isär.
 *
 * Uppställningarna följer K2 (BFNAR 2016:10) och ÅRL: förvaltningsberättelse
 * med flerårsöversikt och resultatdisposition, resultaträkning i kostnadsslag,
 * balansräkning, noter och underskrifter. Jämförelsetalen står i egen kolumn
 * (ÅRL 3:1) och utelämnas det första året i stället för att visas som noll.
 */
export function AnnualReportDocument({
  report,
  company,
  /** Fastställelseintyget hör till den bestyrkta kopian, inte till originalet. */
  showCertification = true,
}: {
  report: AnnualReport;
  company: CompanySettings;
  showCertification?: boolean;
}) {
  const c = report.content;
  const fb = c.forvaltningsberattelse;
  const priorLabel = fb.flerarsoversikt[1]?.label;

  return (
    <article className="px-8 py-10 text-[13px] leading-relaxed text-ink sm:px-12 sm:py-14 print:px-0 print:py-0">
      <header className="border-b border-ink/70 pb-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Årsredovisning</p>
        <h1 className="mt-1.5 text-[22px] font-semibold leading-tight">{c.companyName}</h1>
        <p className="mt-1 text-[13px] text-soft">
          Org.nr {c.orgNumber}
          {c.sate ? ` · Säte: ${c.sate}` : ""}
        </p>
        <p className="mt-2 text-[13px] text-soft">
          Räkenskapsåret {datumNumeriskt(c.periodStart)} – {datumNumeriskt(c.periodEnd)}
        </p>
      </header>

      <DocSection title="Förvaltningsberättelse">
        <SubHeading>Verksamheten</SubHeading>
        <Paragraphs text={fb.verksamhet} />

        <SubHeading>Väsentliga händelser under räkenskapsåret</SubHeading>
        <Paragraphs text={fb.vasentligaHandelser} />

        <SubHeading>Flerårsöversikt</SubHeading>
        <table className="mt-2 w-full max-w-lg text-[12.5px]">
          <thead>
            <tr className="border-b border-ink/60 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              <th className="pb-1.5 text-left font-semibold">Belopp i kr</th>
              {fb.flerarsoversikt.map((r) => (
                <th key={r.label} className="pb-1.5 pl-3 text-right font-semibold">
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <MultiYearLine label="Nettoomsättning" rows={fb.flerarsoversikt} pick={(r) => kr(r.nettoomsattning)} />
            <MultiYearLine
              label="Resultat efter finansiella poster"
              rows={fb.flerarsoversikt}
              pick={(r) => kr(r.resultatEfterFinansiella)}
            />
            <MultiYearLine
              label="Soliditet"
              rows={fb.flerarsoversikt}
              pick={(r) => `${String(r.soliditetProcent).replace(".", ",")} %`}
            />
          </tbody>
        </table>
        <p className="mt-1.5 text-[11.5px] text-muted">
          Soliditet: justerat eget kapital i procent av balansomslutningen.
        </p>

        {fb.egetKapitalForandring?.length ? (
          <>
            <SubHeading>Förändringar i eget kapital</SubHeading>
            <table className="mt-2 w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-ink/60 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  <th className="pb-1.5 text-left font-semibold" />
                  <th className="pb-1.5 pl-3 text-right font-semibold">Aktiekapital</th>
                  <th className="pb-1.5 pl-3 text-right font-semibold">Balanserat resultat</th>
                  <th className="pb-1.5 pl-3 text-right font-semibold">Årets resultat</th>
                  <th className="pb-1.5 pl-3 text-right font-semibold">Summa</th>
                </tr>
              </thead>
              <tbody>
                {fb.egetKapitalForandring.map((row) => (
                  <tr key={row.label} className="break-inside-avoid border-b border-line/70 last:border-0">
                    <td className="py-1.5">{row.label}</td>
                    <td className="py-1.5 pl-3 text-right tabular">{kr(row.aktiekapital)}</td>
                    <td className="py-1.5 pl-3 text-right tabular">{kr(row.balanseratResultat)}</td>
                    <td className="py-1.5 pl-3 text-right tabular">{kr(row.aretsResultat)}</td>
                    <td className="py-1.5 pl-3 text-right font-semibold tabular">{kr(row.summa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        <SubHeading>Resultatdisposition</SubHeading>
        <p className="mt-1.5">Till årsstämmans förfogande står följande medel:</p>
        <table className="mt-2 w-full max-w-md text-[12.5px]">
          <tbody>
            <tr className="border-b border-line/70">
              <td className="py-1.5">Till förfogande</td>
              <td className="py-1.5 pl-3 text-right font-semibold tabular">{kr(fb.resultatdisposition.tillForfogande)}</td>
            </tr>
            {fb.resultatdisposition.utdelning ? (
              <tr className="border-b border-line/70">
                <td className="py-1.5">Utdelning</td>
                <td className="py-1.5 pl-3 text-right tabular">{kr(fb.resultatdisposition.utdelning)}</td>
              </tr>
            ) : null}
            <tr>
              <td className="py-1.5">Balanseras i ny räkning</td>
              <td className="py-1.5 pl-3 text-right tabular">{kr(fb.resultatdisposition.balanserasINyRakning)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-1.5 text-[12.5px] text-soft">
          Styrelsen föreslår att medlen disponeras enligt ovan.
        </p>
      </DocSection>

      <DocSection title="Resultaträkning">
        <ReportRows rows={c.resultatrakning} yearLabel={c.fiscalLabel} priorLabel={priorLabel} />
      </DocSection>

      <DocSection title="Balansräkning">
        <SubHeading>Tillgångar</SubHeading>
        <ReportRows rows={c.balansrakningTillgangar} yearLabel={c.fiscalLabel} priorLabel={priorLabel} />
        <SubHeading>Eget kapital och skulder</SubHeading>
        <ReportRows rows={c.balansrakningEgetKapitalSkulder} yearLabel={c.fiscalLabel} priorLabel={priorLabel} />
      </DocSection>

      <DocSection title="Noter">
        <ol className="mt-1 space-y-3">
          {c.noter.map((n) => (
            <li key={n.title} className="break-inside-avoid">
              <p className="font-semibold">
                Not {n.number} – {n.title}
              </p>
              <Paragraphs text={n.body} />
            </li>
          ))}
        </ol>
      </DocSection>

      <Signatures report={report} company={company} />

      {showCertification && c.fastallelseintyg?.stammaDate ? <Certification report={report} /> : null}
    </article>
  );
}

function DocSection({ title, children }: { title: string; children: React.ReactNode }) {
  // break-inside-avoid på hela sektionen skulle tvinga fram tomma sidor för
  // långa uppställningar; det är raderna som ska hållas ihop, inte sektionen.
  return (
    <section className="mt-8">
      <h2 className="border-b border-ink/50 pb-1.5 text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-4 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-muted">{children}</h3>;
}

/** Tomma stycken hör inte i ett dokument utomstående läser. */
function Paragraphs({ text }: { text: string }) {
  const parts = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <>
      {parts.map((p, i) => (
        <p key={i} className="mt-1.5 whitespace-pre-line">
          {p}
        </p>
      ))}
    </>
  );
}

function MultiYearLine({
  label,
  rows,
  pick,
}: {
  label: string;
  rows: AnnualReport["content"]["forvaltningsberattelse"]["flerarsoversikt"];
  pick: (row: AnnualReport["content"]["forvaltningsberattelse"]["flerarsoversikt"][number]) => string;
}) {
  return (
    <tr className="break-inside-avoid border-b border-line/70 last:border-0">
      <td className="py-1.5">{label}</td>
      {rows.map((r) => (
        <td key={r.label} className="py-1.5 pl-3 text-right tabular">
          {r.ofullstandig ? <span className="text-muted">–</span> : pick(r)}
        </td>
      ))}
    </tr>
  );
}

function ReportRows({ rows, yearLabel, priorLabel }: { rows: ReportRow[]; yearLabel: string; priorLabel?: string }) {
  const showPrior = rows.some((r) => r.prior !== undefined);
  return (
    <table className="mt-2 w-full text-[12.5px]">
      <thead>
        <tr className="border-b border-ink/60 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          <th className="pb-1.5 text-left font-semibold">Belopp i kr</th>
          <th className="pb-1.5 pl-3 text-right font-semibold">{yearLabel}</th>
          {showPrior ? <th className="pb-1.5 pl-3 text-right font-semibold">{priorLabel ?? "Föregående år"}</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.label}
            className={`break-inside-avoid border-b border-line/70 last:border-0 ${r.bold ? "font-semibold" : ""}`}
          >
            <td className="py-1.5">
              {r.label}
              {r.note ? <sup className="ml-1 text-[10px] text-muted">{r.note}</sup> : null}
            </td>
            <td className="py-1.5 pl-3 text-right tabular">{kr(r.amount)}</td>
            {showPrior ? (
              <td className="py-1.5 pl-3 text-right tabular">
                {r.prior === undefined ? <span className="text-muted">–</span> : kr(r.prior)}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Underskrifterna. Ort och datum står ovanför namnen, och signaturraderna är
 * tomma linjer att skriva på – en osignerad årsredovisning ska se osignerad ut
 * på papperet, inte bara i statusfältet.
 */
function Signatures({ report, company }: { report: AnnualReport; company: CompanySettings }) {
  const signatories = report.content.underskrifter ?? [];
  if (signatories.length === 0) return null;
  const signedAt = signatories.find((s) => s.signedAt)?.signedAt;
  const place = signatories.find((s) => s.place)?.place ?? report.content.sate ?? company.sate;

  return (
    <section className="mt-10 break-inside-avoid">
      <p className="text-[12.5px] text-soft">
        {place ? `${place}, ` : ""}
        {signedAt ? datumLang(signedAt) : "den ……………………………………"}
      </p>
      <div className="mt-6 grid gap-x-10 gap-y-8 sm:grid-cols-2 print:grid-cols-2">
        {signatories.map((s) => (
          <div key={`${s.name}-${s.role}`} className="break-inside-avoid">
            <div className="h-9 border-b border-ink/70" />
            <p className="mt-1.5 text-[12.5px] font-medium">{s.name}</p>
            <p className="text-[12px] text-muted">{s.role}</p>
          </div>
        ))}
      </div>
      {report.status === "signerad" || report.status === "inlamnad_markerad" ? null : (
        <p className="mt-6 text-[11.5px] text-muted">
          Årsredovisningen är inte underskriven. Skriv under samtliga exemplar innan den fastställs av årsstämman.
        </p>
      )}
    </section>
  );
}

/**
 * Fastställelseintyget skrivs på den bestyrkta kopian av årsredovisningen och
 * är det Bolagsverket kräver för att registrera den (ÅRL 8:3).
 */
function Certification({ report }: { report: AnnualReport }) {
  const cert = report.content.fastallelseintyg;
  if (!cert?.stammaDate) return null;
  const disposition =
    cert.dispositionDecision?.trim() ||
    "Årsstämman beslutade att disponera bolagets resultat enligt styrelsens förslag i förvaltningsberättelsen.";

  return (
    <section className="mt-10 break-inside-avoid border-t border-ink/50 pt-5">
      <h2 className="text-[15px] font-semibold">Fastställelseintyg</h2>
      <p className="mt-2">
        Undertecknad intygar härmed att resultaträkningen och balansräkningen har fastställts på årsstämma den{" "}
        {datumLang(cert.stammaDate)}. {disposition}
      </p>
      <p className="mt-2">Jag intygar att denna kopia av årsredovisningen överensstämmer med originalet.</p>
      <div className="mt-6 max-w-xs">
        <div className="h-9 border-b border-ink/70" />
        <p className="mt-1.5 text-[12.5px] font-medium">{cert.certifiedByName}</p>
        <p className="text-[12px] text-muted">{cert.certifiedByRole}</p>
      </div>
    </section>
  );
}
