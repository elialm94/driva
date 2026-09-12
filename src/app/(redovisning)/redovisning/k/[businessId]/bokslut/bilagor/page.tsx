import { Card, PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/bokforing-widgets";
import { BokslutsbilagorView, bilagorFiscalYear } from "@/components/bokslutsbilagor-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";
import { wsHref, wsReadOnly } from "@/lib/accounting-workspace/shared";

export const metadata = { title: "Bokslutsbilagor" };

export default async function AccountantBilagorPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const ws = await loadPortfolioWorkspace(businessId);
  const fy = bilagorFiscalYear();

  if (!fy) {
    return (
      <div>
        <PageHeader title="Bokslutsbilagor" subtitle="Specifikationen bakom balanskontona." />
        <Card className="px-6 py-5">
          <p className="text-[14px] text-soft">
            Alla räkenskapsår är stängda. Ett nytt år öppnas automatiskt vid nästa bokförda händelse.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={`Bokslutsbilagor ${fy.label}`}
        subtitle="Ett saldo är ett tal. Bilagan är svaret på vad talet består av – det revisorn och Skatteverket frågar efter."
        actions={<PrintButton />}
      />
      <BokslutsbilagorView
        hrefFor={(href) => wsHref(ws, href)}
        businessId={ws.actionBusinessId}
        readOnly={wsReadOnly(ws, "year_end")}
      />
    </div>
  );
}
