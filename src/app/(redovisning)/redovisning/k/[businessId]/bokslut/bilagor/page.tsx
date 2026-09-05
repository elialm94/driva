import { AccountantClientTabs } from "@/components/accountant-workspace";
import { PageHeader } from "@/components/ui";
import { BokslutsbilagorView, bilagorFiscalYear } from "@/components/bokslutsbilagor-view";
import { loadAccountantClientPage } from "@/lib/collaboration/client-page";
import { accountantHref } from "@/lib/collaboration/hrefs";
import { can } from "@/lib/collaboration/permissions";

export const metadata = { title: "Bokslutsbilagor" };

export default async function AccountantBilagorPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const { access, snap } = await loadAccountantClientPage(businessId);
  const fy = bilagorFiscalYear();

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={`${snap.name} – bokslutsbilagor${fy ? ` ${fy.label}` : ""}`}
        subtitle="Ett saldo är ett tal. Bilagan är svaret på vad talet består av – det revisorn och Skatteverket frågar efter."
      />
      <AccountantClientTabs businessId={businessId} active="bokslut" />
      <BokslutsbilagorView
        hrefFor={(href) => accountantHref(businessId, href)}
        businessId={businessId}
        readOnly={!can(access.role, "year_end")}
      />
    </div>
  );
}
