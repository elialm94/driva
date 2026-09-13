import type { ReactNode } from "react";
import { BokforingAdvancedTabs } from "@/components/bokforing-advanced-nav";
import { WorkspaceLinkScope } from "@/components/accounting-workspace/workspace-link-scope";
import { accountantStatusText } from "@/components/accountant-workspace";
import { PageHeader } from "@/components/ui";
import { bookkeepingHasPayroll } from "@/lib/accounting/bookkeeping-mode";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";
import { loadAccountantClientPage } from "@/lib/collaboration/client-page";

/**
 * Klientens arbetsyta på konsultytan: SAMMA flikrad och SAMMA sidor som
 * ägarens redovisningsvy under /bokforing, bara under en annan basväg.
 * Flikraden lever i layouten så att den inte monteras om vid flikbyte.
 */
export default async function AccountantClientLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const ws = await loadPortfolioWorkspace(businessId);
  const { access, snap } = await loadAccountantClientPage(businessId);

  return (
    <WorkspaceLinkScope basePath={ws.basePath}>
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
        <BokforingAdvancedTabs
          initialMode="avancerat"
          hasPayroll={bookkeepingHasPayroll()}
          showYearEnd
          basePath={ws.basePath}
          allowModeToggle={false}
        />
        {children}
        {access.role === "auditor" ? (
          <p className="mt-6 text-[12px] text-muted">Revisor – endast läsning. Ändringar är blockerade.</p>
        ) : null}
      </div>
    </WorkspaceLinkScope>
  );
}
