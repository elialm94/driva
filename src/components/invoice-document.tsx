import type { CompanySettings, Customer, Invoice } from "@/lib/types";
import { docTotals, lineTotal, vatBreakdown } from "@/lib/calc";
import { kr, datumNumeriskt, datumLang } from "@/lib/format";
import { BadgeCheck } from "lucide-react";
import { CompanyLogo } from "./company-logo";
import { resolveInvoiceView } from "@/lib/invoices/snapshot";
import { invoiceTypeLabel } from "@/lib/invoices/display";
import {
  invoicePaymentRows,
  invoicePaymentTermsLine,
  invoiceQuoteReference,
  invoiceTaxReductionView,
  lineTypeNote,
  type DocInfoRow,
  type InvoiceTaxReductionDocView,
} from "@/lib/invoices/document-view";
import { TaxReductionInvoiceDisclaimer } from "./tax-reduction-terms";
import { RichTextView } from "./rich-text";

/** Sektionsrubrik i dokumentet – liten, spärrad versal (dokument, inte dashboard). */
function DocSectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{children}</p>;
}

function InvoiceLinesTable({ lines }: { lines: Invoice["lines"] }) {
  const numericTh = "hidden pb-2 pl-3 text-right font-semibold sm:table-cell print:table-cell";
  const numericTd = "hidden py-2.5 pl-3 text-right align-top text-soft tabular whitespace-nowrap sm:table-cell print:table-cell";
  return (
    // Smal skärm: Antal/À-pris/Moms flyttar in som underrad. Print/A4: alltid alla kolumner.
    <table className="w-full text-left text-[13.5px]">
      <thead>
        <tr className="border-b border-ink/60 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          <th className="pb-2 font-semibold">Beskrivning</th>
          <th className={numericTh}>Antal</th>
          <th className={numericTh}>À-pris exkl.</th>
          <th className={numericTh}>Moms</th>
          <th className="pb-2 pl-3 text-right font-semibold">Summa</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          const typeNote = lineTypeNote(line);
          return (
            <tr key={line.id} className="break-inside-avoid border-b border-line/70 last:border-0">
              <td className="py-2.5 align-top">
                <p className="font-medium leading-snug text-ink">{line.description}</p>
                {typeNote ? <p className="text-[11.5px] leading-snug text-muted">{typeNote}</p> : null}
                <p className="text-[12px] text-muted sm:hidden print:hidden">
                  {line.qty} {line.unit} × {kr(line.unitPrice)} · moms {line.vatRate} %
                </p>
              </td>
              <td className={numericTd}>
                {line.qty} {line.unit}
              </td>
              <td className={numericTd}>{kr(line.unitPrice)}</td>
              <td className={numericTd}>{line.vatRate} %</td>
              <td className="py-2.5 pl-3 text-right align-top font-medium text-ink tabular whitespace-nowrap">
                {kr(lineTotal(line))}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Normala totaler – ROT/RUT-detaljer bor i sin egen sektion, aldrig här. */
function InvoiceTotals({ lines }: { lines: Invoice["lines"] }) {
  const t = docTotals(lines, null);
  const vat = vatBreakdown(lines);
  return (
    <div className="break-inside-avoid mt-3 flex justify-end">
      <div className="w-full max-w-[300px] space-y-1.5 text-[13.5px]">
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
        <div className="flex justify-between border-t border-line pt-1.5 font-medium text-ink">
          <span>Totalt</span>
          <span className="tabular">{kr(t.total)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * ROT/RUT-sektionen: person, fastighet/bostad, utförandedatum och avdragets
 * belopp – från dokumentets egna (snapshotade) uppgifter. Disclaimer alltid
 * fullt synlig direkt under, även i PDF.
 */
function InvoiceTaxReductionSection({
  view,
  termsVersion,
}: {
  view: InvoiceTaxReductionDocView;
  termsVersion?: string;
}) {
  return (
    <section className="break-inside-avoid mt-5 border-t border-line pt-3.5">
      <DocSectionLabel>{view.heading}</DocSectionLabel>
      <div className="mt-2.5 grid gap-x-8 gap-y-3 sm:grid-cols-[minmax(0,1fr)_300px] print:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-0.5 text-[13.5px] leading-relaxed">
          <p className="font-medium text-ink">
            {view.personName}
            {view.personalIdentityNumber ? (
              <span className="font-normal text-soft tabular"> · {view.personalIdentityNumber}</span>
            ) : null}
          </p>
          {view.propertyRows.map((row) => (
            <p key={row.label} className="text-soft">
              {row.label}: {row.value}
            </p>
          ))}
          {view.periodRow ? (
            <p className="text-soft">
              {view.periodRow.label}: {view.periodRow.value}
            </p>
          ) : null}
        </div>
        <div className="w-full max-w-[300px] space-y-1.5 self-start text-[13.5px] sm:justify-self-end print:justify-self-end">
          <div className="flex justify-between text-soft">
            <span>Arbetskostnad inkl. moms</span>
            <span className="tabular">{kr(view.laborInclVat)}</span>
          </div>
          <div className="flex justify-between text-accent-deep">
            <span>{view.deductionLabel}</span>
            <span className="tabular">−{kr(view.deduction)}</span>
          </div>
        </div>
      </div>
      <TaxReductionInvoiceDisclaimer version={termsVersion} />
    </section>
  );
}

/** Dokumentets viktigaste ekonomiska resultat – visuellt tydligast av allt. */
function InvoiceAmountDue({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="break-inside-avoid mt-4 flex justify-end">
      <div className="w-full max-w-[300px] border-t-2 border-ink pt-2">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink">{label}</span>
          <span className="text-[24px] font-semibold tracking-tight text-ink tabular">{kr(amount)}</span>
        </div>
      </div>
    </div>
  );
}

function InvoicePaymentSection({ rows, termsLine }: { rows: DocInfoRow[]; termsLine: string }) {
  return (
    <section className="break-inside-avoid mt-5 border-t border-line pt-3.5">
      <DocSectionLabel>Betalningsuppgifter</DocSectionLabel>
      <div className="mt-2.5 flex flex-wrap gap-x-7 gap-y-1.5 text-[13.5px]">
        {rows.map((row) => (
          <p key={row.label} className="whitespace-nowrap">
            <span className="text-muted">{row.label} </span>
            <span className="font-semibold text-ink tabular">{row.value}</span>
          </p>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-muted">{termsLine}</p>
    </section>
  );
}

/** Företagsuppgifter – fullt läsbara på A4, endast fält med värde. */
function InvoiceCompanyFooter({ company }: { company: CompanySettings }) {
  const sate = company.sate?.trim() || company.city;
  // Dokumentkonvention: webbadress utan protokoll ("driva.se", inte "https://…").
  const website = company.websiteUrl?.replace(/^https?:\/\//, "").replace(/\/$/, "") ?? "";
  const payment: string[] = [];
  if (company.bankgiro?.trim()) payment.push(`Bankgiro ${company.bankgiro.trim()}`);
  if (company.plusgiro?.trim()) payment.push(`PlusGiro ${company.plusgiro.trim()}`);
  if (company.iban?.trim()) payment.push(`IBAN ${company.iban.trim()}`);
  if (company.bic?.trim()) payment.push(`BIC ${company.bic.trim()}`);
  if (!company.iban?.trim() && company.bankAccount?.trim()) payment.push(`Bankkonto ${company.bankAccount.trim()}`);

  const columns: { label: string; rows: string[] }[] = [
    {
      label: "Adress",
      rows: [company.name, company.address, `${company.postalCode} ${company.city}`.trim(), sate ? `Säte: ${sate}` : ""],
    },
    {
      label: "Kontakt",
      rows: [company.phone, company.email, website],
    },
    { label: "Betalning", rows: payment },
    {
      label: "Företag",
      rows: [`Org.nr ${company.orgNumber}`, `Momsreg.nr ${company.vatNumber}`, "Godkänd för F-skatt"],
    },
  ]
    .map((column) => ({ ...column, rows: column.rows.filter((row) => row.trim()) }))
    .filter((column) => column.rows.length > 0);

  return (
    <footer className="break-inside-avoid mt-6 border-t border-line pt-3.5">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-[1fr_1.35fr_0.95fr_1fr] print:grid-cols-[1fr_1.35fr_0.95fr_1fr]">
        {columns.map((column) => (
          <div key={column.label} className="min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{column.label}</p>
            {column.rows.map((row, i) => (
              <p key={i} className="mt-0.5 break-words text-[12px] leading-snug text-soft first-of-type:mt-1">
                {row}
              </p>
            ))}
          </div>
        ))}
      </div>
    </footer>
  );
}

/** Fakturadokumentet. Utkast: live säljare/köpare. Utfärdad: issuedSnapshot. */
export function InvoiceDocument({
  company,
  customer,
  invoice,
}: {
  company: CompanySettings;
  customer: Customer;
  invoice: Invoice;
}) {
  const view = resolveInvoiceView(invoice, { seller: company, buyer: customer });
  const seller = view.seller;
  const buyer = view.buyer;
  const doc = view.invoice;
  const t = docTotals(doc.lines, doc.rot);
  const isCredit = doc.type === "kredit";
  const isPaid = invoice.status === "betald";
  const originalNumber = doc.issuedSnapshot?.creditsInvoiceNumber ?? invoice.issuedSnapshot?.creditsInvoiceNumber;
  // ROT/RUT-vyn binder mot rådatan (snapshot för utfärdad, live för utkast).
  const rotView = invoiceTaxReductionView(invoice, { buyer: customer });
  const quoteRef = invoiceQuoteReference(doc.lines);

  const metaRows: DocInfoRow[] = [
    { label: "Fakturadatum", value: datumNumeriskt(doc.issueDate) },
    { label: "Förfallodatum", value: datumNumeriskt(doc.dueDate) },
    { label: "Betalningsvillkor", value: `${doc.paymentTermsDays} dagar` },
    // Utkast utan OCR: ingen tom rad – OCR kommer med utfärdandet.
    ...(doc.ocr ? [{ label: "OCR", value: doc.ocr }] : []),
    ...(quoteRef != null ? [{ label: "Avser", value: `Offert #${quoteRef}` }] : []),
    ...(buyer.contactPerson?.trim() ? [{ label: "Er referens", value: buyer.contactPerson.trim() }] : []),
  ];

  const buyerAddressLine = [buyer.address, [buyer.postalCode, buyer.city].filter(Boolean).join(" ")]
    .map((part) => part?.trim())
    .filter(Boolean) as string[];

  return (
    <div className="relative bg-white px-7 py-8 text-ink sm:px-10 sm:py-10 print:px-0 print:py-0">
      <header className="flex items-start justify-between gap-6">
        <div className="flex items-center gap-3.5">
          <CompanyLogo company={seller} size="md" />
          <div>
            <p className="text-[16px] font-semibold leading-tight text-ink">{seller.name}</p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-muted">
              {seller.address}, {seller.postalCode} {seller.city}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-muted">{invoiceTypeLabel(doc.type)}</p>
          <p className="text-[22px] font-semibold leading-tight tracking-tight text-ink tabular">
            {doc.number == null ? "Utkast" : `#${doc.number}`}
          </p>
          {isPaid ? (
            <span className="mt-1.5 inline-block rotate-[-6deg] rounded-lg border-2 border-ok/50 px-2.5 py-0.5 text-[13px] font-bold uppercase tracking-widest text-ok/70">
              Betald
            </span>
          ) : null}
        </div>
      </header>

      <div className="mt-5 grid gap-x-10 gap-y-5 border-t border-line pt-4 sm:grid-cols-[minmax(0,1fr)_auto] print:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <DocSectionLabel>Fakturamottagare</DocSectionLabel>
          <p className="mt-1.5 text-[15px] font-semibold leading-snug text-ink">{buyer.name}</p>
          {buyerAddressLine.map((row, i) => (
            <p key={i} className="text-[13.5px] leading-relaxed text-soft">
              {row}
            </p>
          ))}
          {buyer.orgNumber ? <p className="text-[13px] text-muted">Org.nr {buyer.orgNumber}</p> : null}
        </div>
        <dl className="grid grid-cols-[auto_auto] content-start gap-x-6 gap-y-1 self-start text-[13px] sm:justify-end print:justify-end">
          {metaRows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-muted">{row.label}</dt>
              <dd className="text-right font-medium text-ink tabular">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {isCredit ? (
        <p className="mt-5 border-l-2 border-line-strong pl-3 text-[13px] leading-relaxed text-soft">
          Denna kreditfaktura krediterar
          {originalNumber != null ? ` faktura #${originalNumber}` : " tidigare skickad faktura"} i sin helhet.
          Delkredit stöds inte.
        </p>
      ) : null}

      {/* Användarens fritext – exakt som skapad, före raderna. Tom → ingenting. */}
      <RichTextView doc={doc.richText} className="mt-5" />

      <div className="mt-5">
        <InvoiceLinesTable lines={doc.lines} />
      </div>

      <InvoiceTotals lines={doc.lines} />

      {rotView ? <InvoiceTaxReductionSection view={rotView} termsVersion={doc.taxReductionTerms?.version} /> : null}

      <InvoiceAmountDue label={isCredit ? "Att kreditera" : "Att betala"} amount={t.toPay} />

      {!isCredit && !isPaid ? (
        <InvoicePaymentSection
          rows={invoicePaymentRows({ seller, ocr: doc.ocr, dueDate: doc.dueDate, amount: t.toPay })}
          termsLine={invoicePaymentTermsLine(doc)}
        />
      ) : null}

      {isPaid && invoice.paidAt ? (
        <div className="break-inside-avoid mt-5 flex items-start gap-3 border-t border-line pt-3.5">
          <BadgeCheck className="mt-0.5 size-5 shrink-0 text-ok" />
          <div>
            <p className="text-[14px] font-semibold text-ok">Betald</p>
            <p className="text-[13px] text-soft">Betalningen mottogs {datumLang(invoice.paidAt)}. Tack!</p>
          </div>
        </div>
      ) : null}

      <InvoiceCompanyFooter company={seller} />
    </div>
  );
}
