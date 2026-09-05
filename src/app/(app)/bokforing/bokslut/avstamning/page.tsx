import { PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { PrintButton } from "@/components/bokforing-widgets";
import { AvstamningView, avstamningFiscalYear } from "@/components/avstamning-view";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Avstämning" };

export default async function AvstamningPage() {
  await ensurePageBusiness();
  const fy = avstamningFiscalYear();

  return (
    <div>
      <PageHeader
        back={<SmartBack />}
        title={fy ? `Avstämning ${fy.label}` : "Avstämning"}
        subtitle={
          fy
            ? "Ett saldo är trovärdigt först när något utanför bokföringen säger samma sak."
            : "Balanskontona mot sina underlag."
        }
        actions={<PrintButton />}
      />
      <AvstamningView />
    </div>
  );
}
