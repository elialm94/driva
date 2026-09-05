import { PackageCheck } from "lucide-react";
import type { JobPurchaseOrderRow } from "@/lib/services/job-wholesalers";
import { datumKort } from "@/lib/format";
import { AppLink } from "./app-link";
import { SectionTitle } from "./ui";
import { PurchaseOrderStatusBadge } from "./status";

/**
 * Kompakt sektion på uppdraget – renderas bara när det finns varukorgar
 * eller beställningar (aldrig en tom stor sektion för alla användare).
 */
export function PurchaseOrdersSection({
  jobId,
  jobTitle,
  rows,
}: {
  jobId: string;
  jobTitle: string;
  rows: JobPurchaseOrderRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-8" data-purchase-orders-section>
      <SectionTitle>Materialbeställningar</SectionTitle>
      <ul className="divide-y divide-line/70 rounded-2xl border border-line/80">
        {rows.map(({ order, wholesalerName, lineCount, review }) => (
          <li key={order.id}>
            <AppLink
              href={`/uppdrag/${jobId}/bestallning/${order.id}`}
              originLabel={jobTitle}
              className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-canvas/60"
              aria-label={`Beställning ${order.reference} till ${wholesalerName}`}
            >
              <PackageCheck className="mt-0.5 size-4 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-ink">
                  {order.reference} · {wholesalerName}
                  <span className="ml-2 text-[13px] font-normal text-muted">
                    {lineCount} {lineCount === 1 ? "artikel" : "artiklar"}
                    {order.sentAt ? ` · skickad ${datumKort(order.sentAt)}` : ""}
                  </span>
                </p>
                {order.status !== "draft" ? (
                  <p className="mt-0.5 text-[13px] text-soft">{review.headline}</p>
                ) : (
                  <p className="mt-0.5 text-[13px] text-soft">Varukorg – inte skickad än</p>
                )}
                {review.bullets.length > 0 && order.status !== "draft" ? (
                  <ul className="mt-1 space-y-0.5 text-[13px] text-soft">
                    {review.bullets.slice(0, 3).map((b) => (
                      <li key={b}>· {b}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="shrink-0">
                <PurchaseOrderStatusBadge status={order.status} />
              </div>
            </AppLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
