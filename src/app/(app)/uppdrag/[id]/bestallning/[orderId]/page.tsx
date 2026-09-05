import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, Mail } from "lucide-react";
import { ensurePageBusiness } from "@/lib/auth/session";
import { getJob } from "@/lib/services/data";
import { getPurchaseOrder, purchaseOrderLines } from "@/lib/services/purchase-orders";
import { confirmationsForOrder, orderReview } from "@/lib/services/purchase-order-confirmations";
import { getWholesalerConnection } from "@/lib/services/wholesalers";
import { db } from "@/lib/store";
import { datumKort, datumTid } from "@/lib/format";
import { formatOre } from "@/lib/wholesalers/money";
import { CUSTOMER_PRICE_SOURCE_LABELS, DELIVERY_MODE_LABELS, DEVIATION_LABELS, connectionLabel } from "@/lib/wholesalers/labels";
import { PURCHASE_ORDER_CONFIRMATION_STATUS } from "@/lib/status-labels";
import { Badge, Breadcrumbs, Card, DemoTag, SectionTitle } from "@/components/ui";
import { PurchaseOrderStatusBadge } from "@/components/status";
import { SmartBack } from "@/components/back-link";
import { AppLink } from "@/components/app-link";
import {
  CancelOrderButton,
  ConfirmationActions,
  CustomerPriceField,
  WholesalerOrderNumberField,
} from "@/components/purchase-order-actions";
import type { PurchaseOrderConfirmation, PurchaseOrderLine } from "@/lib/types";

export async function generateMetadata(props: PageProps<"/uppdrag/[id]/bestallning/[orderId]">) {
  await ensurePageBusiness();
  const { orderId } = await props.params;
  const order = getPurchaseOrder(orderId);
  return { title: order ? `Beställning ${order.reference}` : "Materialbeställning" };
}

function lineState(line: PurchaseOrderLine, confirmations: PurchaseOrderConfirmation[]) {
  // Senaste bekräftelseraden som pekar på orderraden vinner (delbekräftelser
  // kompletterar varandra).
  for (const c of confirmations.slice().reverse()) {
    if (c.status === "dismissed") continue;
    const hit = c.lines.find((l) => l.orderLineId === line.id);
    if (hit) return hit;
  }
  return null;
}

export default async function BestallningPage(props: PageProps<"/uppdrag/[id]/bestallning/[orderId]">) {
  await ensurePageBusiness();
  const { id, orderId } = await props.params;
  const job = getJob(id);
  const order = getPurchaseOrder(orderId);
  if (!job || !order || order.jobId !== job.id) notFound();
  const connection = getWholesalerConnection(order.connectionId);
  const wholesalerName = connection ? connectionLabel(connection) : "Grossist";
  const lines = purchaseOrderLines(order.id);
  const confirmations = confirmationsForOrder(order.id);
  const review = orderReview(order.id);
  const snapshot = order.sentSnapshot;
  const demo = snapshot?.transport === "simulated";
  const jobEntries = new Map((db().jobWorkEntries ?? []).map((e) => [e.id, e]));
  const mailto = connection
    ? `mailto:${connection.orderEmail}?subject=${encodeURIComponent(`Ang. beställning ${order.reference}`)}`
    : null;
  const canCancel = order.status === "sent" || order.status === "draft";

  return (
    <div className="animate-fade-up">
      <div className="mb-2.5">
        <SmartBack />
      </div>
      <Breadcrumbs
        items={[
          { href: "/uppdrag", label: "Uppdrag" },
          { href: `/uppdrag/${job.id}`, label: job.title },
          { label: `Beställning ${order.reference}` },
        ]}
      />

      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[26px] font-semibold tracking-tight">Beställning {order.reference}</h1>
          <PurchaseOrderStatusBadge status={order.status} />
          {demo ? <DemoTag /> : null}
        </div>
        <p className="mt-1 text-[15px] text-soft">
          {wholesalerName}
          {connection ? ` · kundnummer ${connection.customerNumber}` : ""}
          {order.sentAt ? ` · skickad ${datumTid(order.sentAt)}` : " · inte skickad än"}
        </p>
        {order.status !== "draft" ? (
          <div className="mt-2">
            <WholesalerOrderNumberField orderId={order.id} current={order.wholesalerOrderNumber ?? null} />
          </div>
        ) : null}
      </div>

      {order.status === "draft" ? (
        <Card className="mb-6 p-5 text-[14px] text-soft">
          Det här är en varukorg som inte skickats än. Öppna{" "}
          <AppLink href={`/uppdrag/${job.id}`} originLabel={`Beställning ${order.reference}`} className="text-accent underline">
            uppdraget
          </AppLink>{" "}
          och tryck på <span className="font-medium text-ink">Lägg till material</span> för att fortsätta.
          <div className="mt-3">
            <CancelOrderButton orderId={order.id} wholesalerName={wholesalerName} />
          </div>
        </Card>
      ) : (
        <Card className="mb-6 p-5">
          <p className="flex items-start gap-2 text-[16px] font-semibold text-ink">
            {order.status === "confirmed" ? (
              <CheckCircle2 className="mt-0.5 size-5 text-ok" />
            ) : order.status === "sent" ? (
              <Mail className="mt-0.5 size-5 text-info" />
            ) : (
              <AlertTriangle className="mt-0.5 size-5 text-warn" />
            )}
            {review.headline}
          </p>
          {review.bullets.length > 0 ? (
            <ul className="mt-2 space-y-1 text-[14px] text-soft">
              {review.bullets.map((b) => (
                <li key={b}>· {b}</li>
              ))}
            </ul>
          ) : null}
          {order.status === "sent" ? (
            <p className="mt-2 text-[13px] text-muted">
              Grossisten svarar till din Ferva-inbox. Bekräftelsen matchas mot referensen {order.reference}.
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {review.pendingConfirmationIds[0] ? (
              <ConfirmationActions confirmationId={review.pendingConfirmationIds[0]} canApprove canDismiss={false} />
            ) : null}
            {mailto ? (
              <a href={mailto} className="inline-flex h-10 items-center rounded-xl px-4 text-sm font-medium text-soft hover:bg-ink/5 hover:text-ink">
                Kontakta grossisten
              </a>
            ) : null}
            {canCancel ? <CancelOrderButton orderId={order.id} wholesalerName={wholesalerName} /> : null}
          </div>
        </Card>
      )}

      <SectionTitle>Artiklar</SectionTitle>
      <Card className="mb-8 overflow-hidden">
        <ul className="divide-y divide-line/70" data-purchase-order-lines>
          {(snapshot?.lines ?? lines.map((l) => ({ ...l, lineId: l.id }))).map((snapLine) => {
            const line = lines.find((l) => l.id === snapLine.lineId);
            if (!line) return null;
            const state = lineState(line, confirmations);
            const entry = line.jobWorkEntryId ? jobEntries.get(line.jobWorkEntryId) : undefined;
            const invoiced = Boolean(entry?.invoiceId);
            const customerKr = line.customerUnitPriceOre != null ? Math.round(line.customerUnitPriceOre / 100) : null;
            return (
              <li key={line.id} className="px-5 py-3.5" data-purchase-order-line>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-ink">
                      {snapLine.name}
                      {state?.substituteName ? (
                        <span className="ml-2 text-[13px] font-normal text-warn">→ ersatt med {state.substituteName}</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-muted">
                      {snapLine.articleNumber ? `Art.nr ${snapLine.articleNumber} · ` : ""}
                      Beställt {snapLine.qty.toLocaleString("sv-SE")} {snapLine.unit}
                      {state && state.confirmedQty != null && state.confirmedQty !== snapLine.qty
                        ? ` · bekräftat ${state.confirmedQty.toLocaleString("sv-SE")} ${snapLine.unit}`
                        : state && !state.deviations.includes("missing")
                          ? " · bekräftat"
                          : ""}
                      {state?.backordered ? " · restnoterat" : ""}
                      {state?.backorderDate ? ` · väntas ${datumKort(state.backorderDate)}` : ""}
                    </p>
                    <p className="mt-1 text-[13px] tabular text-soft">
                      Inköp{" "}
                      {state?.unitCostOre != null ? (
                        <span className="text-ink">
                          {formatOre(state.unitCostOre)}/{snapLine.unit}
                          {snapLine.unitCostOre != null && snapLine.unitCostOre !== state.unitCostOre ? (
                            <span className="text-muted"> (förväntat {formatOre(snapLine.unitCostOre)})</span>
                          ) : null}
                        </span>
                      ) : snapLine.unitCostOre != null ? (
                        <span className="text-ink">{formatOre(snapLine.unitCostOre)}/{snapLine.unit} förväntat</span>
                      ) : (
                        <span className="text-muted">saknas</span>
                      )}
                      {" · "}
                      <span className="text-muted">{CUSTOMER_PRICE_SOURCE_LABELS[line.customerPriceSource]}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {state ? (
                      <Badge
                        tone={
                          state.deviations.length === 0 ? "ok" : state.deviations.includes("missing") ? "danger" : "warn"
                        }
                      >
                        {state.deviations.length === 0 ? "Bekräftad" : state.deviations.map((d) => DEVIATION_LABELS[d]).join(", ")}
                      </Badge>
                    ) : order.status !== "draft" ? (
                      <Badge tone="neutral">Inväntar svar</Badge>
                    ) : null}
                    {order.status !== "draft" ? (
                      <CustomerPriceField lineId={line.id} unit={snapLine.unit} currentKr={customerKr} invoiced={invoiced} />
                    ) : null}
                    {entry ? (
                      <span className="text-[12px] text-muted">
                        {invoiced ? "Fakturerad materialrad" : "På uppdragets material"}
                      </span>
                    ) : order.status === "confirmed" || order.status === "partially_confirmed" ? (
                      customerKr == null ? (
                        <span className="text-[12px] text-warn">Läggs på uppdraget när kundpris finns</span>
                      ) : null
                    ) : null}
                  </div>
                </div>
                {snapLine.note ? <p className="mt-1 text-[13px] italic text-muted">”{snapLine.note}”</p> : null}
              </li>
            );
          })}
        </ul>
      </Card>

      {snapshot ? (
        <>
          <SectionTitle>Vad grossisten fick</SectionTitle>
          <Card className="mb-8 p-5 text-[14px] text-soft">
            <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-[auto_1fr]">
              <dt className="text-muted">Skickat till</dt>
              <dd className="text-ink">{snapshot.to}</dd>
              <dt className="text-muted">{DELIVERY_MODE_LABELS[snapshot.delivery.mode]}</dt>
              <dd className="text-ink">
                {snapshot.delivery.mode === "pickup" ? snapshot.delivery.store : snapshot.delivery.address}
                {snapshot.delivery.requestedDate ? ` · önskat ${datumKort(snapshot.delivery.requestedDate)}` : ""}
              </dd>
              <dt className="text-muted">Beställare</dt>
              <dd className="text-ink">
                {snapshot.orderer.name}
                {snapshot.orderer.phone ? ` · ${snapshot.orderer.phone}` : ""}
              </dd>
              {snapshot.message ? (
                <>
                  <dt className="text-muted">Meddelande</dt>
                  <dd className="whitespace-pre-wrap text-ink">{snapshot.message}</dd>
                </>
              ) : null}
            </dl>
            <p className="mt-3 text-[12.5px] text-muted">
              Den skickade beställningen ändras inte i efterhand. Behöver du mer material gör du en ny beställning från
              uppdraget.
            </p>
          </Card>
        </>
      ) : null}

      {confirmations.length > 0 ? (
        <>
          <SectionTitle>Svar från grossisten</SectionTitle>
          <div className="mb-8 space-y-3">
            {confirmations
              .slice()
              .reverse()
              .map((c) => (
                <Card key={c.id} className="p-5" data-purchase-order-confirmation={c.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[14px] font-medium text-ink">
                      {datumTid(c.receivedAt)}
                      {c.wholesalerOrderNumber ? ` · ordernummer ${c.wholesalerOrderNumber}` : ""}
                    </p>
                    <Badge tone={PURCHASE_ORDER_CONFIRMATION_STATUS[c.status].tone}>
                      {PURCHASE_ORDER_CONFIRMATION_STATUS[c.status].label}
                    </Badge>
                  </div>
                  {c.deviations.length > 0 ? (
                    <ul className="mt-2 space-y-0.5 text-[13px] text-soft">
                      {c.deviations.map((d) => (
                        <li key={d}>· {DEVIATION_LABELS[d]}</li>
                      ))}
                      {c.deliveryDate ? <li>· Leverans {datumKort(c.deliveryDate)}</li> : null}
                    </ul>
                  ) : (
                    <p className="mt-2 text-[13px] text-soft">Alla rader stämmer med beställningen.</p>
                  )}
                  {c.message ? <p className="mt-2 whitespace-pre-wrap text-[13px] italic text-muted">”{c.message}”</p> : null}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <ConfirmationActions confirmationId={c.id} canApprove={c.status === "needs_review"} canDismiss={c.status === "needs_review"} />
                    {c.inboxItemId ? (
                      <AppLink href={`/inbox/${c.inboxItemId}`} originLabel={`Beställning ${order.reference}`} className="text-[13px] text-accent underline-offset-2 hover:underline">
                        Visa mejlet i inboxen
                      </AppLink>
                    ) : null}
                  </div>
                </Card>
              ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
