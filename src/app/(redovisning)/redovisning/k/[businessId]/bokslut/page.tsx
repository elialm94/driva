import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/bokforing-widgets";
import { BokslutView } from "@/components/bokslut-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";
import { wsHref, wsReadOnly } from "@/lib/accounting-workspace/shared";

export const metadata = { title: "Bokslut" };

export default async function AccountantBokslutPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ ar?: string }>;
}) {
  const [{ businessId }, { ar }] = await Promise.all([params, searchParams]);
  const ws = await loadPortfolioWorkspace(businessId);

  return (
    <div>
      <PageHeader
        title="Bokslut"
        subtitle="Ferva kontrollerar allt som går att kontrollera automatiskt – här syns bara det som faktiskt behöver någon."
        actions={<PrintButton />}
      />
      <BokslutView
        base={`${ws.basePath}/bokslut`}
        hrefFor={(href) => wsHref(ws, href)}
        businessId={ws.actionBusinessId}
        readOnly={wsReadOnly(ws, "year_end")}
        selectedYearParam={ar}
      />
    </div>
  );
}
