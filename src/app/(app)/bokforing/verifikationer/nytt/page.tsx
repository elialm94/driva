import { PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { ManualVerificationForm } from "@/components/manual-verification-form";
import { accountPickerOptions } from "@/lib/services/manual-verification";
import { lockedThrough } from "@/lib/accounting/fiscal";
import { nextDay, todayDate } from "@/lib/accounting/dates";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Nytt verifikat" };

export default async function NyttVerifikatPage() {
  await ensurePageBusiness();
  const lock = lockedThrough();
  const today = todayDate();
  const firstOpen = lock ? nextDay(lock) : undefined;

  return (
    <div>
      <PageHeader
        back={<SmartBack />}
        title="Nytt verifikat"
        subtitle="Bokför en händelse som inte kommer från en faktura, ett kvitto eller banken. Verifikatet får serie M och låses när det bokförts."
      />
      <ManualVerificationForm
        accounts={accountPickerOptions()}
        today={firstOpen && firstOpen > today ? firstOpen : today}
        lockedThrough={lock}
        firstOpenDate={firstOpen}
      />
    </div>
  );
}
