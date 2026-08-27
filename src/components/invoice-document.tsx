import type { CompanySettings, Customer, Invoice } from "@/lib/types";
import { docTotals } from "@/lib/calc";
import { kr, datumNumeriskt, datumLang } from "@/lib/format";
import { BadgeCheck } from "lucide-react";
import { DocCompanyHeader, DocFooter, DocLinesTable, DocTotalsBlock } from "./quote-document";

const TYPE_LABEL: Record<Invoice["type"], string> = {
  faktura: "Faktura",
  delbetalning: "Delbetalning",
  slutfaktura: "Slutfaktura",
  kredit: "Kreditfaktura",
};

/** Fakturadokumentet exakt som kunden ser det – preview, publik sida och PDF. */
export function InvoiceDocument({
  company,
  customer,
  invoice,
}: {
  company: CompanySettings;
  customer: Customer;
  invoice: Invoice;
}) {
  const t = docTotals(invoice.lines, invoice.rot);
  const isCredit = invoice.type === "kredit";

  return (
    <div className="relative bg-white px-7 py-8 text-ink sm:px-10 sm:py-10">
      {invoice.status === "betald" ? (
        <div className="absolute right-8 top-24 rotate-[-8deg] rounded-lg border-2 border-ok/50 px-3 py-1 text-[15px] font-bold uppercase tracking-widest text-ok/70">
          Betald
        </div>
      ) : null}

      <DocCompanyHeader company={company} docType={TYPE_LABEL[invoice.type]} docNumber={`#${invoice.number}`} />

      <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 text-[13px] sm:grid-cols-4">
        <div>
          <p className="text-muted">Fakturadatum</p>
          <p className="font-medium">{datumNumeriskt(invoice.issueDate)}</p>
        </div>
        <div>
          <p className="text-muted">Förfallodatum</p>
          <p className="font-medium">{datumNumeriskt(invoice.dueDate)}</p>
        </div>
        <div>
          <p className="text-muted">OCR-nummer</p>
          <p className="font-medium tabular">{invoice.ocr}</p>
        </div>
        <div>
          <p className="text-muted">Till</p>
          <p className="font-medium">{customer.name}</p>
          {customer.address ? (
            <p className="text-muted">
              {customer.address}, {customer.city}
            </p>
          ) : null}
        </div>
      </div>

      {isCredit ? (
        <p className="mt-6 rounded-xl bg-canvas px-4 py-3 text-[13px] text-soft">
          Denna kreditfaktura krediterar tidigare skickad faktura i sin helhet.
        </p>
      ) : null}

      <div className="mt-8">
        <DocLinesTable lines={invoice.lines} />
      </div>

      <div className="mt-5">
        <DocTotalsBlock lines={invoice.lines} rot={invoice.rot} toPayLabel={isCredit ? "Att kreditera" : "Att betala"} />
      </div>

      {invoice.rot && t.deduction > 0 ? (
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          {invoice.rot.type === "rot" ? "ROT-avdrag" : "RUT-avdrag"} om {kr(t.deduction)} har dragits av. Vi begär
          utbetalningen från Skatteverket – du behöver inte göra något.
        </p>
      ) : null}

      {!isCredit && invoice.status !== "betald" ? (
        <div className="mt-8 rounded-2xl border border-line bg-canvas/70 p-5">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-muted">Betalning</p>
          <div className="mt-3 grid grid-cols-1 gap-3 text-[14px] sm:grid-cols-3">
            <div>
              <p className="text-muted">Bankgiro</p>
              <p className="font-semibold tabular">{company.bankgiro}</p>
            </div>
            <div>
              <p className="text-muted">OCR</p>
              <p className="font-semibold tabular">{invoice.ocr}</p>
            </div>
            <div>
              <p className="text-muted">Belopp</p>
              <p className="font-semibold tabular">{kr(t.toPay)}</p>
            </div>
          </div>
          <p className="mt-3 text-[12px] text-muted">
            Betala senast {datumLang(invoice.dueDate)}. Ange OCR-numret som referens.
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

      <DocFooter company={company} />
    </div>
  );
}
