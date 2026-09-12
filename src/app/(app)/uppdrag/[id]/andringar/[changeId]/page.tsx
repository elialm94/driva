import { notFound } from "next/navigation";
import { BadgeCheck, Clock, Link2, XCircle } from "lucide-react";
import { ensurePageBusiness } from "@/lib/auth/session";
import { db } from "@/lib/store";
import { getJob, jobQuote, currentVersion, requireCustomer, getInvoice } from "@/lib/services/data";
import { getInvoiceDefaults } from "@/lib/services/settings";
import { reverseChargeAppliesTo } from "@/lib/invoices/reverse-charge";
import {
  billableChangeLines,
  getJobChange,
  jobChangeDisplayStatus,
  jobChangeRot,
  jobChangeStatusLabel,
  jobChangeStatusTone,
} from "@/lib/services/job-changes";
import { sourceBillingState } from "@/lib/services/billing-allocation";
import { datumTid } from "@/lib/format";
import { Badge, Breadcrumbs, Card } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { AppLink } from "@/components/app-link";
import { JobChangeEditor } from "@/components/job-change-editor";
import { JobChangeDocument } from "@/components/job-change-document";
import { JobChangeActions } from "@/components/job-change-actions";
import { invoiceHref } from "@/lib/nav";

export async function generateMetadata(props: PageProps<"/uppdrag/[id]/andringar/[changeId]">) {
  await ensurePageBusiness();
  const { changeId } = await props.params;
  const change = getJobChange(changeId);
  return { title: change ? `Ändring ${change.number} – ${change.title}` : "Ändring" };
}

export default async function AndringPage(props: PageProps<"/uppdrag/[id]/andringar/[changeId]">) {
  await ensurePageBusiness();
  const { id, changeId } = await props.params;
  const searchParams = await props.searchParams;
  const job = getJob(id);
  const change = getJobChange(changeId);
  if (!job || !change || change.jobId !== job.id) notFound();
  const customer = requireCustomer(job.customerId);
  const quote = jobQuote(job);
  const rot = quote ? currentVersion(quote).rot : null;
  const defaults = getInvoiceDefaults();
  const jobHref = `/uppdrag/${job.id}`;
  const justSent = searchParams?.skickad === "1";

  const billed = billableChangeLines(change)
    .map((l) => sourceBillingState({ sourceType: "change_line", sourceId: l.id }))
    .filter((s) => s.status !== "unbilled");
  const invoiceIds = Array.from(new Set(billed.map((s) => s.invoiceId).filter((x): x is string => Boolean(x))));

  return (
    <div className="animate-fade-up">
      <div className="mb-2.5">
        <SmartBack />
      </div>
      <Breadcrumbs
        items={[
          { href: "/uppdrag", label: "Uppdrag" },
          { href: jobHref, label: job.title },
          { label: `Ändring ${change.number}` },
        ]}
      />
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[26px] font-semibold tracking-tight">
            Ändring {change.number}
            {change.version > 1 ? ` · version ${change.version}` : ""}
          </h1>
          <Badge tone={jobChangeStatusTone(change)}>{jobChangeStatusLabel(change)}</Badge>
        </div>
        <p className="mt-1 text-[14px] text-soft">{change.title}</p>
      </div>

      {change.status === "utkast" ? (
        <JobChangeEditor
          jobId={job.id}
          jobHref={jobHref}
          change={change}
          defaultVatRate={defaults.defaultVatRate}
          defaultHourlyRate={defaults.defaultHourlyRate}
          rotActive={Boolean(rot)}
          reverseCharge={reverseChargeAppliesTo(customer)}
        />
      ) : (
        <div className="space-y-6">
          {justSent || change.status === "vantar_pa_kunden" ? (
            <Card className="border-accent/30 bg-accent-soft/20 px-5 py-4" data-testid="job-change-waiting">
              <div className="flex items-start gap-3">
                <Link2 className="mt-0.5 size-5 shrink-0 text-accent" />
                <div className="flex-1">
                  <p className="text-[15px] font-semibold">
                    {change.status === "vantar_pa_kunden" ? "Väntar på kundens godkännande" : "Skickad"}
                  </p>
                  <p className="mt-0.5 text-[14px] text-soft">
                    Dela länken med {customer.name}. Kunden godkänner med sitt namn – innehållet är låst sedan {datumTid(change.sentAt ?? change.createdAt)}.
                    {change.viewedAt ? ` Visad ${datumTid(change.viewedAt)}.` : ""}
                  </p>
                  <div className="mt-3">
                    <JobChangeActions
                      changeId={change.id}
                      jobHref={jobHref}
                      token={change.token}
                      number={change.number}
                      phone={customer.phone}
                      canCreateVersion={change.status === "vantar_pa_kunden" && !change.replacedByChangeId}
                    />
                  </div>
                </div>
              </div>
            </Card>
          ) : null}

          {change.status === "godkand" && change.approval ? (
            <Card className="border-ok/25 bg-ok-soft/40 px-5 py-4" data-testid="job-change-approved">
              <div className="flex items-start gap-3">
                <BadgeCheck className="mt-0.5 size-5 shrink-0 text-ok" />
                <div className="flex-1">
                  <p className="text-[15px] font-semibold text-ok">Godkänd av kunden</p>
                  <p className="mt-0.5 text-[14px] text-soft">
                    {change.approval.approvedByName}, {datumTid(change.approval.approvedAt)}
                  </p>
                  {invoiceIds.length > 0 ? (
                    <p className="mt-2 text-[13px] text-soft">
                      Fakturerad via{" "}
                      {invoiceIds.map((invId, i) => {
                        const inv = getInvoice(invId);
                        return (
                          <span key={invId}>
                            {i > 0 ? ", " : ""}
                            <AppLink href={invoiceHref(invId)} originLabel={`Ändring ${change.number}`} className="font-medium text-accent-deep hover:underline">
                              {inv?.number == null ? "fakturautkast" : `faktura #${inv.number}`}
                            </AppLink>
                          </span>
                        );
                      })}
                      .
                    </p>
                  ) : (
                    <p className="mt-2 text-[13px] text-soft">Raderna tas med när du avslutar uppdraget eller skapar nästa faktura.</p>
                  )}
                  <div className="mt-3">
                    <JobChangeActions
                      changeId={change.id}
                      jobHref={jobHref}
                      token={change.token}
                      number={change.number}
                      phone={customer.phone}
                      canCreateVersion={billed.length === 0 && !change.replacedByChangeId}
                    />
                  </div>
                </div>
              </div>
            </Card>
          ) : null}

          {change.status === "avbojd" ? (
            <Card className="px-5 py-4" data-testid="job-change-declined">
              <div className="flex items-start gap-3">
                <XCircle className="mt-0.5 size-5 shrink-0 text-danger" />
                <div className="flex-1">
                  <p className="text-[15px] font-semibold">Avböjd av kunden</p>
                  <p className="mt-0.5 text-[14px] text-soft">
                    {change.decidedAt ? datumTid(change.decidedAt) : ""}
                    {change.declineReason ? ` · “${change.declineReason}”` : ""}
                  </p>
                  <div className="mt-3">
                    <JobChangeActions
                      changeId={change.id}
                      jobHref={jobHref}
                      token={change.token}
                      number={change.number}
                      phone={customer.phone}
                      canCreateVersion={!change.replacedByChangeId}
                    />
                  </div>
                </div>
              </div>
            </Card>
          ) : null}

          {change.status === "ersatt" ? (
            <Card className="px-5 py-4">
              <div className="flex items-start gap-3">
                <Clock className="mt-0.5 size-5 shrink-0 text-muted" />
                <div>
                  <p className="text-[15px] font-semibold">Ersatt av en ny version</p>
                  {change.replacedByChangeId ? (
                    <AppLink href={`${jobHref}/andringar/${change.replacedByChangeId}`} originLabel={`Ändring ${change.number}`} className="mt-0.5 inline-block text-[14px] font-medium text-accent-deep hover:underline">
                      Öppna den nya versionen
                    </AppLink>
                  ) : null}
                </div>
              </div>
            </Card>
          ) : null}

          <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-card">
            <JobChangeDocument company={db().settings} customer={customer} change={change} jobTitle={job.title} rot={jobChangeRot(change)} />
          </div>
        </div>
      )}
    </div>
  );
}
