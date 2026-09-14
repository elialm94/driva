import { notFound } from "next/navigation";
import { BadgeCheck, Clock, XCircle } from "lucide-react";
import { db } from "@/lib/store";
import { getJob, requireCustomer } from "@/lib/services/data";
import {
  getJobChangeByToken,
  jobChangeHash,
  jobChangeRot,
  jobChangeStatement,
  jobChangeTotals,
  markJobChangeViewed,
} from "@/lib/services/job-changes";
import { kr, datumTid } from "@/lib/format";
import { CompanyLogo } from "@/components/company-logo";
import { PublicDocumentFooter } from "@/components/public-document-chrome";
import { JobChangeDocument } from "@/components/job-change-document";
import { JobChangeApproveForm } from "@/components/job-change-approve";
import { resolveQuoteCompany, resolveQuoteCustomer } from "@/lib/invoices/snapshot";
import { ensurePublicPage, withPublicBusiness } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/andring/[token]">) {
  const { token } = await props.params;
  if (!(await ensurePublicPage("job_change", token))) return { title: "Ändring" };
  const change = getJobChangeByToken(token);
  if (!change || change.status === "utkast") return { title: "Ändring" };
  const seller = resolveQuoteCompany(change, db().settings);
  return { title: `Ändring ${change.number} – ${seller.name}` };
}

/**
 * Kundens sida för en ändring eller ett tillägg. Samma arkitektur som
 * offertlänken: token i adressen, dokumentkort, namn + knapp under kortet.
 * Utkast är inte publika. Ersatta versioner visas som låsta med hänvisning.
 */
export default async function PublicJobChangePage(props: PageProps<"/andring/[token]">) {
  const { token } = await props.params;
  const marked = await withPublicBusiness("job_change", token, () => {
    const c = getJobChangeByToken(token);
    if (!c || c.status === "utkast") return false;
    markJobChangeViewed(c.id);
    return true;
  });
  if (marked === null || marked === false) notFound();
  if (!(await ensurePublicPage("job_change", token))) notFound();
  const change = getJobChangeByToken(token);
  if (!change || change.status === "utkast") notFound();

  const data = db();
  const customer = requireCustomer(change.customerId);
  const job = getJob(change.jobId);
  const totals = jobChangeTotals(change);
  const seller = resolveQuoteCompany(change, data.settings);
  const buyer = resolveQuoteCustomer(change, customer);
  const prefillName = buyer.kind === "foretag" ? (buyer.contactPerson ?? "") : buyer.name;
  const canApprove = change.status === "vantar_pa_kunden";
  const amountLabel = totals.total < 0 ? `−${kr(Math.abs(totals.toPay))}` : kr(totals.toPay);

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <CompanyLogo company={seller} size="sm" />
            <div>
              <p className="text-[14px] font-semibold leading-tight">{seller.name}</p>
              <p className="text-[12px] text-muted">
                Ändring {change.number} till {customer.name}
              </p>
            </div>
          </div>
          <p className="text-[15px] font-semibold tabular">{amountLabel}</p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-5">
        {change.status === "godkand" && change.approval ? (
          <div data-change-approved-banner="" className="mb-6 rounded-2xl border border-ok/25 bg-ok-soft/70 px-5 py-4 animate-fade-up">
            <div className="flex items-start gap-3">
              <BadgeCheck className="mt-0.5 size-5 shrink-0 text-ok" />
              <div>
                <p className="text-[15px] font-semibold text-ok">Ändringen är godkänd</p>
                <p className="mt-0.5 text-[14px] text-soft">
                  Godkänd av {change.approval.approvedByName}, {datumTid(change.approval.approvedAt)} · {amountLabel}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {change.status === "avbojd" ? (
          <div data-change-public-closed="" className="mb-6 flex items-start gap-3 rounded-2xl border border-line bg-card px-5 py-4">
            <XCircle className="mt-0.5 size-5 shrink-0 text-muted" />
            <div>
              <p className="text-[15px] font-semibold">Ändringen är avböjd</p>
              <p className="text-[14px] text-soft">
                Ändrat dig? Hör av dig till {seller.name} på {seller.phone} så skickar vi en ny version.
              </p>
            </div>
          </div>
        ) : null}

        {change.status === "ersatt" ? (
          <div data-change-public-closed="" className="mb-6 flex items-start gap-3 rounded-2xl border border-warn/25 bg-warn-soft/60 px-5 py-4">
            <Clock className="mt-0.5 size-5 shrink-0 text-warn" />
            <div>
              <p className="text-[15px] font-semibold text-warn">Den här versionen har ersatts</p>
              <p className="text-[14px] text-soft">
                {seller.name} har skickat en ny version av ändringen. Använd den senaste länken du fått.
              </p>
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-card">
          <JobChangeDocument
            company={data.settings}
            customer={customer}
            change={change}
            jobTitle={job?.title ?? "Uppdraget"}
            rot={jobChangeRot(change)}
          />
        </div>

        {canApprove ? (
          <JobChangeApproveForm
            token={change.token}
            statement={jobChangeStatement(change)}
            prefillName={prefillName}
            contentHash={jobChangeHash(change)}
          />
        ) : null}

        <PublicDocumentFooter sellerName={seller.name} sellerEmail={seller.email} />
        <div className="h-10" />
      </main>
    </div>
  );
}
