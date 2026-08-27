import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/store";
import { PageHeader } from "@/components/ui";
import { InvoiceForm } from "@/components/doc-form";

export const metadata = { title: "Ny faktura" };

export default async function NewInvoicePage(props: PageProps<"/pengar/fakturor/ny">) {
  const searchParams = await props.searchParams;
  const kund = typeof searchParams.kund === "string" ? searchParams.kund : undefined;

  const customers = [...db().customers]
    .sort((a, b) => a.name.localeCompare(b.name, "sv"))
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));

  return (
    <div className="animate-fade-up">
      <Link href="/pengar?flik=fakturor" className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Fakturor
      </Link>
      <PageHeader
        title="Ny faktura"
        subtitle="Tips: fakturor skapas oftast automatiskt från klara uppdrag eller från offertens betalningsplan."
      />
      <InvoiceForm
        customers={customers}
        defaultCustomerId={kund}
        defaultLateInterestRate={db().settings.lateInterestRate}
      />
    </div>
  );
}
