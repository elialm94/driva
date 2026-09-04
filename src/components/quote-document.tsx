import type { CompanySettings, Customer, Quote, QuoteAcceptance, QuoteVersion } from "@/lib/types";
import { docTotals, lineTotal, vatBreakdown } from "@/lib/calc";
import { kr, datumTid, datumNumeriskt } from "@/lib/format";
import { taxReductionDeductionLabel, getTaxReductionTerms } from "@/lib/tax-reduction-terms";
import { TaxReductionQuoteClause, TaxReductionCalcHint } from "./tax-reduction-terms";
import { lineKindLabel } from "@/lib/economic-line-type";
import { CompanyLogo } from "./company-logo";
import { resolveQuoteCompany, resolveQuoteCustomer } from "@/lib/invoices/snapshot";
import { quoteDescriptionDoc } from "@/lib/quote-description";
import { RichTextView } from "./rich-text";

export function DocCompanyHeader({ company, docType, docNumber }: { company: CompanySettings; docType: string; docNumber: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-3">
        <CompanyLogo company={company} size="md" />
        <div>
          <p className="text-[15px] font-semibold leading-tight text-ink">{company.name}</p>
          <p className="text-[13px] text-muted">
            {company.address}, {company.postalCode} {company.city}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">{docType}</p>
        <p className="text-[19px] font-semibold tracking-tight text-ink">{docNumber}</p>
      </div>
    </div>
  );
}

function paymentBits(company: CompanySettings): string[] {
  const bits: string[] = [];
  if (company.bankgiro) bits.push(`Bankgiro ${company.bankgiro}`);
  if (company.plusgiro) bits.push(`PlusGiro ${company.plusgiro}`);
  if (company.bankAccount) bits.push(`Bankkonto ${company.bankAccount}`);
  if (company.iban) bits.push(`IBAN ${company.iban}`);
  if (company.bic) bits.push(`BIC ${company.bic}`);
  return bits;
}

export function DocFooter({ company }: { company: CompanySettings }) {
  const sate = company.sate?.trim() || company.city;
  const pay = paymentBits(company).join(" · ");
  return (
    <div className="mt-10 border-t border-line pt-4 text-center text-[12px] leading-relaxed text-muted">
      {company.name} · Org.nr {company.orgNumber} · Momsreg.nr {company.vatNumber}
      {sate ? ` · Säte ${sate}` : ""}
      <br />
      {pay ? `${pay} · ` : ""}
      {company.email} · {company.phone} · Godkänd för F-skatt
    </div>
  );
}

/**
 * Offertens företagsuppgifter – läsbar A4-nederdel i stället för en enradig
 * mikrofooter: adress, kontakt, org-/momsnummer, F-skatt och betalningsvägar.
 * Fakturan har egen kompakt sidfot i invoice-document.tsx.
 */
function QuoteCompanyFooter({ company }: { company: CompanySettings }) {
  const sate = company.sate?.trim() || company.city;
  const pay = paymentBits(company);
  // Utan protokoll/slash – "sodermalmssnickeri.se" radbryts inte mitt i på A4.
  const website = company.websiteUrl?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <div className="mt-10 border-t border-line pt-5 text-[12px] leading-relaxed text-muted">
      {/* Naturlig blockbredd + radbryt mellan block – e-post/webb bryts inte mitt i ordet. */}
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        <div>
          <p className="font-semibold text-soft">{company.name}</p>
          {company.address ? <p>{company.address}</p> : null}
          {company.postalCode || company.city ? (
            <p>{[company.postalCode, company.city].filter(Boolean).join(" ")}</p>
          ) : null}
          {sate ? <p>Säte: {sate}</p> : null}
        </div>
        <div>
          {company.phone ? <p>{company.phone}</p> : null}
          {company.email ? <p>{company.email}</p> : null}
          {website ? <p>{website}</p> : null}
        </div>
        <div>
          <p>Org.nr {company.orgNumber}</p>
          {company.vatNumber ? <p>Momsreg.nr {company.vatNumber}</p> : null}
          <p>Godkänd för F-skatt</p>
        </div>
        {pay.length > 0 ? (
          <div>
            {pay.map((bit) => (
              <p key={bit}>{bit}</p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Radtypen (Arbete/Material/Restid/Övrigt) visas diskret under beskrivningen –
 * men bara när den tillför något. "Arbete / Arbete" säger ingenting två gånger.
 */
function lineKindSublabel(line: QuoteVersion["lines"][number]): string | null {
  const label = lineKindLabel(line.kind);
  if (label.trim().toLowerCase() === line.description.trim().toLowerCase()) return null;
  return label;
}

export function DocLinesTable({
  lines,
}: {
  lines: QuoteVersion["lines"];
}) {
  return (
    // Smal skärm: Antal/À-pris flyttar in som underrad så tabellen aldrig kläms.
    <table className="w-full text-left text-[14px]">
      <thead>
        <tr className="border-b border-line text-[12px] font-semibold uppercase tracking-wide text-muted">
          <th className="pb-2 pr-3 font-semibold">Beskrivning</th>
          <th className="hidden pb-2 pr-3 text-right font-semibold sm:table-cell">Antal</th>
          <th className="hidden pb-2 pr-3 text-right font-semibold sm:table-cell">À-pris</th>
          <th className="pb-2 text-right font-semibold">Summa</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          const sublabel = lineKindSublabel(line);
          const qtyBit = (
            <span className="sm:hidden">
              {sublabel ? " · " : ""}
              {line.qty} {line.unit} × {kr(line.unitPrice)}
            </span>
          );
          return (
            <tr key={line.id} className="border-b border-line/60 last:border-0">
              <td className="py-3 pr-3">
                <p className="font-medium text-ink">{line.description}</p>
                {sublabel ? (
                  <p className="text-[12px] text-muted">
                    {sublabel}
                    {qtyBit}
                  </p>
                ) : (
                  <p className="text-[12px] text-muted sm:hidden">{qtyBit}</p>
                )}
              </td>
              <td className="hidden py-3 pr-3 text-right text-soft tabular whitespace-nowrap sm:table-cell">
                {line.qty} {line.unit}
              </td>
              <td className="hidden py-3 pr-3 text-right text-soft tabular whitespace-nowrap sm:table-cell">{kr(line.unitPrice)}</td>
              <td className="py-3 text-right font-medium text-ink tabular whitespace-nowrap">{kr(lineTotal(line))}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function DocTotalsBlock({
  lines,
  rot,
  toPayLabel = "Att betala",
}: {
  lines: QuoteVersion["lines"];
  rot: QuoteVersion["rot"];
  toPayLabel?: string;
}) {
  const t = docTotals(lines, rot);
  const vat = vatBreakdown(lines);
  return (
    <div className="ml-auto w-full max-w-[280px] space-y-1.5 text-[14px]">
      <div className="flex justify-between text-soft">
        <span>Summa exkl. moms</span>
        <span className="tabular">{kr(t.subtotal)}</span>
      </div>
      {vat.map((v) => (
        <div key={v.rate} className="flex justify-between text-soft">
          <span>Moms {v.rate} %</span>
          <span className="tabular">{kr(v.vat)}</span>
        </div>
      ))}
      {vat.length > 1 ? (
        <div className="flex justify-between text-soft">
          <span>Moms totalt</span>
          <span className="tabular">{kr(t.vat)}</span>
        </div>
      ) : null}
      <div className="flex justify-between font-medium text-ink">
        <span>Totalt inkl. moms</span>
        <span className="tabular">{kr(t.total)}</span>
      </div>
      {rot ? (
        <>
          <div className="flex justify-between text-soft">
            <span>Arbetskostnad inkl. moms</span>
            <span className="tabular">{kr(t.laborInclVat)}</span>
          </div>
          <div className="flex justify-between text-accent-deep">
            <span>{taxReductionDeductionLabel(rot.type)}</span>
            <span className="tabular">−{kr(t.deduction)}</span>
          </div>
        </>
      ) : null}
      <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2.5">
        <span className="text-[15px] font-semibold text-ink">{toPayLabel}</span>
        <span className="text-[20px] font-semibold tracking-tight text-ink tabular">{kr(t.toPay)}</span>
      </div>
      {rot && rot.appliedTaxReduction != null && rot.appliedTaxReduction !== t.calculatedEligibleTaxReduction ? null : rot ? (
        <TaxReductionCalcHint type={rot.type} laborInclVat={t.laborInclVat} />
      ) : null}
    </div>
  );
}

/** Metadata-post – renderas aldrig med tom etikett. */
function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[12px] text-muted">{label}</p>
      <p className="text-[13px] font-medium text-ink">{value}</p>
    </div>
  );
}

/**
 * Offertdokumentet exakt som kunden ser det.
 * Används på offertdetaljen, den publika offertsidan och i PDF-/utskriftsvyn.
 *
 * Ordning: företag/identitet → kund + adress → metadata → rubrik →
 * beskrivning → prisrader → summering → ROT/RUT → betalningsplan → villkor →
 * ev. godkänd-stämpel → företagsuppgifter.
 *
 * Dokumentkortet är den kommersiella offerten – ingen CTA. Godkännandet bor
 * under kortet på /offert/[token]. `acceptance` ger en tyst rad
 * "Godkänd {datum} av {namn}" i webbvy, ägarvy och PDF – ingen grön ruta.
 */
export function QuoteDocument({
  company,
  customer,
  quote,
  version,
  acceptance,
}: {
  company: CompanySettings;
  customer: Customer;
  quote: Quote;
  version: QuoteVersion;
  acceptance?: QuoteAcceptance;
}) {
  const seller = resolveQuoteCompany(version, company);
  // Skickad/godkänd offert visar kundens uppgifter som de var då – inte livedata.
  const buyer = resolveQuoteCustomer(version, customer);
  const t = docTotals(version.lines, version.rot);
  // Kanonisk beskrivning – slår ihop ev. legacy-"Beskrivning av arbetet" på
  // äldre låsta versioner med rik texten. En yta, samma innehåll överallt.
  const description = quoteDescriptionDoc(version);
  const buyerCityLine = [buyer.postalCode, buyer.city].filter(Boolean).join(" ");

  return (
    <div className="bg-white px-7 py-8 text-ink sm:px-10 sm:py-10">
      <DocCompanyHeader company={seller} docType="Offert" docNumber={`#${quote.number}`} />

      {/* Kund + offertmetadata: ett adresserat affärsdokument, inga tomma etiketter. */}
      <div className="mt-8 flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
        <div className="min-w-[180px] text-[13px]">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Till</p>
          <p className="mt-1 text-[14px] font-medium text-ink">{buyer.name}</p>
          {buyer.kind === "foretag" && buyer.contactPerson ? (
            <p className="text-soft">Att: {buyer.contactPerson}</p>
          ) : null}
          {buyer.address ? <p className="text-soft">{buyer.address}</p> : null}
          {buyerCityLine ? <p className="text-soft">{buyerCityLine}</p> : null}
          {buyer.orgNumber ? <p className="mt-0.5 text-muted">Org.nr {buyer.orgNumber}</p> : null}
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-right max-sm:text-left">
          <MetaItem label="Offertdatum" value={datumNumeriskt(version.createdAt)} />
          <MetaItem label="Giltig till" value={datumNumeriskt(version.validUntil)} />
          <MetaItem label="Betalningsvillkor" value={`${version.paymentTermsDays} dagar`} />
          {version.version > 1 ? <MetaItem label="Version" value={String(version.version)} /> : null}
        </div>
      </div>

      <h1 className="mt-9 text-[24px] font-semibold tracking-tight">{version.title}</h1>

      <div className="mt-4">
        <RichTextView doc={description} className="mb-7 max-w-2xl" />
        <DocLinesTable lines={version.lines} />
      </div>

      <div className="mt-5">
        {/* "Offertvärde", inte "Att betala": inget betalas när offerten signeras. */}
        <DocTotalsBlock lines={version.lines} rot={version.rot} toPayLabel="Offertvärde" />
      </div>

      {version.paymentPlan.length > 0 ? (
        <div className="mt-8">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Betalningsplan</p>
          <div className="mt-2 space-y-1">
            {version.paymentPlan.map((p, i) => (
              <div key={i} className="flex items-baseline justify-between gap-4 text-[13.5px]">
                <span className="text-soft">
                  {p.label} ({p.percent} %)
                </span>
                <span className="font-medium tabular">{kr(Math.round((t.toPay * p.percent) / 100))}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Betalningsvillkor: {version.paymentTermsDays} dagar per faktura.
            {version.lateInterestRate ? ` Dröjsmålsränta: ${version.lateInterestRate} % per år vid försenad betalning.` : ""}
          </p>
        </div>
      ) : null}

      {/* En villkorssektion: företagets villkor + ev. ROT/RUT som underrubrik. */}
      <div className="mt-8">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Villkor</p>
        <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-soft">{version.terms}</p>
        {version.rot ? (
          <TaxReductionQuoteClause terms={version.taxReductionTerms ?? getTaxReductionTerms(version.rot.type)} />
        ) : null}
      </div>

      {acceptance ? (
        <p data-quote-acceptance-line="" className="mt-9 text-[13px] leading-relaxed text-muted">
          Godkänd {datumTid(acceptance.acceptedAt)} av {acceptance.acceptedByName}
          {acceptance.method === "bankid_mock" ? " (demo)" : ""}
        </p>
      ) : null}

      <QuoteCompanyFooter company={seller} />
    </div>
  );
}
