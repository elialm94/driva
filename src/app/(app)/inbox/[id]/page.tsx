import { notFound, redirect } from "next/navigation";
import { CheckCircle2, Circle, Download, Minus } from "lucide-react";
import { getInboxView, linkedOrderForItem } from "@/lib/services/inbox";
import { getJob } from "@/lib/services/data";
import { latestPaymentForInvoice } from "@/lib/services/supplier-payments";
import {
  activePaymentFileForInvoice,
  paymentFileBlockersForInvoice,
  payerAccountLabel,
} from "@/lib/services/payment-files";
import {
  guessPaymentMethod,
  paymentDetailsInfo,
  paymentMethodLabel,
  provenanceLabel,
  supplierDetailsRequestInfo,
} from "@/lib/services/payment-details";
import {
  inboxDocumentTitle,
  inboxWorkflowSteps,
  needsAmountReview,
  PAYMENT_FILE_HELP_TEXT,
  type WorkflowStep,
} from "@/lib/inbox/workflow";
import { attachmentIsViewable } from "@/lib/inbox/attachment-content";
import { datumKort, datumTid, kr } from "@/lib/format";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { DocumentViewerButton } from "@/components/document-viewer";
import { CreatePaymentFileButton } from "@/components/payment-file-actions";
import { RegeneratePaymentFileButton } from "@/components/payment-file-actions";
import { InboxOverflowMenu } from "@/components/inbox-overflow";
import { InboxOrderConfirmationBody } from "@/components/inbox-order-confirmation";
import {
  SupplierPaymentDetailsPanel,
  type PaymentDetailsPanelProps,
} from "@/components/payment-details-actions";
import { kunderInboxHref } from "@/lib/nav";
import { ensurePageBusiness } from "@/lib/auth/session";
import { db } from "@/lib/store";

export const metadata = { title: "Inbox" };

function StepIcon({ state }: { state: WorkflowStep["state"] }) {
  if (state === "done") return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />;
  if (state === "na") return <Minus className="mt-0.5 size-4 shrink-0 text-muted" />;
  return <Circle className="mt-0.5 size-4 shrink-0 text-muted" />;
}

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
  const data = db();

  // Orderbekräftelser är inte leverantörsfakturor: egen vy utan belopp,
  // förfallodatum och betalningsuppgifter.
  if (item.documentType === "orderbekraftelse") {
    const confirmationSteps = inboxWorkflowSteps({ item });
    return (
      <div className="animate-fade-up">
        <PageHeader
          back={<SmartBack />}
          crumbs={[{ href: kunderInboxHref(), label: "Inbox" }, { label: item.subject || "Orderbekräftelse" }]}
          title={inboxDocumentTitle(item, undefined, linkedOrderForItem(item))}
          subtitle={`${item.fromAddress} · inkommen ${datumTid(item.createdAt)}`}
          actions={<InboxOverflowMenu itemId={item.id} canIgnore={item.status === "ny"} />}
        />
        <InboxOrderConfirmationBody item={item} steps={confirmationSteps} display={display} />
      </div>
    );
  }
  const invoice = item.supplierInvoiceId
    ? data.supplierInvoices.find((s) => s.id === item.supplierInvoiceId)
    : undefined;
  const expense = item.expenseId ? data.expenses.find((e) => e.id === item.expenseId) : undefined;
  const payment = invoice ? latestPaymentForInvoice(invoice.id) : undefined;
  const paymentFile = invoice ? activePaymentFileForInvoice(invoice.id) : undefined;
  const details = invoice && invoice.status !== "betald" ? paymentDetailsInfo(invoice) : undefined;

  const amountReview = needsAmountReview(item);
  const steps = inboxWorkflowSteps({
    item,
    invoice,
    payment,
    expense,
    paymentFile,
    detailsCause: details?.cause,
  });

  // [Skapa bankfil] visas bara när ALLA vakter är gröna – samma vakt som
  // tjänsten använder (exakta fel, aldrig ett generiskt XML-fel).
  const fileBlockers = invoice && !paymentFile ? paymentFileBlockersForInvoice(invoice.id) : [];
  const canCreateFile = Boolean(invoice) && !paymentFile && fileBlockers.length === 0;
  const payerLabel = payerAccountLabel();

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

  const account = invoice?.recipientAccount ?? invoice?.bankgiro ?? item.parsedBankgiro;
  const accountLabel = account ? paymentMethodLabel(guessPaymentMethod(account)) : "Bankgiro";
  const viewableAttachment = item.attachments.find((a) => attachmentIsViewable(a));

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<SmartBack />}
        crumbs={[
          { href: kunderInboxHref(), label: "Inbox" },
          { label: invoice?.supplier ?? item.parsedSupplier ?? (item.subject || "Dokument") },
        ]}
        title={inboxDocumentTitle(item, invoice)}
        subtitle={`${item.fromAddress} · inkommen ${datumTid(item.createdAt)}`}
        actions={
          <div className="flex items-center gap-2">
            {amountReview ? (
              <ButtonLink href={`/inbox/${item.id}/kontrollera`} size="sm">
                Kontrollera belopp
              </ButtonLink>
            ) : canCreateFile && invoice ? (
              <CreatePaymentFileButton
                supplierInvoiceIds={[invoice.id]}
                title={`Betala ${invoice.supplier}`}
                confirmRows={[
                  { label: "Belopp", value: kr(invoice.amount) },
                  { label: "Förfallodatum", value: datumKort(invoice.dueDate) },
                  { label: accountLabel, value: account ?? "—" },
                  { label: "OCR", value: invoice.ocr ?? `Meddelande: Faktura ${invoice.invoiceNumber}` },
                  {
                    label: "Från",
                    value: payerLabel ? `${data.settings.name}, ${payerLabel}` : data.settings.name,
                  },
                ]}
              />
            ) : null}
            <InboxOverflowMenu itemId={item.id} canIgnore={item.status === "ny"} />
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)] lg:items-start">
        <div className="space-y-4">
          {amountReview ? (
            <Card className="border-warn/50 bg-warn-soft/30 p-5">
              <p className="text-[15px] font-semibold text-ink">
                Belopp {item.parsedAmount != null ? kr(item.parsedAmount) : "0 kr"}
              </p>
              <p className="mt-1 text-[14px] text-soft">
                Driva kunde inte läsa totalbeloppet säkert. Kontrollera mot dokumentet och godkänn – därefter
                bokförs {item.documentType === "kvitto" ? "kvittot" : "fakturan"} automatiskt.
              </p>
              <div className="mt-3">
                <ButtonLink href={`/inbox/${item.id}/kontrollera`} size="sm">
                  Kontrollera belopp
                </ButtonLink>
              </div>
            </Card>
          ) : null}

          {paymentFile && payment?.status === "PAYMENT_FILE_CREATED" ? (
            <Card className="border-ok/30 bg-ok-soft/30 p-5">
              <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                <CheckCircle2 className="size-4 text-ok" /> Bankfil skapad
              </p>
              <p className="mt-1 text-[13px] text-soft">
                {paymentFile.filename} · skapad {datumTid(paymentFile.createdAt)}
              </p>
              <p className="mt-2 text-[14px] text-soft">{PAYMENT_FILE_HELP_TEXT}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a href={`/api/betalfil/${paymentFile.id}`} download className="inline-flex">
                  <span className="inline-flex h-8 items-center gap-2 rounded-xl bg-ink px-3 text-[13px] font-medium text-white hover:bg-black">
                    <Download className="size-4" /> Hämta bankfil igen
                  </span>
                </a>
                <RegeneratePaymentFileButton fileId={paymentFile.id} />
              </div>
            </Card>
          ) : null}

          {detailsPanel ? <SupplierPaymentDetailsPanel {...detailsPanel} /> : null}

          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[16px] font-semibold">{invoice?.supplier ?? item.parsedSupplier ?? item.fromAddress}</p>
                <p className="text-[13px] text-muted">
                  {invoice
                    ? `Leverantörsfaktura ${invoice.invoiceNumber}`
                    : item.documentType === "kvitto"
                      ? "Kvitto"
                      : item.parsedInvoiceNumber
                        ? `Leverantörsfaktura ${item.parsedInvoiceNumber}`
                        : `till ${item.toAddress}`}
                </p>
              </div>
              <Badge tone={display.tone}>{display.label}</Badge>
            </div>

            <dl className="mt-4 grid gap-3 text-[14px] sm:grid-cols-2">
              <div>
                <dt className="text-muted">Belopp</dt>
                <dd className="font-medium text-ink">
                  {kr(invoice?.amount ?? expense?.amount ?? item.parsedAmount ?? 0)}
                  {amountReview ? <span className="ml-2 text-[12px] font-normal text-warn">Behöver kontroll</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Moms</dt>
                <dd className="font-medium text-ink">
                  {invoice?.vatAmount != null || expense?.vatAmount != null || item.parsedVatAmount != null
                    ? kr(invoice?.vatAmount ?? expense?.vatAmount ?? item.parsedVatAmount ?? 0)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Fakturadatum</dt>
                <dd className="font-medium text-ink">
                  {invoice?.date || item.parsedDate ? datumKort(invoice?.date ?? item.parsedDate!) : "—"}
                </dd>
              </div>
              {item.documentType !== "kvitto" ? (
                <div>
                  <dt className="text-muted">Förfaller</dt>
                  <dd className="font-medium text-ink">
                    {invoice?.dueDate || item.parsedDueDate ? datumKort(invoice?.dueDate ?? item.parsedDueDate!) : "—"}
                  </dd>
                </div>
              ) : null}
            </dl>

            {item.documentType !== "kvitto" ? (
              <div className="mt-5 border-t border-line pt-4">
                <p className="mb-2 text-[13px] font-medium text-muted">Betalningsuppgifter</p>
                <dl className="grid gap-3 text-[14px] sm:grid-cols-2">
                  <div>
                    <dt className="text-muted">{accountLabel}</dt>
                    <dd className="font-medium text-ink">{account ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">OCR/referens</dt>
                    <dd className="font-medium text-ink">{invoice?.ocr ?? item.parsedOcr ?? "—"}</dd>
                  </div>
                </dl>
                {details?.cause === "VERIFIED" && details.verified ? (
                  <p className="mt-2 text-[12px] text-muted">
                    Verifierade uppgifter ({provenanceLabel(details.verified.source)}{" "}
                    {datumKort(details.verified.verifiedAt)}).
                  </p>
                ) : null}
              </div>
            ) : null}

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
                        <DocumentViewerButton
                          href={`/api/inbox/bilaga/${item.id}/${a.id}`}
                          filename={a.filename}
                          label="Visa PDF"
                        />
                      ) : (
                        <span className="text-[12px] text-muted">Innehållet finns inte lagrat.</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <p className="text-[13px] font-medium text-muted">Status</p>
            <ul className="mt-3 space-y-3">
              {steps.map((step) => (
                <li key={step.key} className="flex items-start gap-2.5">
                  <StepIcon state={step.state} />
                  <div>
                    <p className={`text-[14px] font-medium ${step.state === "na" ? "text-muted" : "text-ink"}`}>
                      {step.label}
                    </p>
                    {step.detail ? <p className="text-[12.5px] text-muted">{step.detail}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {fileBlockers.length > 0 && invoice && !amountReview ? (
            <Card className="p-5">
              <p className="text-[13px] font-medium text-muted">Innan bankfil kan skapas</p>
              <ul className="mt-2 space-y-1.5 text-[13px] text-soft">
                {fileBlockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          {expense ? (
            <Card className="p-5">
              <p className="text-[13px] font-medium text-muted">Kopplad utgift</p>
              <p className="mt-1 text-[14px] text-ink">
                {expense.supplier} · {kr(expense.amount)}
              </p>
              <div className="mt-2">
                <ButtonLink href="/ekonomi?flik=utgifter" variant="secondary" size="sm">
                  Öppna utgifter
                </ButtonLink>
              </div>
            </Card>
          ) : null}

          {viewableAttachment && !amountReview ? (
            <Card className="p-5">
              <p className="text-[13px] font-medium text-muted">Underlag</p>
              <p className="mt-1 text-[13px] text-soft">Öppna dokumentet bredvid uppgifterna.</p>
              <div className="mt-2">
                <DocumentViewerButton
                  href={`/api/inbox/bilaga/${item.id}/${viewableAttachment.id}`}
                  filename={viewableAttachment.filename}
                  label="Visa dokument"
                />
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
