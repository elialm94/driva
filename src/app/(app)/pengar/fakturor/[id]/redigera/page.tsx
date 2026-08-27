import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/store";
import { getInvoice, requireCustomer } from "@/lib/services/data";
import { dagarTill } from "@/lib/format";
import { invoiceHeading, invoiceNumberLabel } from "@/lib/invoices/display";
import { PageHeader } from "@/components/ui";
import { InvoiceForm } from "@/components/doc-form";
import { invoiceHasDocumentedTaxReductionAcceptance } from "@/lib/services/invoices";
import { BackLink } from "@/components/back-link";
import { hrefWithNav, sanitizeReturnLabel, sanitizeReturnTo } from "@/lib/nav";

export const metadata = { title: "Redigera faktura" };

export default async function EditInvoicePage(props: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
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
  const returnTo = typeof searchParams.tillbaka === "string" ? sanitizeReturnTo(searchParams.tillbaka) : undefined;
  const returnLabel =
    typeof searchParams.tillbakaNamn === "string" ? sanitizeReturnLabel(searchParams.tillbakaNamn) ?? undefined : undefined;
  const invoiceHref = hrefWithNav(`/pengar/fakturor/${invoice.id}`, { returnTo, returnLabel });

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<BackLink fallbackHref={invoiceHref} fallbackLabel={invoiceHeading(invoice)} ignoreReturnTo />}
        crumbs={[
          { href: "/pengar", label: "Pengar" },
          { href: "/pengar?flik=fakturor", label: "Fakturor" },
          { href: invoiceHref, label: invoiceNumberLabel(invoice) },
          { label: "Redigera" },
        ]}
        title={`Redigera ${invoiceNumberLabel(invoice) === "Utkast" ? "fakturautkast" : `faktura ${invoiceNumberLabel(invoice)}`}`}
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
          serviceDate: invoice.serviceDate,
        }}
        documentedTaxReductionAcceptance={invoiceHasDocumentedTaxReductionAcceptance(invoice)}
        cancelHref={invoiceHref}
        returnTo={returnTo ?? undefined}
        returnLabel={returnLabel}
      />
    </div>
  );
}
