import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { PrintButton } from "@/components/bokforing-widgets";
import { Ink2View, ink2Applies } from "@/components/ink2-view";
import { ensurePageBusiness } from "@/lib/auth/session";
import { getFiscalYear } from "@/lib/accounting/fiscal";

export const metadata = { title: "INK2" };

export default async function Ink2Page(props: { params: Promise<{ fiscalYearId: string }> }) {
  await ensurePageBusiness();
  const { fiscalYearId } = await props.params;
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) notFound();

  if (!ink2Applies()) {
    return (
      <div>
        <PageHeader back={<SmartBack />} title={`INK2 ${fy.label}`} subtitle="Skattemässiga justeringar." />
        <Card className="px-6 py-5">
          <p className="text-[14px] leading-relaxed text-soft">
            INK2 är aktiebolagets deklaration. En enskild firma deklareras hos ägaren på NE-bilagan, med egenavgifter och
            räntefördelning i stället för bolagsskatt – det stöder Driva inte automatiskt ännu.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        back={<SmartBack />}
        title={`INK2 ${fy.label}`}
        subtitle="Varför skattens resultat inte är bokföringens."
        actions={<PrintButton />}
      />
      <Ink2View fy={fy} />
    </div>
  );
}
