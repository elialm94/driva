import type { BankIDSignature, CompanySettings, Customer, Quote, QuoteVersion } from "@/lib/types";
import { docTotals, lineTotal, vatBreakdown } from "@/lib/calc";
import { kr, datumLang, datumTid, datumNumeriskt } from "@/lib/format";
import { ShieldCheck, BadgeCheck } from "lucide-react";
import { taxReductionDeductionLabel, getTaxReductionTerms } from "@/lib/tax-reduction-terms";
import { TaxReductionQuoteClause } from "./tax-reduction-terms";
import { CompanyLogo } from "./company-logo";
import { resolveQuoteCompany } from "@/lib/invoices/snapshot";

const LINE_KIND_LABEL: Record<string, string> = {
  arbete: "Arbete",
  material: "Material",
  ovrigt: "Övrigt",
};

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

export function DocLinesTable({
  lines,
}: {
  lines: QuoteVersion["lines"];
}) {
  return (
    <table className="w-full text-left text-[14px]">
      <thead>
        <tr className="border-b border-line text-[12px] font-semibold uppercase tracking-wide text-muted">
          <th className="pb-2 pr-3 font-semibold">Beskrivning</th>
          <th className="pb-2 pr-3 text-right font-semibold">Antal</th>
          <th className="pb-2 pr-3 text-right font-semibold">À-pris</th>
          <th className="pb-2 text-right font-semibold">Summa</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.id} className="border-b border-line/60 last:border-0">
            <td className="py-3 pr-3">
              <p className="font-medium text-ink">{line.description}</p>
              <p className="text-[12px] text-muted">{LINE_KIND_LABEL[line.kind]}</p>
            </td>
            <td className="py-3 pr-3 text-right text-soft tabular whitespace-nowrap">
              {line.qty} {line.unit}
            </td>
            <td className="py-3 pr-3 text-right text-soft tabular whitespace-nowrap">{kr(line.unitPrice)}</td>
            <td className="py-3 text-right font-medium text-ink tabular whitespace-nowrap">{kr(lineTotal(line))}</td>
          </tr>
        ))}
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
        <div className="flex justify-between text-accent-deep">
          <span>{taxReductionDeductionLabel(rot.type)}</span>
          <span className="tabular">−{kr(t.deduction)}</span>
        </div>
      ) : null}
      <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2.5">
        <span className="text-[15px] font-semibold text-ink">{toPayLabel}</span>
        <span className="text-[20px] font-semibold tracking-tight text-ink tabular">{kr(t.toPay)}</span>
      </div>
    </div>
  );
}

/**
 * Offertdokumentet exakt som kunden ser det.
 * Används i preview före skickning, på den publika offertsidan och i PDF-vyn.
 */
export function QuoteDocument({
  company,
  customer,
  quote,
  version,
  signature,
}: {
  company: CompanySettings;
  customer: Customer;
  quote: Quote;
  version: QuoteVersion;
  signature?: BankIDSignature;
}) {
  const seller = resolveQuoteCompany(version, company);
  const t = docTotals(version.lines, version.rot);

  return (
    <div className="bg-white px-7 py-8 text-ink sm:px-10 sm:py-10">
      <DocCompanyHeader company={seller} docType="Offert" docNumber={`#${quote.number}`} />

      <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 text-[13px] sm:grid-cols-4">
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

      <h1 className="mt-9 text-[24px] font-semibold tracking-tight">{version.title}</h1>
      <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-soft">{version.intro}</p>

      <div className="mt-7">
        <DocLinesTable lines={version.lines} />
      </div>

      <div className="mt-5">
        <DocTotalsBlock lines={version.lines} rot={version.rot} toPayLabel="Att betala" />
      </div>

      {version.rot ? (
        <TaxReductionQuoteClause terms={version.taxReductionTerms ?? getTaxReductionTerms(version.rot.type)} />
      ) : null}

      {version.paymentPlan.length > 0 ? (
        <div className="mt-8">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-muted">Betalningsplan</p>
          <div className="mt-2 space-y-1.5">
            {version.paymentPlan.map((p, i) => (
              <div key={i} className="flex items-baseline justify-between text-[14px]">
                <span className="text-soft">
                  {p.label} ({p.percent} %)
                </span>
                <span className="font-medium tabular">{kr(Math.round((t.toPay * p.percent) / 100))}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-muted">
            Betalningsvillkor: {version.paymentTermsDays} dagar per faktura.
            {version.lateInterestRate ? ` Vid försenad betalning debiteras dröjsmålsränta med ${version.lateInterestRate} % per år.` : ""}
          </p>
        </div>
      ) : null}

      <div className="mt-8">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-muted">Villkor</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-soft">{version.terms}</p>
      </div>

      {signature ? (
        <div className="mt-8 flex items-start gap-3 rounded-2xl border border-ok/20 bg-ok-soft/60 p-4">
          <BadgeCheck className="mt-0.5 size-5 shrink-0 text-ok" />
          <div>
            <p className="text-[14px] font-semibold text-ok">Godkänd med BankID</p>
            <p className="text-[13px] text-soft">
              {signature.signerName} · {datumTid(signature.signedAt)}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-8 flex items-start gap-3 rounded-2xl border border-bankid/15 bg-bankid-soft/60 p-4">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-bankid" />
          <div>
            <p className="text-[14px] font-semibold text-bankid">Godkänns med BankID</p>
            <p className="text-[13px] leading-relaxed text-soft">
              Offerten godkänns tryggt och juridiskt bindande med BankID via länken i e-postmeddelandet. Giltig till{" "}
              {datumLang(version.validUntil)}.
            </p>
          </div>
        </div>
      )}

      <DocFooter company={seller} />
    </div>
  );
}
