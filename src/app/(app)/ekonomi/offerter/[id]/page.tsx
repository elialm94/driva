import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Pencil,
  ExternalLink,
  BadgeCheck,
  FileLock2,
  Hammer,
  ShieldCheck,
} from "lucide-react";
import { db } from "@/lib/store";
import {
  getQuote,
  countsTowardInvoiced,
  currentVersion,
  effectiveQuoteStatus,
  quoteSignature,
  quoteTotals,
  requireCustomer,
  quoteVersions,
} from "@/lib/services/data";
import { kr, datumTid, datumLang, relativ } from "@/lib/format";
import { Badge, ButtonLink, Breadcrumbs, Card, SectionTitle, buttonClasses, cx } from "@/components/ui";
import { QuoteStatusBadge, InvoiceStatusBadge } from "@/components/status";
import { QuoteDocument } from "@/components/quote-document";
import { ActionMenu, PageActions } from "@/components/action-menu";
import { QuotePdfMenuItem } from "@/components/quote-pdf-menu-item";
import { CopyLinkButton } from "@/components/copy-button";
import { CreatePartInvoiceButton, FollowUpButton } from "@/components/money-widgets";
import { QuoteDraftSend } from "@/components/quote-draft-send";
import { SendChecklist } from "@/components/send-checklist";
import { quoteSendBlockers } from "@/lib/services/quotes";
import { sendQuoteAction } from "@/app/actions";
import { isLiveMailConfigured } from "@/lib/mail";
import { docTotals } from "@/lib/calc";
import { SmartBack } from "@/components/back-link";
import { AppLink } from "@/components/app-link";
import { hrefWithNav, invoiceHref, sanitizeReturnLabel, sanitizeReturnTo } from "@/lib/nav";
import { ensurePageBusiness } from "@/lib/auth/session";
import { quoteChainState } from "@/lib/services/business-chain";
import { QuoteChainActions } from "@/components/quote-chain-actions";
import { QUOTE_TIMELINE, signedWithBankIdBy } from "@/lib/status-labels";

export const metadata = { title: "Offert" };

export default async function QuotePage(props: PageProps<"/ekonomi/offerter/[id]">) {
  await ensurePageBusiness();
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const quote = getQuote(id);
  if (!quote) notFound();
  const data = db();
  const version = currentVersion(quote);
  const customer = requireCustomer(quote.customerId);
  const signature = quoteSignature(quote.id);
  const totals = quoteTotals(quote);
  const versions = quoteVersions(quote.id);
  const relatedInvoices = data.invoices.filter((i) => i.quoteId === quote.id);
  const job = quote.jobId ? data.jobs.find((j) => j.id === quote.jobId) : undefined;
  const publicPath = `/offert/${quote.token}`;
  const returnTo = typeof searchParams.tillbaka === "string" ? sanitizeReturnTo(searchParams.tillbaka) : undefined;
  const returnLabel =
    typeof searchParams.tillbakaNamn === "string" ? sanitizeReturnLabel(searchParams.tillbakaNamn) ?? undefined : undefined;
  const nav = { returnTo, returnLabel };
  const fromHere = { href: hrefWithNav(`/ekonomi/offerter/${quote.id}`, nav), label: `Offert #${quote.number}` };
  const editHref = hrefWithNav(`/ekonomi/offerter/${quote.id}/redigera`, nav);
  const isDraft = quote.status === "utkast";
  const sentParam = typeof searchParams.skickad === "string" ? searchParams.skickad : null;
  const justSent = sentParam === "1" && !isDraft;
  const justSentDemo = sentParam === "demo" && !isDraft;
  const justSentManual = sentParam === "manuell" && !isDraft;
  // EN källa (quoteSendBlockers). buyer_email kompletteras inline – ingen länk till Kunden.
  const sendBlockers = isDraft
    ? quoteSendBlockers(quote.id).map((b) => (b.href ? { ...b, href: hrefWithNav(b.href, nav) } : b))
    : [];
  const businessBlockers = sendBlockers.filter((b) => b.code !== "buyer_email");

  const invoicedTotal = relatedInvoices
    .filter(countsTowardInvoiced)
    .reduce((s, i) => s + docTotals(i.lines, i.rot).total, 0);

  const doc = (
    <QuoteDocument company={data.settings} customer={customer} quote={quote} version={version} signature={signature} />
  );

  // Utskrifts-/PDF-vyn finns för allt som inte är utkast (samma regel som kundvyn).
  const pdfMenuItem = <QuotePdfMenuItem href={`${publicPath}/pdf`} />;

  return (
    <div className="animate-fade-up">
      <div className="mb-2.5">
        <SmartBack />
      </div>
      <Breadcrumbs
        items={[
          { href: "/ekonomi", label: "Ekonomi" },
          { href: "/ekonomi?flik=offerter", label: "Offerter" },
          { label: `#${quote.number}` },
        ]}
      />

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-semibold tracking-tight">Offert #{quote.number}</h1>
            <QuoteStatusBadge quote={quote} status={effectiveQuoteStatus(quote)} />
            {version.lockedAt ? (
              <Badge tone="bankid">
                <FileLock2 className="size-3" /> Version {version.version} låst
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-[15px] text-soft">
            {version.title} · <AppLink href={`/kunder/${customer.id}`} originLabel={`Offert #${quote.number}`} className="font-medium text-ink hover:underline">{customer.name}</AppLink> · {kr(totals.toPay)}
          </p>
        </div>

        <div className="min-w-0">
          {isDraft ? (
            <PageActions>
              <ButtonLink href={editHref} variant="secondary">
                <Pencil className="size-4" /> Redigera
              </ButtonLink>
              <QuoteDraftSend
                documentId={quote.id}
                customerId={customer.id}
                customerName={customer.name}
                amount={totals.toPay}
                validUntilLabel={datumLang(version.validUntil)}
                sendAction={sendQuoteAction.bind(null, quote.id)}
                detailHref={fromHere.href}
                mailConfigured={isLiveMailConfigured()}
                recipientEmail={customer.email}
                hasSendBlockers={businessBlockers.length > 0}
              />
            </PageActions>
          ) : null}
          {quote.status === "skickad" ? (
            <PageActions>
              <QuoteChainActions
                state={quoteChainState(quote, fromHere)}
                returnTo={fromHere.href}
                returnLabel={fromHere.label}
              />
              <FollowUpButton quoteId={quote.id} />
              <a href={publicPath} target="_blank" rel="noreferrer" className={buttonClasses("secondary")}>
                <ExternalLink className="size-4" /> Öppna kundvyn
              </a>
              <ActionMenu>
                <CopyLinkButton path={publicPath} appearance="menu" copiedLabel="✓ Kundlänken är kopierad" />
                {pdfMenuItem}
              </ActionMenu>
            </PageActions>
          ) : null}
          {quote.status === "godkand" || quote.status === "avbojd" ? (
            <PageActions>
              {quote.status === "godkand" ? (
                <QuoteChainActions
                  state={quoteChainState(quote, fromHere)}
                  returnTo={fromHere.href}
                  returnLabel={fromHere.label}
                />
              ) : null}
              <ButtonLink href={editHref} variant="secondary">
                <Pencil className="size-4" /> Ny version
              </ButtonLink>
              <a href={publicPath} target="_blank" rel="noreferrer" className={buttonClasses("secondary")}>
                <ExternalLink className="size-4" /> Öppna kundvyn
              </a>
              <ActionMenu>
                <CopyLinkButton path={publicPath} appearance="menu" copiedLabel="✓ Kundlänken är kopierad" />
                {pdfMenuItem}
              </ActionMenu>
            </PageActions>
          ) : null}
        </div>
      </div>

      {justSent ? (
        <Card className="mb-6 border-ok/20 bg-ok-soft/50 px-5 py-4 text-[14px] text-soft">
          <span className="font-medium text-ok">
            Offert #{quote.number} skickades till {customer.name}.
          </span>
        </Card>
      ) : null}

      {justSentDemo ? (
        <Card className="mb-6 border-ok/20 bg-ok-soft/50 px-5 py-4 text-[14px] text-soft">
          <span className="font-medium text-ok">Offert #{quote.number} skickades till {customer.name}.</span>{" "}
          Demo: mejlet simulerades och skickades inte externt.
        </Card>
      ) : null}

      {justSentManual ? (
        <Card className="mb-6 border-ok/20 bg-ok-soft/50 px-5 py-4 text-[14px] text-soft">
          <span className="font-medium text-ok">Offert #{quote.number} är markerad som skickad.</span> Ingen e-post är
          konfigurerad – dela kundlänken med {customer.name} via ”Kopiera kundlänk”.
        </Card>
      ) : null}

      {isDraft ? <SendChecklist id="quote-send-blockers" title="Innan offerten kan skickas" blockers={sendBlockers} /> : null}

      {quote.status === "skickad" ? (
        <Card className="mb-6 flex items-start gap-3 border-warn/20 bg-warn-soft/40 px-5 py-4">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-warn" />
          <div className="text-[14px] leading-relaxed text-soft">
            <span className="font-medium text-ink">Offerten är skickad och väntar på att {customer.name} ska signera.</span>{" "}
            Skickad {quote.sentAt ? relativ(quote.sentAt) : ""}
            {quote.viewedAt ? `, öppnad av kunden ${relativ(quote.viewedAt)}` : ", inte öppnad ännu"}.
            {quote.followUps.length > 0 ? ` ${quote.followUps.length} påminnelse${quote.followUps.length > 1 ? "r" : ""} skickad.` : ""}{" "}
            I demoläget kan du öppna kundvyn själv och signera som kunden.
          </div>
        </Card>
      ) : null}

      {signature ? (
        <Card className="mb-6 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <BadgeCheck className="mt-0.5 size-5 shrink-0 text-ok" />
              <div>
                <p className="text-[15px] font-semibold text-ok">{signedWithBankIdBy(signature.signerName)}</p>
                <p className="text-[14px] text-soft">{datumTid(signature.signedAt)}</p>
                <p className="mt-1 text-[12px] text-muted">
                  Version {version.version} är låst och kan verifieras mot signeringsunderlaget. Ändringar kräver en ny version och ny signering.
                </p>
              </div>
            </div>
            <a
              href={`${publicPath}/underlag`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-strong px-3.5 text-[13px] font-medium text-ink hover:bg-canvas"
            >
              <FileLock2 className="size-3.5" /> Visa signeringsunderlag
            </a>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="overflow-hidden rounded-2xl border border-line shadow-card">{doc}</div>

        <div className="space-y-8">
          {quote.status === "godkand" ? (
            <div>
              <SectionTitle>Nästa steg</SectionTitle>
              <Card className="space-y-3 px-5 py-4">
                {job ? (
                  <Link href={hrefWithNav(`/uppdrag/${job.id}`, { returnTo: fromHere.href, returnLabel: fromHere.label }) as never} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 transition-colors hover:bg-canvas">
                    <Hammer className="size-4 text-accent" />
                    <div className="flex-1">
                      <p className="text-[14px] font-medium">{job.title}</p>
                      <p className="text-[12px] text-muted">Uppdrag</p>
                    </div>
                  </Link>
                ) : null}
                {version.paymentPlan.map((part, i) => {
                  const alreadyInvoiced = i < relatedInvoices.filter(countsTowardInvoiced).length;
                  const partAmount = Math.round((totals.total * part.percent) / 100);
                  if (invoicedTotal >= totals.total) return null;
                  return alreadyInvoiced ? null : (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <p className="text-[13px] text-soft">
                        {part.label} · {kr(partAmount)}
                      </p>
                      <CreatePartInvoiceButton
                        quoteId={quote.id}
                        partIndex={i}
                        label="Fakturera"
                        returnTo={fromHere.href}
                        returnLabel={fromHere.label}
                      />
                    </div>
                  );
                })}
                {invoicedTotal >= totals.total ? (
                  <p className="text-[13px] text-muted">Hela offerten är fakturerad.</p>
                ) : null}
              </Card>
            </div>
          ) : null}

          {relatedInvoices.length > 0 ? (
            <div>
              <SectionTitle>Fakturor</SectionTitle>
              <Card className="divide-y divide-line/70">
                {relatedInvoices.map((inv) => (
                  <Link
                    key={inv.id}
                    href={invoiceHref(inv.id, fromHere) as never}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-canvas/60 first:rounded-t-[calc(1.25rem-1px)] last:rounded-b-[calc(1.25rem-1px)]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium">#{inv.number}</p>
                      <p className="text-[12px] text-muted">{kr(docTotals(inv.lines, inv.rot).toPay)}</p>
                    </div>
                    <InvoiceStatusBadge invoice={inv} />
                  </Link>
                ))}
              </Card>
            </div>
          ) : null}

          <div>
            <SectionTitle>Tidslinje</SectionTitle>
            <Card className="px-5 py-4">
              <ol className="space-y-3">
                {[
                  { label: QUOTE_TIMELINE.skapad, at: quote.createdAt, done: true },
                  { label: QUOTE_TIMELINE.skickad, at: quote.sentAt, done: !!quote.sentAt },
                  { label: QUOTE_TIMELINE.oppnad, at: quote.viewedAt, done: !!quote.viewedAt },
                  ...quote.followUps.map((f, i) => ({ label: `${QUOTE_TIMELINE.paminnelse} ${i + 1}`, at: f as string | undefined, done: true })),
                  quote.status === "avbojd"
                    ? { label: QUOTE_TIMELINE.avbojd, at: quote.decidedAt, done: true }
                    : {
                        // Historiken är precis: metoden (BankID) och signatären hör hemma här.
                        label: signature ? signedWithBankIdBy(signature.signerName) : QUOTE_TIMELINE.signerad,
                        at: signature?.signedAt,
                        done: !!signature,
                      },
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span
                      className={cx(
                        "mt-1 size-2 shrink-0 rounded-full",
                        step.done ? "bg-accent" : "border border-line-strong bg-card"
                      )}
                    />
                    <div>
                      <p className={cx("text-[13px] font-medium", step.done ? "text-ink" : "text-muted")}>{step.label}</p>
                      {step.at && step.done ? <p className="text-[12px] text-muted">{datumTid(step.at)}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          </div>

          {versions.length > 1 ? (
            <div>
              <SectionTitle>Versioner</SectionTitle>
              <Card className="divide-y divide-line/70">
                {versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between px-4 py-3 text-[13px]">
                    <span className={v.id === version.id ? "font-medium text-ink" : "text-soft"}>
                      Version {v.version}
                      {v.id === version.id ? " (aktuell)" : ""}
                    </span>
                    {v.lockedAt ? <Badge tone="bankid">Låst</Badge> : <Badge tone="neutral">Utkast</Badge>}
                  </div>
                ))}
              </Card>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
