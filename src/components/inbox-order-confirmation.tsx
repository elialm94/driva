import { CheckCircle2, Circle, Minus, PackageCheck } from "lucide-react";
import type { InboxItem, PurchaseOrder } from "@/lib/types";
import type { WorkflowStep } from "@/lib/inbox/workflow";
import { attachmentIsViewable } from "@/lib/inbox/attachment-content";
import { datumTid } from "@/lib/format";
import { db } from "@/lib/store";
import { connectionLabel } from "@/lib/wholesalers/labels";
import { getPurchaseOrder } from "@/lib/services/purchase-orders";
import { orderReview } from "@/lib/services/purchase-order-confirmations";
import { getWholesalerConnection } from "@/lib/services/wholesalers";
import { getJob } from "@/lib/services/data";
import { Badge, Card, DemoTag } from "./ui";
import { AppLink } from "./app-link";
import { DocumentViewerButton } from "./document-viewer";
import { PurchaseOrderStatusBadge } from "./status";
import { LinkConfirmationButtons } from "./inbox-order-confirmation-actions";

function StepIcon({ state }: { state: WorkflowStep["state"] }) {
  if (state === "done") return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />;
  if (state === "na") return <Minus className="mt-0.5 size-4 shrink-0 text-muted" />;
  return <Circle className="mt-0.5 size-4 shrink-0 text-muted" />;
}

function orderSummary(order: PurchaseOrder) {
  const connection = getWholesalerConnection(order.connectionId);
  const job = getJob(order.jobId);
  return {
    order,
    wholesaler: connection ? connectionLabel(connection) : "Grossist",
    jobTitle: job?.title ?? "Uppdrag",
    href: `/uppdrag/${order.jobId}/bestallning/${order.id}`,
  };
}

/**
 * Inboxvy för en orderbekräftelse: mejlet, kopplad beställning eller val
 * bland kandidater. Inga fakturafält – bekräftelser är inte leverantörsfakturor.
 */
export function InboxOrderConfirmationBody({
  item,
  steps,
  display,
}: {
  item: InboxItem;
  steps: WorkflowStep[];
  display: { label: string; tone: "ok" | "warn" | "danger" | "info" | "neutral" };
}) {
  const linked = item.purchaseOrderId ? getPurchaseOrder(item.purchaseOrderId) : undefined;
  const candidates = (item.purchaseOrderCandidateIds ?? [])
    .map((id) => getPurchaseOrder(id))
    .filter((o): o is PurchaseOrder => Boolean(o))
    .map(orderSummary);
  // Utan kandidater: låt användaren välja bland skickade beställningar som
  // fortfarande väntar på svar.
  const fallback =
    !linked && candidates.length === 0
      ? (db().purchaseOrders ?? [])
          .filter((o) => o.status === "sent" || o.status === "partially_confirmed" || o.status === "needs_review")
          .slice()
          .sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""))
          .slice(0, 8)
          .map(orderSummary)
      : [];
  const review = linked ? orderReview(linked.id) : null;
  const linkedSummary = linked ? orderSummary(linked) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)] lg:items-start">
      <div className="space-y-4">
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[16px] font-semibold">{item.subject || "Orderbekräftelse"}</p>
              <p className="text-[13px] text-muted">
                Från {item.fromAddress}
                {linked?.sentSnapshot?.transport === "simulated" ? (
                  <>
                    {" "}
                    <DemoTag />
                  </>
                ) : null}
              </p>
            </div>
            <Badge tone={display.tone}>{display.label}</Badge>
          </div>
          <div className="mt-5 border-t border-line pt-4">
            <p className="mb-2 text-[13px] font-medium text-muted">Meddelande</p>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{item.textBody}</p>
          </div>
          {item.attachments.length > 0 ? (
            <div className="mt-5 border-t border-line pt-4">
              <p className="mb-2 text-[13px] font-medium text-muted">Dokument</p>
              <ul className="space-y-2">
                {item.attachments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 text-[14px] text-soft">
                    <span className="font-medium text-ink">{a.filename}</span>
                    {attachmentIsViewable(a) ? (
                      <DocumentViewerButton href={`/api/inbox/bilaga/${item.id}/${a.id}`} filename={a.filename} label="Visa" />
                    ) : (
                      <span className="text-[12px] text-muted">Lästes av när mejlet kom in.</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      </div>

      <div className="space-y-4">
        {linked && linkedSummary && review ? (
          <Card className="p-5" data-inbox-linked-order>
            <p className="text-[13px] font-medium text-muted">Kopplad beställning</p>
            <AppLink
              href={linkedSummary.href}
              originLabel="Inkorgspost"
              className="mt-2 flex items-start gap-2.5 rounded-xl border border-line/80 px-3 py-2.5 hover:bg-canvas/60"
            >
              <PackageCheck className="mt-0.5 size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-ink">
                  {linked.reference} · {linkedSummary.wholesaler}
                </span>
                <span className="block text-[13px] text-soft">{linkedSummary.jobTitle}</span>
                <span className="mt-1 block text-[13px] text-soft">{review.headline}</span>
              </span>
              <PurchaseOrderStatusBadge status={linked.status} />
            </AppLink>
            {review.bullets.length > 0 ? (
              <ul className="mt-2 space-y-0.5 text-[13px] text-soft">
                {review.bullets.map((b) => (
                  <li key={b}>· {b}</li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : (
          <Card className="p-5" data-inbox-order-candidates>
            <p className="text-[13px] font-medium text-muted">
              {candidates.length > 0 ? "Vilken beställning gäller svaret?" : "Ingen beställning kopplad"}
            </p>
            <p className="mt-1 text-[13px] text-soft">
              {candidates.length > 0
                ? "Vi kunde inte avgöra det säkert. Välj rätt beställning så stäms bekräftelsen av mot den."
                : fallback.length > 0
                  ? "Välj beställningen som svaret gäller."
                  : "Det finns ingen skickad beställning som väntar på svar."}
            </p>
            <LinkConfirmationButtons
              inboxItemId={item.id}
              options={(candidates.length > 0 ? candidates : fallback).map((c) => ({
                orderId: c.order.id,
                label: `${c.order.reference} · ${c.wholesaler}`,
                detail: `${c.jobTitle}${c.order.sentAt ? ` · skickad ${datumTid(c.order.sentAt)}` : ""}`,
              }))}
            />
          </Card>
        )}

        <Card className="p-5">
          <p className="text-[13px] font-medium text-muted">Status</p>
          <ul className="mt-3 space-y-3">
            {steps.map((step) => (
              <li key={step.key} className="flex items-start gap-2.5">
                <StepIcon state={step.state} />
                <div>
                  <p className={`text-[14px] font-medium ${step.state === "na" ? "text-muted" : "text-ink"}`}>{step.label}</p>
                  {step.detail ? <p className="text-[12.5px] text-muted">{step.detail}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
