import { ReceiptText } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { BokforingAdvancedTabs } from "@/components/bokforing-advanced-nav";
import { VerifikationerView } from "@/components/verifikationer-view";
import { listVerificationViews } from "@/lib/services/verification-correction";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Verifikationer" };

const PAGE_SIZE = 100;

export default async function VerifikationerPage({
  searchParams,
}: {
  searchParams: Promise<{ sida?: string; v?: string }>;
}) {
  await ensurePageBusiness();
  const params = await searchParams;
  const all = listVerificationViews();
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(params.sida) || 1), totalPages);
  const views = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<SmartBack />}
        title="Verifikationer"
        subtitle={`${all.length} bokförda händelser. Varje verifikation är låst när den bokförts – rättelser blir nya verifikationer.`}
      />
      <BokforingAdvancedTabs />

      {all.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="Inga verifikationer ännu"
          text="När du skickar fakturor eller får utgifter bokförs de automatiskt här."
        />
      ) : (
        <VerifikationerView
          initial={views}
          page={page}
          totalPages={totalPages}
          total={all.length}
          initialOpenId={typeof params.v === "string" ? params.v : undefined}
        />
      )}
    </div>
  );
}
