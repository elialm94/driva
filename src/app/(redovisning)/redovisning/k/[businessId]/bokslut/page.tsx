import { AccountantClientTabs, accountantStatusText } from "@/components/accountant-workspace";
import { PageHeader } from "@/components/ui";
import { BokslutView } from "@/components/bokslut-view";
import { loadAccountantClientPage } from "@/lib/collaboration/client-page";
import { accountantHref } from "@/lib/collaboration/hrefs";
import { can } from "@/lib/collaboration/permissions";

export const metadata = { title: "Bokslut" };

export default async function AccountantBokslutPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const { access, snap } = await loadAccountantClientPage(businessId);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={snap.name}
        subtitle={accountantStatusText({
          bookedThrough: snap.bookedThrough,
          bankOk: snap.bankOk,
          bankUnexplained: snap.bankUnexplained,
          nextVatDue: snap.nextVat?.dueDate,
        })}
      />
      <AccountantClientTabs businessId={businessId} active="bokslut" />
      <BokslutView
        base={`/redovisning/k/${businessId}/bokslut`}
        hrefFor={(href) => accountantHref(businessId, href)}
        businessId={businessId}
        readOnly={!can(access.role, "year_end")}
      />
    </div>
  );
}
