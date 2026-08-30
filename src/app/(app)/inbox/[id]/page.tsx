import { notFound, redirect } from "next/navigation";
import { Paperclip } from "lucide-react";
import { getInboxView } from "@/lib/services/inbox";
import { getJob } from "@/lib/services/data";
import { latestPaymentForInvoice, supplierPaymentConfirmRows } from "@/lib/services/supplier-payments";
import {
  paymentDetailsInfo,
  provenanceLabel,
  supplierDetailsRequestInfo,
} from "@/lib/services/payment-details";
import { datumKort, datumTid, kr } from "@/lib/format";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { InboxMailActions } from "@/components/inbox-mail-actions";
import { SendToBankButton } from "@/components/send-to-bank";
import {
  SupplierPaymentDetailsPanel,
  type PaymentDetailsPanelProps,
} from "@/components/payment-details-actions";
import { kunderInboxHref } from "@/lib/nav";
import { ensurePageBusiness } from "@/lib/auth/session";
import { db } from "@/lib/store";

export const metadata = { title: "Inbox" };

export default async function InboxDetailPage(props: { params: Promise<{ id: string }> }) {
  await ensurePageBusiness();
  const { id } = await props.params;
  const view = getInboxView(id);
  if (!view) {
    const job = getJob(id);
    if (job) redirect(`/uppdrag/${job.id}`);
    notFound();
  }

  const { item, display } = view;
  const invoice = item.supplierInvoiceId
    ? db().supplierInvoices.find((s) => s.id === item.supplierInvoiceId)
    : undefined;
  const payment = invoice ? latestPaymentForInvoice(invoice.id) : undefined;
  const canCreateExpense =
    item.documentType === "kvitto" &&
    item.parsedAmount != null &&
    item.parsedVatAmount != null &&
    Boolean(item.parsedSupplier) &&
    !item.expenseId;
  // Betalningsuppgifternas tillstånd styr både panelen och Skicka-knappen:
  // endast VERIFIED är betalbart (samma spärr som submitSupplierPayment).
  const details = invoice && invoice.status !== "betald" ? paymentDetailsInfo(invoice) : undefined;
  const canSend =
    invoice &&
    invoice.accountingStatus === "bokford" &&
    invoice.status !== "betald" &&
    details?.cause === "VERIFIED" &&
    payment?.status !== "PAID" &&
    payment?.status !== "SUBMITTED_TO_BANK" &&
    payment?.status !== "SCHEDULED" &&
    payment?.status !== "AWAITING_APPROVAL" &&
    !payment?.destinationChanged;

  let detailsPanel: PaymentDetailsPanelProps | null = null;
  if (invoice && details && details.cause !== "VERIFIED") {
    const request = details.cause === "MISSING" ? supplierDetailsRequestInfo(invoice) : undefined;
    detailsPanel = {
      supplierInvoiceId: invoice.id,
      supplier: invoice.supplier,
      amountText: kr(invoice.amount),
      cause: details.cause,
      candidateAccount: details.candidate?.account,
      candidateOcr: details.candidate?.ocr,
      currentAccount: details.account,
      previousAccount: details.previous?.account,
      previousVerifiedVia: details.previous
        ? `${provenanceLabel(details.previous.source)} ${datumKort(details.previous.verifiedAt)}`
        : undefined,
      requestTo: details.request?.to ?? request?.to,
      requestSentAtText: details.request ? datumKort(details.request.sentAt) : undefined,
      requestPossible: request?.possible ?? false,
      requestMessageExcerpt: request?.message?.split("\n\n")[1],
      requestUnavailableReason: request?.reason,
    };
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<SmartBack />}
        crumbs={[{ href: kunderInboxHref(), label: "Inbox" }, { label: invoice?.supplier ?? item.parsedSupplier ?? (item.subject || "Dokument") }]}
        title={invoice?.supplier ?? item.parsedSupplier ?? (item.subject || "(utan ämne)")}
        subtitle={`${item.fromAddress} · inkommen ${datumTid(item.createdAt)}`}
        actions={
          canSend && invoice ? (
            <SendToBankButton
              supplierInvoiceId={invoice.id}
              paymentId={payment?.id}
              scheduledDate={(payment?.scheduledDate ?? invoice.dueDate).slice(0, 10)}
              confirmRows={
                payment
                  ? supplierPaymentConfirmRows(payment, invoice)
                  : [
                      { label: "Leverantör", value: invoice.supplier },
                      { label: "Belopp", value: kr(invoice.amount) },
                      { label: "Förfaller", value: datumKort(invoice.dueDate) },
                      { label: "OCR", value: invoice.ocr ?? "—" },
                      { label: "Bankgiro", value: invoice.bankgiro ?? invoice.recipientAccount ?? "—" },
                    ]
              }
            />
          ) : item.status === "ny" ? (
            <InboxMailActions itemId={item.id} canCreateExpense={canCreateExpense} />
          ) : item.expenseId ? (
            <ButtonLink href="/ekonomi?flik=utgifter" variant="secondary">
              Öppna utgifter
            </ButtonLink>
          ) : undefined
        }
      />

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[16px] font-semibold">{invoice?.supplier ?? item.fromAddress}</p>
            <p className="text-[13px] text-muted">
              {invoice ? `Faktura ${invoice.invoiceNumber}` : `till ${item.toAddress}`}
            </p>
          </div>
          <Badge tone={display.tone}>{display.label}</Badge>
        </div>

        {detailsPanel ? (
          <div className="mt-4">
            <SupplierPaymentDetailsPanel {...detailsPanel} />
          </div>
        ) : null}

        <dl className="mt-4 grid gap-3 text-[14px] sm:grid-cols-2">
          <div>
            <dt className="text-muted">Belopp</dt>
            <dd className="font-medium text-ink">{kr(invoice?.amount ?? item.parsedAmount ?? 0)}</dd>
          </div>
          <div>
            <dt className="text-muted">Fakturadatum</dt>
            <dd className="font-medium text-ink">
              {invoice?.date || item.parsedDate ? datumKort(invoice?.date ?? item.parsedDate!) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Förfaller</dt>
            <dd className="font-medium text-ink">
              {invoice?.dueDate || item.parsedDueDate ? datumKort(invoice?.dueDate ?? item.parsedDueDate!) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">OCR</dt>
            <dd className="font-medium text-ink">{invoice?.ocr ?? item.parsedOcr ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">Bankgiro</dt>
            <dd className="font-medium text-ink">{invoice?.bankgiro ?? item.parsedBankgiro ?? "—"}</dd>
          </div>
        </dl>

        <ul className="mt-5 space-y-1.5 border-t border-line pt-4 text-[14px] text-soft">
          <li>Tolkad: {item.parsedAmount != null ? "ja" : "nej"}</li>
          <li>Bokförd: {invoice?.accountingStatus === "bokford" || item.status === "bokford" ? "ja" : "nej"}</li>
          <li>
            Betalning:{" "}
            {item.documentType === "kvitto"
              ? "inget utbetalningsflöde"
              : payment
                ? display.label
                : "ej förberedd"}
          </li>
        </ul>

        {item.confidence != null ? (
          <p className="mt-3 text-[13px] text-muted">Konfidens {(item.confidence * 100).toFixed(0)} %</p>
        ) : null}

        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-2 text-[13px] font-medium text-muted">Meddelande</p>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{item.textBody}</p>
        </div>

        {item.attachments.length > 0 ? (
          <div className="mt-5 border-t border-line pt-4">
            <p className="mb-2 text-[13px] font-medium text-muted">PDF / bilagor</p>
            <ul className="space-y-2">
              {item.attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-[14px] text-soft">
                  <Paperclip className="size-3.5 text-muted" />
                  <span>{a.filename}</span>
                  <span className="text-muted">{a.contentType}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
