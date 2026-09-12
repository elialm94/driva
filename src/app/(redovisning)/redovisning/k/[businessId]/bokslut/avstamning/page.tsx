import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/bokforing-widgets";
import { AvstamningView, avstamningFiscalYear } from "@/components/avstamning-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";
import { wsHref } from "@/lib/accounting-workspace/shared";

export const metadata = { title: "Avstämning" };

export default async function AccountantAvstamningPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const ws = await loadPortfolioWorkspace(businessId);
  const fy = avstamningFiscalYear();

  return (
    <div>
      <PageHeader
        title={fy ? `Avstämning ${fy.label}` : "Avstämning"}
        subtitle={
          fy
            ? "Ett saldo är trovärdigt först när något utanför bokföringen säger samma sak."
            : "Balanskontona mot sina underlag."
        }
        actions={<PrintButton />}
      />
      <AvstamningView hrefFor={(href) => wsHref(ws, href)} />
    </div>
  );
}
