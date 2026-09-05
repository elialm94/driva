import { PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { PeriodstangningView } from "@/components/periodstangning-view";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Periodstängning" };

export default async function PeriodstangningPage() {
  await ensurePageBusiness();
  return (
    <div>
      <PageHeader
        back={<SmartBack />}
        title="Periodstängning"
        subtitle="Stäng en månad när den är klar, så står den kvar."
      />
      <PeriodstangningView />
    </div>
  );
}
