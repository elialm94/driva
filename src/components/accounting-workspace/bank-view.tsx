import { PageHeader } from "@/components/ui";
import { BankWorkspace } from "@/components/bank-workspace";
import { isOwnerSurface, wsReadOnly, type AccountingWorkspace } from "@/lib/accounting-workspace/shared";

/** Bankvyn – samma register, matchning och regler på båda ytorna. */
export function BankView({
  ws,
  searchParams,
}: {
  ws: AccountingWorkspace;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const owner = isOwnerSurface(ws);
  return (
    <div>
      <PageHeader
        title="Bank"
        subtitle={
          owner
            ? "Transaktioner, matchning och regler. Banken bokförs här, inte under Ekonomi."
            : "Transaktioner, matchning och regler. Bankkopplingen sköter ägaren."
        }
      />
      <BankWorkspace
        searchParams={searchParams}
        readOnly={wsReadOnly(ws, "match_payment")}
        manageConnection={owner}
        basePath={ws.basePath}
      />
    </div>
  );
}
