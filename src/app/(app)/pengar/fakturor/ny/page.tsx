import { db } from "@/lib/store";
import { getInvoiceDefaults } from "@/lib/services/settings";
import { PageHeader } from "@/components/ui";
import { InvoiceForm } from "@/components/doc-form";
import { BackLink } from "@/components/back-link";
import { labelForHref, sanitizeReturnLabel, sanitizeReturnTo } from "@/lib/nav";

export const metadata = { title: "Ny faktura" };

export default async function NewInvoicePage(props: PageProps<"/pengar/fakturor/ny">) {
  const searchParams = await props.searchParams;
  const kund = typeof searchParams.kund === "string" ? searchParams.kund : undefined;
  const tillbaka = typeof searchParams.tillbaka === "string" ? sanitizeReturnTo(searchParams.tillbaka) : null;
  const tillbakaNamn =
    typeof searchParams.tillbakaNamn === "string" ? sanitizeReturnLabel(searchParams.tillbakaNamn) : null;
  const cancelHref = tillbaka ?? "/pengar?flik=fakturor";
  const cancelLabel = tillbaka ? (tillbakaNamn ?? labelForHref(tillbaka)) : "Fakturor";

  const customers = [...db().customers]
    .sort((a, b) => a.name.localeCompare(b.name, "sv"))
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
  const defaults = getInvoiceDefaults();

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<BackLink fallbackHref={cancelHref} fallbackLabel={cancelLabel} />}
        title="Ny faktura"
        subtitle="Tips: fakturor skapas oftast automatiskt från klara uppdrag eller från offertens betalningsplan."
      />
      <InvoiceForm
        customers={customers}
        defaultCustomerId={kund}
        defaultLateInterestRate={defaults.lateInterestRate}
        defaultPaymentTermsDays={defaults.paymentTermsDays}
        defaultVatRate={defaults.defaultVatRate}
        cancelHref={cancelHref}
        returnTo={tillbaka ?? undefined}
        returnLabel={tillbakaNamn ?? undefined}
      />
    </div>
  );
}
