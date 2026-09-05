import { notFound } from "next/navigation";
import { AccountantClientTabs } from "@/components/accountant-workspace";
import { Card, PageHeader } from "@/components/ui";
import { Ink2View, ink2Applies } from "@/components/ink2-view";
import { loadAccountantClientPage } from "@/lib/collaboration/client-page";
import { can } from "@/lib/collaboration/permissions";
import { getFiscalYear } from "@/lib/accounting/fiscal";

export const metadata = { title: "INK2" };

export default async function AccountantInk2Page({
  params,
}: {
  params: Promise<{ businessId: string; fiscalYearId: string }>;
}) {
  const { businessId, fiscalYearId } = await params;
  const { access, snap } = await loadAccountantClientPage(businessId);
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) notFound();

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={`INK2 ${fy.label}`}
        subtitle={`${snap.name} · varför skattens resultat inte är bokföringens.`}
      />
      <AccountantClientTabs businessId={businessId} active="bokslut" />
      {ink2Applies() ? (
        <Ink2View fy={fy} businessId={businessId} readOnly={!can(access.role, "prepare_filing")} />
      ) : (
        <Card className="px-6 py-5">
          <p className="text-[14px] leading-relaxed text-soft">
            INK2 är aktiebolagets deklaration. En enskild firma deklareras hos ägaren på NE-bilagan, med egenavgifter och
            räntefördelning i stället för bolagsskatt – det stöder Driva inte automatiskt ännu.
          </p>
        </Card>
      )}
    </div>
  );
}
