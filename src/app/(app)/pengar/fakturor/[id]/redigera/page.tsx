import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/store";
import { getInvoice, requireCustomer } from "@/lib/services/data";
import { dagarTill } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { InvoiceForm } from "@/components/doc-form";

export const metadata = { title: "Redigera faktura" };

export default async function EditInvoicePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const invoice = getInvoice(id);
  if (!invoice) notFound();
  if (invoice.status !== "utkast") redirect(`/pengar/fakturor/${invoice.id}`);

  const customer = requireCustomer(invoice.customerId);
  const customers = [...db().customers]
    .sort((a, b) => a.name.localeCompare(b.name, "sv"))
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));

  const dueInDays = Math.max(1, dagarTill(invoice.dueDate));
  const quoteLockedNote = invoice.quoteId
    ? " Den godkända offerten är låst – ändringar gäller bara den här fakturan."
    : "";

  return (
    <div className="animate-fade-up">
      <Link
        href={`/pengar/fakturor/${invoice.id}` as never}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" /> Faktura #{invoice.number}
      </Link>
      <PageHeader
        title={`Redigera faktura #${invoice.number}`}
        subtitle={`Utkast till ${customer.name}.${quoteLockedNote}`}
      />
      <InvoiceForm
        customers={customers}
        defaultCustomerId={invoice.customerId}
        defaultLateInterestRate={db().settings.lateInterestRate}
        invoiceId={invoice.id}
        initial={{
          lines: invoice.lines,
          rot: invoice.rot,
          dueInDays,
          lateInterestRate: invoice.lateInterestRate,
        }}
      />
    </div>
  );
}
