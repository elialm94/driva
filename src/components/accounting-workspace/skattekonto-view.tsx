import { PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { PrintButton } from "@/components/bokforing-widgets";
import { SkattekontoPanel } from "@/components/skattekonto-panel";
import { skattekontoViewModel } from "@/lib/accounting-workspace/view-models";
import { isOwnerSurface, type AccountingWorkspace } from "@/lib/accounting-workspace/shared";

export function SkattekontoView({ ws }: { ws: AccountingWorkspace }) {
  const vm = skattekontoViewModel();
  return (
    <div>
      <PageHeader
        back={isOwnerSurface(ws) ? <SmartBack /> : undefined}
        title="Skattekonto"
        subtitle={
          isOwnerSurface(ws)
            ? "Bolagets konto hos Skatteverket. Moms, F-skatt och arbetsgivaravgifter dras härifrån, och du fyller på det från banken."
            : "Bolagets konto hos Skatteverket. Moms, F-skatt och arbetsgivaravgifter dras härifrån; ägaren fyller på det från banken."
        }
        actions={vm.hasRows ? <PrintButton /> : undefined}
      />
      <SkattekontoPanel />
    </div>
  );
}
