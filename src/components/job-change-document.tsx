import type { CompanySettings, Customer, JobChange, RotRut } from "@/lib/types";
import { datumNumeriskt, datumTid } from "@/lib/format";
import { resolveQuoteCompany, resolveQuoteCustomer } from "@/lib/invoices/snapshot";
import { DocCompanyHeader, DocFooter, DocLinesTable, DocTotalsBlock } from "./quote-document";

/**
 * Ändringsdokumentet exakt som kunden ser det: företag → kund → rubrik →
 * vad som ändras → tidspåverkan → prisrader → summering → ev. godkänd-rad.
 * Ingen CTA i kortet; godkännandet ligger under (samma som offerten).
 */
export function JobChangeDocument({
  company,
  customer,
  change,
  jobTitle,
  rot,
}: {
  company: CompanySettings;
  customer: Customer;
  change: JobChange;
  jobTitle: string;
  rot: RotRut | null;
}) {
  const seller = resolveQuoteCompany(change, company);
  const buyer = resolveQuoteCustomer(change, customer);
  const dated = change.sentAt ?? change.createdAt;
  const versionLabel = change.version > 1 ? ` (version ${change.version})` : "";
  return (
    <div className="p-6 sm:p-10" data-change-document="">
      <DocCompanyHeader company={seller} docType="Ändring" docNumber={`${change.number}${versionLabel}`} />

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Till</p>
          <p className="mt-1 text-[15px] font-medium text-ink">{buyer.name}</p>
          {buyer.address ? (
            <p className="text-[13px] text-soft">
              {buyer.address}
              {buyer.postalCode || buyer.city ? `, ${[buyer.postalCode, buyer.city].filter(Boolean).join(" ")}` : ""}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:justify-end">
          <div>
            <p className="text-[12px] text-muted">Gäller uppdraget</p>
            <p className="text-[13px] font-medium text-ink">{jobTitle}</p>
          </div>
          <div>
            <p className="text-[12px] text-muted">Datum</p>
            <p className="text-[13px] font-medium text-ink">{datumNumeriskt(dated)}</p>
          </div>
        </div>
      </div>

      <h2 className="mt-8 text-[22px] font-semibold tracking-tight text-ink">{change.title}</h2>
      {change.description ? (
        <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-soft">{change.description}</p>
      ) : null}
      {change.timeImpact ? (
        <p className="mt-3 text-[14px] text-ink">
          <span className="font-medium">Påverkan på tid:</span> {change.timeImpact}
        </p>
      ) : null}

      {change.lines.length > 0 ? (
        <div className="mt-6">
          <DocLinesTable lines={change.lines} />
        </div>
      ) : null}
      <div className="mt-6">
        <DocTotalsBlock lines={change.lines} rot={rot} toPayLabel="Tillägg att betala" />
      </div>

      {change.approval ? (
        <p className="mt-6 text-[13px] text-soft" data-change-approved-line="">
          Godkänd {datumTid(change.approval.approvedAt)} av {change.approval.approvedByName}
        </p>
      ) : null}
      {change.status === "avbojd" && change.decidedAt ? (
        <p className="mt-6 text-[13px] text-soft">Avböjd {datumTid(change.decidedAt)}</p>
      ) : null}

      <DocFooter company={seller} />
    </div>
  );
}
