import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, BadgeCheck } from "lucide-react";
import { db } from "@/lib/store";
import { getInvoice, invoiceTotals, requireCustomer, isOverdue } from "@/lib/services/data";
import { kr, datumTid, datumLang, relativ } from "@/lib/format";
import { Card, SectionTitle, cx } from "@/components/ui";
import { InvoiceStatusBadge } from "@/components/status";
import { InvoiceDocument } from "@/components/invoice-document";
import { PreviewModal } from "@/components/preview-modal";
import { CopyLinkButton } from "@/components/copy-button";
import { CreditInvoiceButton, SendReminderButton, SimulatePaymentButton } from "@/components/money-widgets";
import { sendInvoiceAction } from "@/app/actions";

export const metadata = { title: "Faktura" };

const TYPE_LABEL: Record<string, string> = {
  faktura: "Faktura",
  delbetalning: "Delbetalning",
  slutfaktura: "Slutfaktura",
  kredit: "Kreditfaktura",
};

export default async function InvoicePage(props: PageProps<"/pengar/fakturor/[id]">) {
  const { id } = await props.params;
  const invoice = getInvoice(id);
  if (!invoice) notFound();
  const data = db();
  const customer = requireCustomer(invoice.customerId);
  const totals = invoiceTotals(invoice);
  const job = invoice.jobId ? data.jobs.find((j) => j.id === invoice.jobId) : undefined;
  const quote = invoice.quoteId ? data.quotes.find((q) => q.id === invoice.quoteId) : undefined;
  const payment = data.payments.find((p) => p.invoiceId === invoice.id);
  const publicPath = `/faktura/${invoice.token}`;

  const doc = <InvoiceDocument company={data.settings} customer={customer} invoice={invoice} />;

  return (
    <div className="animate-fade-up">
      <Link href="/pengar?flik=fakturor" className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Fakturor
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-semibold tracking-tight">
              {TYPE_LABEL[invoice.type]} #{invoice.number}
            </h1>
            <InvoiceStatusBadge invoice={invoice} />
          </div>
          <p className="mt-1 text-[15px] text-soft">
            <Link href={`/kunder/${customer.id}` as never} className="font-medium text-ink hover:underline">
              {customer.name}
            </Link>{" "}
            · {kr(totals.toPay)} · förfaller {datumLang(invoice.dueDate)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {invoice.status === "utkast" ? (
            <PreviewModal
              triggerLabel="Förhandsgranska & skicka"
              title={`Så här ser ${customer.name.split(" ")[0]} fakturan`}
              document={doc}
              mode="send"
              sendAction={sendInvoiceAction.bind(null, invoice.id)}
              sendLabel="Skicka faktura"
              sentTitle="Fakturan är skickad"
              sentText="Fakturan är bokförd och kunden har fått den med e-post."
              publicPath={publicPath}
              recipientEmail={customer.email}
            />
          ) : (
            <>
              {invoice.status === "skickad" ? (
                <>
                  <SimulatePaymentButton invoiceId={invoice.id} />
                  <SendReminderButton invoiceId={invoice.id} />
                  <CreditInvoiceButton invoiceId={invoice.id} />
                </>
              ) : null}
              <CopyLinkButton path={publicPath} />
              <a
                href={publicPath}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-soft hover:bg-ink/5 hover:text-ink"
              >
                <ExternalLink className="size-3.5" /> Kundvy
              </a>
              <PreviewModal
                triggerLabel="Så här ser kunden fakturan"
                triggerVariant="secondary"
                title={`Så här ser ${customer.name.split(" ")[0]} fakturan`}
                document={doc}
                mode="view"
                publicPath={publicPath}
              />
            </>
          )}
        </div>
      </div>

      {invoice.status === "skickad" && isOverdue(invoice) ? (
        <Card className="mb-6 border-danger/20 bg-danger-soft/40 px-5 py-4 text-[14px] text-soft">
          <span className="font-medium text-danger">Fakturan är försenad.</span>{" "}
          {customer.name} har inte betalat {kr(totals.toPay)} ännu.
          {invoice.reminders.length > 0
            ? ` ${invoice.reminders.length} påminnelse${invoice.reminders.length > 1 ? "r" : ""} skickad, senast ${relativ(invoice.reminders[invoice.reminders.length - 1])}.`
            : " Ingen påminnelse skickad ännu."}
        </Card>
      ) : null}

      {invoice.status === "betald" && payment ? (
        <Card className="mb-6 flex items-start gap-3 px-5 py-4">
          <BadgeCheck className="mt-0.5 size-5 shrink-0 text-ok" />
          <div className="text-[14px] leading-relaxed text-soft">
            <span className="font-medium text-ok">Betald och bokförd.</span> Betalningen på {kr(payment.amount)} matchades{" "}
            {payment.matchedBy === "auto" ? "automatiskt mot banktransaktionen" : "manuellt"} {datumTid(payment.date)}.
          </div>
        </Card>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
        <div className="overflow-hidden rounded-2xl border border-line shadow-card">{doc}</div>

        <div className="space-y-8">
          <div>
            <SectionTitle>Kopplat till</SectionTitle>
            <Card className="divide-y divide-line/70">
              {job ? (
                <Link href={`/jobb/${job.id}` as never} className="block px-4 py-3 text-[14px] font-medium transition-colors hover:bg-canvas/60">
                  {job.title}
                  <span className="block text-[12px] font-normal text-muted">Jobb</span>
                </Link>
              ) : null}
              {quote ? (
                <Link href={`/pengar/offerter/${quote.id}` as never} className="block px-4 py-3 text-[14px] font-medium transition-colors hover:bg-canvas/60">
                  Offert #{quote.number}
                  <span className="block text-[12px] font-normal text-muted">
                    {quote.status === "godkand" ? "Godkänd med BankID" : "Offert"}
                  </span>
                </Link>
              ) : null}
              {!job && !quote ? <p className="px-4 py-3 text-[13px] text-muted">Fristående faktura.</p> : null}
            </Card>
          </div>

          <div>
            <SectionTitle>Händelser</SectionTitle>
            <Card className="px-5 py-4">
              <ol className="space-y-3">
                {[
                  { label: "Skapad", at: invoice.createdAt as string | undefined, done: true },
                  { label: "Skickad & bokförd", at: invoice.sentAt, done: !!invoice.sentAt },
                  ...invoice.reminders.map((r, i) => ({ label: `Påminnelse ${i + 1}`, at: r as string | undefined, done: true })),
                  { label: "Betald", at: invoice.paidAt, done: invoice.status === "betald" },
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className={cx("mt-1 size-2 shrink-0 rounded-full", step.done ? "bg-accent" : "border border-line-strong bg-card")} />
                    <div>
                      <p className={cx("text-[13px] font-medium", step.done ? "text-ink" : "text-muted")}>{step.label}</p>
                      {step.at && step.done ? <p className="text-[12px] text-muted">{datumTid(step.at)}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
