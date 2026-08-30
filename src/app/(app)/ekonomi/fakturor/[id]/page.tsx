import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, BadgeCheck, Pencil } from "lucide-react";
import { db } from "@/lib/store";
import { getInvoice, invoiceTotals, requireCustomer, isOverdue } from "@/lib/services/data";
import { invoiceQuoteDeviation } from "@/lib/services/invoice-quote-deviation";
import { validateInvoiceForIssue } from "@/lib/invoices/validate";
import { missingEmailForSend } from "@/lib/customer-validation";
import { invoiceHeading } from "@/lib/invoices/display";
import { kr, datumTid, datumLang, relativ } from "@/lib/format";
import { ButtonLink, Breadcrumbs, Card, SectionTitle, buttonClasses, cx } from "@/components/ui";
import { InvoiceStatusBadge } from "@/components/status";
import { InvoiceDocument } from "@/components/invoice-document";
import { ActionMenu, PageActions } from "@/components/action-menu";
import { CopyLinkButton } from "@/components/copy-button";
import {
  CreditInvoiceButton,
  DiscardInvoiceButton,
  ResendInvoiceButton,
  SendReminderButton,
  SimulatePaymentButton,
} from "@/components/money-widgets";
import { QuoteDeviationCard } from "@/components/quote-deviation-card";
import { InvoiceDraftSend } from "@/components/invoice-draft-send";
import { InvoiceIssueChecklist } from "@/components/invoice-issue-checklist";
import { sendInvoiceAction } from "@/app/actions";
import { isLiveMailConfigured } from "@/lib/mail";
import { DeniedReductionCard } from "@/components/denied-reduction-card";
import { TaxReductionApplicationCard } from "@/components/tax-reduction-application";
import { taxReductionCaseForInvoice } from "@/lib/services/tax-reduction";
import { SmartBack } from "@/components/back-link";
import { AppLink } from "@/components/app-link";
import { hrefWithNav, newQuoteHref, sanitizeReturnLabel, sanitizeReturnTo, withReturnTo } from "@/lib/nav";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Faktura" };

export default async function InvoicePage(props: PageProps<"/ekonomi/fakturor/[id]">) {
  await ensurePageBusiness();
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const invoice = getInvoice(id);
  if (!invoice) notFound();
  const data = db();
  const customer = requireCustomer(invoice.customerId);
  const totals = invoiceTotals(invoice);
  const job = invoice.jobId ? data.jobs.find((j) => j.id === invoice.jobId) : undefined;
  const quote = invoice.quoteId ? data.quotes.find((q) => q.id === invoice.quoteId) : undefined;
  const payment = data.payments.find((p) => p.invoiceId === invoice.id);
  const publicPath = `/faktura/${invoice.token}`;
  const deviation = invoiceQuoteDeviation(invoice);
  const taxCase = invoice.rot ? taxReductionCaseForInvoice(invoice) : null;
  const showDeniedFollowUp =
    Boolean(invoice.rot) &&
    totals.deduction > 0 &&
    invoice.status !== "utkast" &&
    invoice.type !== "kredit";
  const blockers = invoice.status === "utkast" ? validateInvoiceForIssue(invoice.id) : [];
  const isDraft = invoice.status === "utkast";
  const returnTo = typeof searchParams.tillbaka === "string" ? sanitizeReturnTo(searchParams.tillbaka) : undefined;
  const returnLabel =
    typeof searchParams.tillbakaNamn === "string" ? sanitizeReturnLabel(searchParams.tillbakaNamn) ?? undefined : undefined;
  const nav = { returnTo, returnLabel };
  const fromHere = { href: hrefWithNav(`/ekonomi/fakturor/${invoice.id}`, nav), label: invoiceHeading(invoice) };
  const settingsReturn = `/ekonomi/fakturor/${invoice.id}`;
  const linkedBlockers = blockers.map((b) =>
    b.href ? { ...b, href: withReturnTo(b.href, settingsReturn, invoiceHeading(invoice)) } : b
  );
  // Saknad e-post namnges i checklistan men kompletteras inline i skickaflödet
  // (pendingAction SEND_INVOICE → resolveMissingRequirements → resume).
  const emailBlocker = isDraft ? missingEmailForSend(customer) : null;
  const sendBlockers = emailBlocker ? [...linkedBlockers, emailBlocker] : linkedBlockers;
  const editHref = hrefWithNav(`/ekonomi/fakturor/${invoice.id}/redigera`, nav);
  const tillaggHref = deviation?.largeExcess
    ? newQuoteHref({
        kund: invoice.customerId,
        tillaggFran: invoice.id,
        from: fromHere,
      })
    : undefined;
  const sentParam = typeof searchParams.skickad === "string" ? searchParams.skickad : null;
  const justSent = sentParam === "1" && !isDraft;
  const justSentManual = sentParam === "manuell" && !isDraft;
  const deliveryFailed =
    (typeof searchParams.leveransfel === "string" && searchParams.leveransfel === "1") ||
    Boolean(!isDraft && invoice.issuedAt && !invoice.sentAt);

  const doc = <InvoiceDocument company={data.settings} customer={customer} invoice={invoice} />;

  const overdue = isOverdue(invoice);
  const isCreditNote = invoice.type === "kredit";
  const canRemind = invoice.status === "skickad" && !isCreditNote && overdue;
  const canCredit = invoice.status === "skickad" && !isCreditNote;
  // Simulering kräver ett (demo-)bankkonto att bokföra inbetalningen mot.
  const canSimulate = invoice.status === "skickad" && !isCreditNote && data.bankAccounts.length > 0;
  const canCustomerView = !isDraft;
  const canCopyLink = !isDraft;
  const canResend = !isDraft;

  const customerView = canCustomerView ? (
    <a href={publicPath} target="_blank" rel="noreferrer" className={buttonClasses("secondary")}>
      <ExternalLink className="size-4" /> Visa kundvy
    </a>
  ) : null;

  const moreMenu = (
    <ActionMenu>
      {canCredit ? <CreditInvoiceButton invoiceId={invoice.id} appearance="menu" /> : null}
      {canCopyLink ? (
        <CopyLinkButton path={publicPath} appearance="menu" copiedLabel="✓ Kundlänken är kopierad" />
      ) : null}
      {canResend ? <ResendInvoiceButton invoiceId={invoice.id} retry={!invoice.sentAt} appearance="menu" /> : null}
      {canSimulate ? <SimulatePaymentButton invoiceId={invoice.id} appearance="menu" /> : null}
      {isDraft ? <DiscardInvoiceButton invoiceId={invoice.id} appearance="menu" /> : null}
    </ActionMenu>
  );

  const headerActions = isDraft ? (
    <PageActions>
      <ButtonLink href={editHref} variant="secondary">
        <Pencil className="size-4" /> Redigera faktura
      </ButtonLink>
      <InvoiceDraftSend
        documentId={invoice.id}
        customerId={customer.id}
        customerName={customer.name}
        amount={totals.toPay}
        dueDateLabel={datumLang(invoice.dueDate)}
        sendAction={sendInvoiceAction.bind(null, invoice.id)}
        detailHref={fromHere.href}
        mailConfigured={isLiveMailConfigured()}
        recipientEmail={customer.email}
        hasIssuanceBlockers={linkedBlockers.length > 0}
        excessAmount={deviation?.largeExcess ? deviation.delta : undefined}
        tillaggHref={tillaggHref}
      />
      {moreMenu}
    </PageActions>
  ) : (
    <PageActions>
      {canRemind ? <SendReminderButton invoiceId={invoice.id} variant="primary" size="md" /> : null}
      {customerView}
      {moreMenu}
    </PageActions>
  );

  return (
    <div className="animate-fade-up">
      <div className="mb-2.5">
        <SmartBack />
      </div>
      <Breadcrumbs
        items={[
          { href: "/ekonomi", label: "Ekonomi" },
          { href: "/ekonomi?flik=fakturor", label: "Fakturor" },
          { label: invoiceHeading(invoice) },
        ]}
      />

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-semibold tracking-tight">{invoiceHeading(invoice)}</h1>
            <InvoiceStatusBadge invoice={invoice} />
          </div>
          <p className="mt-1 text-[15px] text-soft">
            <AppLink href={`/kunder/${customer.id}`} originLabel={invoiceHeading(invoice)} className="font-medium text-ink hover:underline">
              {customer.name}
            </AppLink>{" "}
            · {kr(totals.toPay)} · förfaller {datumLang(invoice.dueDate)}
          </p>
        </div>
        <div className="min-w-0">{headerActions}</div>
      </div>

      {justSent ? (
        <Card className="mb-6 border-ok/20 bg-ok-soft/50 px-5 py-4 text-[14px] text-soft">
          <span className="font-medium text-ok">
            Faktura {invoice.number != null ? `#${invoice.number}` : ""} skickades till {customer.name}.
          </span>
        </Card>
      ) : null}

      {justSentManual ? (
        <Card className="mb-6 border-ok/20 bg-ok-soft/50 px-5 py-4 text-[14px] text-soft">
          <span className="font-medium text-ok">
            Faktura {invoice.number != null ? `#${invoice.number}` : ""} är utfärdad, bokförd och markerad som skickad.
          </span>{" "}
          Ingen e-post är konfigurerad – dela kundlänken med {customer.name} via ”Kopiera kundlänk”.
        </Card>
      ) : null}

      {deliveryFailed && !justSent && !justSentManual ? (
        <Card className="mb-6 border-warn/30 bg-warn-soft/40 px-5 py-4 text-[14px] text-soft">
          <span className="font-medium text-ink">Fakturan utfärdades men kunde inte skickas via e-post.</span> Samma
          nummer behålls – försök skicka igen.
        </Card>
      ) : null}

      {isDraft ? <InvoiceIssueChecklist blockers={sendBlockers} /> : null}

      {taxCase ? <TaxReductionApplicationCard cse={taxCase} editHref={isDraft ? editHref : undefined} /> : null}

      {showDeniedFollowUp ? <DeniedReductionCard invoiceId={invoice.id} deduction={totals.deduction} /> : null}

      {deviation ? <QuoteDeviationCard deviation={deviation} /> : null}

      {invoice.status === "skickad" && overdue && !isCreditNote ? (
        <Card className="mb-6 border-danger/20 bg-danger-soft/40 px-5 py-4 text-[14px] text-soft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              <span className="font-medium text-danger">Fakturan är försenad.</span>{" "}
              {customer.name} har inte betalat {kr(totals.toPay)} ännu.
              {invoice.reminders.length > 0
                ? ` ${invoice.reminders.length} påminnelse${invoice.reminders.length > 1 ? "r" : ""} skickad, senast ${relativ(invoice.reminders[invoice.reminders.length - 1])}.`
                : " Ingen påminnelse skickad ännu."}
            </p>
            {invoice.reminders.length === 0 ? <SendReminderButton invoiceId={invoice.id} /> : null}
          </div>
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
              {quote || job ? (
                <Link
                  href={
                    (job
                      ? hrefWithNav(`/uppdrag/${job.id}`, { returnTo: fromHere.href, returnLabel: fromHere.label })
                      : hrefWithNav(`/ekonomi/offerter/${quote!.id}`, { returnTo: fromHere.href, returnLabel: fromHere.label })) as never
                  }
                  className="block px-4 py-3 text-[14px] font-medium transition-colors hover:bg-canvas/60"
                >
                  {[quote ? `Offert #${quote.number}` : null, job?.title].filter(Boolean).join(" · ")}
                  <span className="block text-[12px] font-normal text-muted">
                    {quote && job ? "Offert och uppdrag" : job ? "Uppdrag" : "Offert"}
                  </span>
                </Link>
              ) : (
                <p className="px-4 py-3 text-[13px] text-muted">Fristående faktura.</p>
              )}
              {quote && job ? (
                <Link
                  href={hrefWithNav(`/ekonomi/offerter/${quote.id}`, { returnTo: fromHere.href, returnLabel: fromHere.label }) as never}
                  className="block px-4 py-3 text-[13px] text-soft transition-colors hover:bg-canvas/60"
                >
                  Visa offert #{quote.number}
                </Link>
              ) : null}
            </Card>
          </div>

          <div>
            <SectionTitle>Händelser</SectionTitle>
            <Card className="px-5 py-4">
              <ol className="space-y-3">
                {[
                  { label: "Skapad", at: invoice.createdAt as string | undefined, done: true },
                  { label: "Utfärdad", at: invoice.issuedAt, done: !!invoice.issuedAt },
                  { label: "Skickad", at: invoice.sentAt, done: !!invoice.sentAt },
                  ...(invoice.lastSentAt && invoice.sentAt && invoice.lastSentAt !== invoice.sentAt
                    ? [{ label: "Skickad igen", at: invoice.lastSentAt as string | undefined, done: true }]
                    : []),
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
