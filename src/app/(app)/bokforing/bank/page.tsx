import { PageHeader } from "@/components/ui";
import { BankWorkspace } from "@/components/bank-workspace";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Bank" };

export default async function BokforingBankPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await ensurePageBusiness();
  const params = await searchParams;
  return (
    <div>
      <PageHeader
        title="Bank"
        subtitle="Transaktioner, matchning och regler. Banken bokförs här, inte under Ekonomi."
      />
      <BankWorkspace searchParams={params} />
    </div>
  );
}
