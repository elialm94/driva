import type { CompanySettings, Customer, Invoice } from "@/lib/types";
import { docTotals, lineTotal } from "@/lib/calc";
import { kr, datumNumeriskt, datumLang } from "@/lib/format";
import { BadgeCheck } from "lucide-react";
import { DocCompanyHeader, DocFooter, DocHousingBlock, DocTotalsBlock } from "./quote-document";
import { housingLinesFromDetails, resolveInvoiceView } from "@/lib/invoices/snapshot";
import { invoiceNumberLabel, invoiceTypeLabel, sameCalendarDay } from "@/lib/invoices/display";
import { TaxReductionInvoiceDisclaimer } from "./tax-reduction-terms";
import { lineKindLabel } from "@/lib/economic-line-type";
import { RichTextView } from "./rich-text";

function InvoiceLinesTable({ lines }: { lines: Invoice["lines"] }) {
  return (
    // Smal skärm: Antal/À-pris/Moms flyttar in som underrad så tabellen aldrig kläms.
    <table className="w-full text-left text-[14px]">
      <thead>
        <tr className="border-b border-line text-[12px] font-semibold uppercase tracking-wide text-muted">
          <th className="pb-2 pr-3 font-semibold">Beskrivning</th>
          <th className="hidden pb-2 pr-3 text-right font-semibold sm:table-cell">Antal</th>
          <th className="hidden pb-2 pr-3 text-right font-semibold sm:table-cell">À-pris exkl.</th>
          <th className="hidden pb-2 pr-3 text-right font-semibold sm:table-cell">Moms</th>
          <th className="pb-2 text-right font-semibold">Underlag</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.id} className="border-b border-line/60 last:border-0">
            <td className="py-3 pr-3">
              <p className="font-medium text-ink">{line.description}</p>
              <p className="text-[12px] text-muted">
                {lineKindLabel(line.kind)}
                <span className="sm:hidden">
                  {" "}
                  · {line.qty} {line.unit} × {kr(line.unitPrice)} · moms {line.vatRate} %
                </span>
              </p>
            </td>
            <td className="hidden py-3 pr-3 text-right text-soft tabular whitespace-nowrap sm:table-cell">
              {line.qty} {line.unit}
            </td>
            <td className="hidden py-3 pr-3 text-right text-soft tabular whitespace-nowrap sm:table-cell">{kr(line.unitPrice)}</td>
            <td className="hidden py-3 pr-3 text-right text-soft tabular whitespace-nowrap sm:table-cell">{line.vatRate} %</td>
            <td className="py-3 text-right font-medium text-ink tabular whitespace-nowrap">{kr(lineTotal(line))}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
  const showServiceDate = Boolean(doc.serviceDate && !sameCalendarDay(doc.serviceDate, doc.issueDate));
  const originalNumber = doc.issuedSnapshot?.creditsInvoiceNumber ?? invoice.issuedSnapshot?.creditsInvoiceNumber;

  return (
    <div className="relative bg-white px-7 py-8 text-ink sm:px-10 sm:py-10">
      {invoice.status === "betald" ? (
        <div className="absolute right-8 top-24 rotate-[-8deg] rounded-lg border-2 border-ok/50 px-3 py-1 text-[15px] font-bold uppercase tracking-widest text-ok/70">
          Betald
        </div>
      ) : null}

      <DocCompanyHeader
        company={seller}
        docType={invoiceTypeLabel(doc.type)}
        docNumber={invoiceNumberLabel(doc)}
      />

      <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 text-[13px] sm:grid-cols-4">
        <div>
          <p className="text-muted">Fakturadatum</p>
          <p className="font-medium">{datumNumeriskt(doc.issueDate)}</p>
        </div>
        <div>
          <p className="text-muted">Förfallodatum</p>
          <p className="font-medium">{datumNumeriskt(doc.dueDate)}</p>
        </div>
        <div>
          <p className="text-muted">OCR-nummer</p>
          <p className="font-medium tabular">{doc.ocr || "–"}</p>
        </div>
        <div>
          <p className="text-muted">Valuta</p>
          <p className="font-medium">SEK</p>
        </div>
        {showServiceDate ? (
          <div>
            <p className="text-muted">Utförandedatum</p>
            <p className="font-medium">{datumNumeriskt(doc.serviceDate!)}</p>
          </div>
        ) : null}
        <div className={showServiceDate ? undefined : "sm:col-span-2"}>
          <p className="text-muted">Kund</p>
          <p className="font-medium">{buyer.name}</p>
          {buyer.address ? (
            <p className="text-muted">
              {[buyer.address, [buyer.postalCode, buyer.city].filter(Boolean).join(" ")]
                .filter(Boolean)
                .join(", ")}
            </p>
          ) : null}
          {buyer.orgNumber ? <p className="text-muted">Org.nr {buyer.orgNumber}</p> : null}
        </div>
        <div>
          <p className="text-muted">Betalningsvillkor</p>
          <p className="font-medium">{doc.paymentTermsDays} dagar netto</p>
        </div>
      </div>

      {isCredit ? (
        <p className="mt-6 rounded-xl bg-canvas px-4 py-3 text-[13px] text-soft">
          Denna kreditfaktura krediterar
          {originalNumber != null ? ` faktura #${originalNumber}` : " tidigare skickad faktura"} i sin helhet.
          Delkredit stöds inte.
        </p>
      ) : null}

      <div className="mt-8">
        {/* Beskrivning före rader. Utfärdad faktura: frusen kopia via resolveInvoiceView. */}
        <RichTextView doc={doc.richText} className="mb-7" />
        <InvoiceLinesTable lines={doc.lines} />
      </div>

      <div className="mt-5">
        <DocTotalsBlock
          lines={doc.lines}
          rot={doc.rot}
          toPayLabel={isCredit ? "Att kreditera" : "Att betala nu"}
        />
      </div>

      {doc.rot ? (
        <>
          <DocHousingBlock housing={housingLinesFromDetails(doc.taxReductionDetails)} />
          <TaxReductionInvoiceDisclaimer version={doc.taxReductionTerms?.version} />
        </>
      ) : null}

      {!isCredit && invoice.status !== "betald" ? (
        <div className="mt-8 rounded-2xl border border-line bg-canvas/70 p-5">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-muted">Betalning</p>
          <div className="mt-3 grid grid-cols-1 gap-3 text-[14px] sm:grid-cols-3">
            {seller.bankgiro ? (
              <div>
                <p className="text-muted">Bankgiro</p>
                <p className="font-semibold tabular">{seller.bankgiro}</p>
              </div>
            ) : null}
            {seller.plusgiro ? (
              <div>
                <p className="text-muted">PlusGiro</p>
                <p className="font-semibold tabular">{seller.plusgiro}</p>
              </div>
            ) : null}
            {seller.iban ? (
              <div>
                <p className="text-muted">IBAN</p>
                <p className="font-semibold tabular">{seller.iban}</p>
              </div>
            ) : null}
            {seller.bankAccount && !seller.iban ? (
              <div>
                <p className="text-muted">Bankkonto</p>
                <p className="font-semibold tabular">{seller.bankAccount}</p>
              </div>
            ) : null}
            <div>
              <p className="text-muted">OCR</p>
              <p className="font-semibold tabular">{doc.ocr || "–"}</p>
            </div>
            <div>
              <p className="text-muted">Belopp</p>
              <p className="font-semibold tabular">{kr(t.toPay)}</p>
            </div>
          </div>
          <p className="mt-3 text-[12px] text-muted">
            Betala senast {datumLang(doc.dueDate)}. Ange OCR-numret som referens.
            {doc.lateInterestRate
              ? ` Efter förfallodagen debiteras dröjsmålsränta med ${doc.lateInterestRate} % per år.`
              : ""}
          </p>
        </div>
      ) : null}

      {invoice.status === "betald" && invoice.paidAt ? (
        <div className="mt-8 flex items-start gap-3 rounded-2xl border border-ok/20 bg-ok-soft/60 p-4">
          <BadgeCheck className="mt-0.5 size-5 shrink-0 text-ok" />
          <div>
            <p className="text-[14px] font-semibold text-ok">Betald</p>
            <p className="text-[13px] text-soft">Betalningen mottogs {datumLang(invoice.paidAt)}. Tack!</p>
          </div>
        </div>
      ) : null}

      <DocFooter company={seller} />
    </div>
  );
}
