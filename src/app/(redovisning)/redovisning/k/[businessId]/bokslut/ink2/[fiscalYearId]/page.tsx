import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Ink2View, ink2Applies } from "@/components/ink2-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";
import { wsReadOnly } from "@/lib/accounting-workspace/shared";
import { getFiscalYear } from "@/lib/accounting/fiscal";

export const metadata = { title: "INK2" };

export default async function AccountantInk2Page({
  params,
}: {
  params: Promise<{ businessId: string; fiscalYearId: string }>;
}) {
  const { businessId, fiscalYearId } = await params;
  const ws = await loadPortfolioWorkspace(businessId);
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) notFound();

  return (
    <div>
      <PageHeader title={`INK2 ${fy.label}`} subtitle="Varför skattens resultat inte är bokföringens." />
      {ink2Applies() ? (
        <Ink2View fy={fy} businessId={ws.actionBusinessId} readOnly={wsReadOnly(ws, "prepare_filing")} />
      ) : (
        <Card className="px-6 py-5">
          <p className="text-[14px] leading-relaxed text-soft">
            INK2 är aktiebolagets deklaration. En enskild firma deklareras hos ägaren på NE-bilagan, med egenavgifter och
            räntefördelning i stället för bolagsskatt – det stöder Ferva inte automatiskt ännu.
          </p>
        </Card>
      )}
    </div>
  );
}
