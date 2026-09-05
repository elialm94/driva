import { Card, PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { PrintButton } from "@/components/bokforing-widgets";
import { BokslutsbilagorView, bilagorFiscalYear } from "@/components/bokslutsbilagor-view";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Bokslutsbilagor" };

export default async function BilagorPage() {
  await ensurePageBusiness();
  const fy = bilagorFiscalYear();

  if (!fy) {
    return (
      <div>
        <PageHeader back={<SmartBack />} title="Bokslutsbilagor" subtitle="Specifikationen bakom balanskontona." />
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
        back={<SmartBack />}
        title={`Bokslutsbilagor ${fy.label}`}
        subtitle="Ett saldo är ett tal. Bilagan är svaret på vad talet består av – det revisorn och Skatteverket frågar efter."
        actions={<PrintButton />}
      />
      <BokslutsbilagorView />
    </div>
  );
}
