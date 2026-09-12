import { notFound } from "next/navigation";
import { ensurePageBusiness } from "@/lib/auth/session";
import { getJob, jobQuote, currentVersion, requireCustomer } from "@/lib/services/data";
import { getInvoiceDefaults } from "@/lib/services/settings";
import { reverseChargeAppliesTo } from "@/lib/invoices/reverse-charge";
import { Breadcrumbs } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { JobChangeEditor } from "@/components/job-change-editor";

export async function generateMetadata() {
  return { title: "Ny ändring" };
}

export default async function NyAndringPage(props: PageProps<"/uppdrag/[id]/andringar/ny">) {
  await ensurePageBusiness();
  const { id } = await props.params;
  const job = getJob(id);
  if (!job) notFound();
  const customer = requireCustomer(job.customerId);
  const quote = jobQuote(job);
  const rot = quote ? currentVersion(quote).rot : null;
  const defaults = getInvoiceDefaults();

  return (
    <div className="animate-fade-up">
      <div className="mb-2.5">
        <SmartBack />
      </div>
      <Breadcrumbs
        items={[
          { href: "/uppdrag", label: "Uppdrag" },
          { href: `/uppdrag/${job.id}`, label: job.title },
          { label: "Ny ändring" },
        ]}
      />
      <div className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-tight">Ändring eller tillägg</h1>
        <p className="mt-1 text-[14px] text-soft">
          Beskriv vad som ändras för {customer.name} och vad det kostar. Kunden godkänner via en länk innan något faktureras.
        </p>
      </div>
      <JobChangeEditor
        jobId={job.id}
        jobHref={`/uppdrag/${job.id}`}
        defaultVatRate={defaults.defaultVatRate}
        defaultHourlyRate={defaults.defaultHourlyRate}
        rotActive={Boolean(rot)}
        reverseCharge={reverseChargeAppliesTo(customer)}
      />
    </div>
  );
}
