import type { ReactNode } from "react";
import type { BankIDSignature, CompanySettings, Customer, Quote, QuoteVersion } from "@/lib/types";
import { docTotals, lineTotal, vatBreakdown } from "@/lib/calc";
import { kr, datumLang, datumTid, datumNumeriskt } from "@/lib/format";
import { BadgeCheck } from "lucide-react";
import {
  taxReductionCalcHintText,
  taxReductionDeductionLabel,
  getTaxReductionTerms,
} from "@/lib/tax-reduction-terms";
import { TaxReductionQuoteClause } from "./tax-reduction-terms";
import { lineKindLabel } from "@/lib/economic-line-type";
import { CompanyLogo } from "./company-logo";
import { resolveQuoteCompany } from "@/lib/invoices/snapshot";
import { RichTextView } from "./rich-text";
import { signedWithBankIdBy } from "@/lib/status-labels";
import { cx } from "./ui";

/**
 * Dokumentsektion: hårfin linje + versal rubrik bär hierarkin, i stället för
 * ett kort med egen ram. break-inside-avoid håller sektionen ihop i utskrift.
 */
export function DocSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cx("mt-5 break-inside-avoid border-t border-line pt-4", className)}>
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{title}</h2>
      {children}
    </section>
  );
}

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
    <div className="mt-7 break-inside-avoid border-t border-line pt-3 text-center text-[11px] leading-relaxed text-muted">
      {company.name} · Org.nr {company.orgNumber} · Momsreg.nr {company.vatNumber}
      {sate ? ` · Säte ${sate}` : ""}
      <br />
      {pay ? `${pay} · ` : ""}
      {company.email} · {company.phone} · Godkänd för F-skatt
    </div>
  );
}

export function DocLinesTable({
  lines,
}: {
  lines: QuoteVersion["lines"];
}) {
  return (
    // Smal skärm: Antal/À-pris flyttar in som underrad så tabellen aldrig kläms.
    <table className="w-full text-left text-[13.5px]">
      <thead>
        <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          <th className="pb-1.5 pr-3 font-semibold">Beskrivning</th>
          <th className="hidden pb-1.5 pr-3 text-right font-semibold sm:table-cell">Antal</th>
          <th className="hidden pb-1.5 pr-3 text-right font-semibold sm:table-cell">À-pris</th>
          <th className="pb-1.5 text-right font-semibold">Summa</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.id} className="break-inside-avoid border-b border-line/60 last:border-0">
            <td className="py-2 pr-3">
              <p className="font-medium text-ink">{line.description}</p>
              <p className="text-[11.5px] text-muted">
                {lineKindLabel(line.kind)}
                <span className="sm:hidden">
                  {" "}
                  · {line.qty} {line.unit} × {kr(line.unitPrice)}
                </span>
              </p>
            </td>
            <td className="hidden py-2 pr-3 text-right text-soft tabular whitespace-nowrap sm:table-cell">
              {line.qty} {line.unit}
            </td>
            <td className="hidden py-2 pr-3 text-right text-soft tabular whitespace-nowrap sm:table-cell">{kr(line.unitPrice)}</td>
            <td className="py-2 text-right font-medium text-ink tabular whitespace-nowrap">{kr(lineTotal(line))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Ekonomisammanställningen. ROT/RUT ligger i samma uppställning som summorna –
 * inget separat kort – och förklaringen står som fullt läsbar not under den.
 */
export function DocTotalsBlock({
  lines,
  rot,
  toPayLabel = "Att betala",
  note,
}: {
  lines: QuoteVersion["lines"];
  rot: QuoteVersion["rot"];
  toPayLabel?: string;
  /** Villkorstext som hör till summeringen. Alltid synlig – aldrig bakom en expand. */
  note?: ReactNode;
}) {
  const t = docTotals(lines, rot);
  const vat = vatBreakdown(lines);
  // Manuellt sänkt avdrag: procentsatsen i räkneexemplet skulle inte stämma.
  const showCalcHint =
    Boolean(rot) && !(rot!.appliedTaxReduction != null && rot!.appliedTaxReduction !== t.calculatedEligibleTaxReduction);
  return (
    <div className="break-inside-avoid">
      <div className="ml-auto w-full max-w-[300px] space-y-1 text-[13.5px]">
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
          <span>Summa inkl. moms</span>
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
        <div className="mt-1.5 flex items-baseline justify-between border-t border-line pt-2">
          <span className="text-[14px] font-semibold text-ink">{toPayLabel}</span>
          <span className="text-[19px] font-semibold tracking-tight text-ink tabular">{kr(t.toPay)}</span>
        </div>
      </div>
      {rot && showCalcHint ? (
        <p className="mt-2.5 max-w-[46rem] text-[11px] leading-[1.5] text-muted">
          {taxReductionCalcHintText(rot.type, t.laborInclVat)}
        </p>
      ) : null}
      {note}
    </div>
  );
}

/**
 * Offertdokumentet exakt som kunden ser det.
 * Används på offertdetaljen, på den publika offertsidan och i utskrift/PDF.
 * Allt kunden accepterar är synligt direkt – ingen avtalstext bakom expand.
 */
export function QuoteDocument({
  company,
  customer,
  quote,
  version,
  signature,
  approval,
}: {
  company: CompanySettings;
  customer: Customer;
  quote: Quote;
  version: QuoteVersion;
  signature?: BankIDSignature;
  /** Signeringsknappen på den publika sidan. I utskrift ersätts den av statisk text. */
  approval?: ReactNode;
}) {
  const seller = resolveQuoteCompany(version, company);
  const t = docTotals(version.lines, version.rot);
  const plan = version.paymentPlan;
  const paymentRows =
    plan.length > 0
      ? plan.map((p, i) => ({
          key: `${i}-${p.label}`,
          label: `${p.label} (${p.percent} %)`,
          amount: Math.round((t.toPay * p.percent) / 100),
        }))
      : [{ key: "hela", label: "Hela beloppet (100 %)", amount: t.toPay }];

  return (
    <article className="bg-white px-6 py-7 text-ink sm:px-9 sm:py-8 print:px-0 print:py-0">
      <DocCompanyHeader company={seller} docType="Offert" docNumber={`#${quote.number}`} />

      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-[12.5px] sm:grid-cols-4">
        <div>
          <p className="text-muted">Datum</p>
          <p className="font-medium">{datumNumeriskt(version.createdAt)}</p>
        </div>
        <div>
          <p className="text-muted">Giltig till</p>
          <p className="font-medium">{datumNumeriskt(version.validUntil)}</p>
        </div>
        <div>
          <p className="text-muted">Version</p>
          <p className="font-medium">{version.version}</p>
        </div>
        <div>
          <p className="text-muted">Till</p>
          <p className="font-medium">{customer.name}</p>
          {customer.address ? (
            <p className="text-muted">
              {[customer.address, [customer.postalCode, customer.city].filter(Boolean).join(" ")]
                .filter(Boolean)
                .join(", ")}
            </p>
          ) : null}
        </div>
      </div>

      <h1 className="mt-6 text-[21px] font-semibold tracking-tight">{version.title}</h1>
      {version.intro ? <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-soft">{version.intro}</p> : null}

      <div className="mt-5">
        <RichTextView doc={version.richText} className="mb-5" />
        <DocLinesTable lines={version.lines} />
      </div>

      <div className="mt-4">
        <DocTotalsBlock
          lines={version.lines}
          rot={version.rot}
          toPayLabel="Att betala"
          note={
            version.rot ? (
              <TaxReductionQuoteClause terms={version.taxReductionTerms ?? getTaxReductionTerms(version.rot.type)} />
            ) : null
          }
        />
      </div>

      <DocSection title="Betalning">
        <div className="mt-2 space-y-1 text-[13.5px]">
          {paymentRows.map((row) => (
            <div key={row.key} className="flex items-baseline justify-between gap-4">
              <span className="text-soft">{row.label}</span>
              <span className="font-medium tabular whitespace-nowrap">{kr(row.amount)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] leading-[1.5] text-muted">
          Betalningsvillkor: {version.paymentTermsDays} dagar per faktura.
          {version.lateInterestRate
            ? ` Vid försenad betalning debiteras dröjsmålsränta med ${version.lateInterestRate} % per år.`
            : ""}
        </p>
      </DocSection>

      <DocSection title="Villkor">
        <p className="mt-1.5 max-w-[46rem] whitespace-pre-line text-[12px] leading-[1.55] text-soft">{version.terms}</p>
      </DocSection>

      {signature ? (
        <DocSection title="Godkänd">
          <p className="mt-1.5 flex items-center gap-1.5 text-[13.5px] font-semibold text-ok">
            <BadgeCheck className="size-4 shrink-0" />
            {signedWithBankIdBy(signature.signerName)}
          </p>
          <p className="mt-0.5 text-[11.5px] text-muted">{datumTid(signature.signedAt)}</p>
        </DocSection>
      ) : (
        <DocSection title="Godkänn offerten">
          <p className="mt-1.5 max-w-[46rem] text-[13px] leading-relaxed text-soft">
            Signera tryggt och juridiskt bindande med BankID. Offerten är giltig till {datumLang(version.validUntil)}.
          </p>
          {approval ? <div className="mt-3 print:hidden">{approval}</div> : null}
          <p className={cx("mt-1.5 text-[11.5px] leading-[1.5] text-muted", Boolean(approval) && "hidden print:block")}>
            Offerten godkänns genom BankID-signering via den digitala offertlänken.
          </p>
        </DocSection>
      )}

      <DocFooter company={seller} />
    </article>
  );
}
