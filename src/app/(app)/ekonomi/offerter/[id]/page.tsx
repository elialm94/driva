import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, BadgeCheck, FileLock2, ShieldCheck } from "lucide-react";
import { db } from "@/lib/store";
import {
  getQuote,
  currentVersion,
  effectiveQuoteStatus,
  pendingDraftQuoteVersion,
  quoteAcceptance,
  quoteTotals,
  requireCustomer,
  quoteVersions,
} from "@/lib/services/data";
import { kr, datumTid, datumLang, relativ } from "@/lib/format";
import { Badge, ButtonLink, Breadcrumbs, Card, SectionTitle, cx } from "@/components/ui";
import { QuoteStatusBadge, InvoiceStatusBadge } from "@/components/status";
import { QuoteDocument } from "@/components/quote-document";
import { PageActions } from "@/components/action-menu";
import { FollowUpButton } from "@/components/money-widgets";
import { QuoteDraftSend } from "@/components/quote-draft-send";
import { DiscardDraftButton } from "@/components/discard-draft-button";
import { SendChecklist } from "@/components/send-checklist";
import { isQuoteWithdrawnByOwner, quoteSendBlockers } from "@/lib/services/quotes";
import { sendQuoteAction } from "@/app/actions";
import { isLiveMailConfigured } from "@/lib/mail";
import { docTotals } from "@/lib/calc";
import { SmartBack } from "@/components/back-link";
import { AppLink } from "@/components/app-link";
import { hrefFromOrigin, hrefWithNav, invoiceHref, pageOrigin, returnNavFromSearch } from "@/lib/nav";
import { ensurePageBusiness } from "@/lib/auth/session";
import { nextPaymentPlanPartForQuote } from "@/lib/services/business-chain";
import { documentLinkView } from "@/lib/services/document-job-link";
import { QuoteOwnerPageActions } from "@/components/quote-chain-actions";
import { LinkedToBox } from "@/components/linked-to-box";
import { QUOTE_TIMELINE, acceptedByLabel } from "@/lib/status-labels";

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
  const acceptance = quoteAcceptance(quote.id);
  const totals = quoteTotals(quote);
  const versions = quoteVersions(quote.id);
  const relatedInvoices = data.invoices.filter((i) => i.quoteId === quote.id);
  const publicPath = `/offert/${quote.token}`;
  const fromHere = pageOrigin(`/ekonomi/offerter/${quote.id}`, searchParams, `Offert #${quote.number}`);
  const linkView = documentLinkView("quote", quote.id, fromHere);
  // Edit is a child of this quote — stamp the incoming parent so Back from
  // redigera → quote still says Ekonomi/Offerter, not the quote itself.
  const editHref = hrefWithNav(`/ekonomi/offerter/${quote.id}/redigera`, returnNavFromSearch(searchParams));
  const isDraft = quote.status === "utkast";
  const sentParam = typeof searchParams.skickad === "string" ? searchParams.skickad : null;
  const justSent = sentParam === "1" && !isDraft;
  const justSentDemo = sentParam === "demo" && !isDraft;
  const justSentManual = sentParam === "manuell" && !isDraft;
  // EN källa (quoteSendBlockers) för checklista, disabled Skicka och servervalidering.
  // Stamp the quote (not its parent) so Komplettera / Lägg till e-post returns here.
  const pendingDraft = pendingDraftQuoteVersion(quote);
  const pendingUnsent = Boolean(pendingDraft && !pendingDraft.sellerSnapshot);
  const sendBlockers =
    isDraft || pendingUnsent
      ? quoteSendBlockers(quote.id).map((b) => (b.href ? { ...b, href: hrefFromOrigin(b.href, fromHere) } : b))
      : [];
  const canSend = sendBlockers.length === 0;

  const jobLinked = Boolean(linkView.job);
  const canInvoice = quote.status === "godkand" && jobLinked && nextPaymentPlanPartForQuote(quote.id) != null;

  const doc = (
    <QuoteDocument company={data.settings} customer={customer} quote={quote} version={version} acceptance={acceptance} />
  );

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
              <Badge tone="ok">
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
              <DiscardDraftButton kind="quote" documentId={quote.id} />
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
                canSend={canSend}
              />
            </PageActions>
          ) : (
            <QuoteOwnerPageActions
              status={quote.status}
              quoteId={quote.id}
              publicPath={publicPath}
              editHref={editHref}
              returnTo={fromHere.href}
              returnLabel={fromHere.label}
              jobLinked={jobLinked}
              canInvoice={canInvoice}
              followUp={quote.status === "skickad" ? <FollowUpButton quoteId={quote.id} /> : null}
            />
          )}
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

      {isDraft || pendingUnsent ? (
        <SendChecklist id="quote-send-blockers" title="Innan offerten kan skickas" blockers={sendBlockers} />
      ) : null}

      {pendingDraft ? (
        <Card className="mb-6 px-5 py-4 text-[14px] leading-relaxed text-soft">
          {pendingDraft.sellerSnapshot ? (
            <span>
              <span className="font-medium text-ink">Version {pendingDraft.version} är skickad</span> och väntar på
              kundens godkännande. Den godkända versionen gäller tills den nya accepteras.
            </span>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                <span className="font-medium text-ink">Version {pendingDraft.version} är ett utkast.</span> Skicka den
                till kunden – den godkända versionen gäller tills dess.
              </span>
              <QuoteDraftSend
                documentId={quote.id}
                customerId={customer.id}
                customerName={customer.name}
                amount={docTotals(pendingDraft.lines, pendingDraft.rot).toPay}
                validUntilLabel={datumLang(pendingDraft.validUntil)}
                sendAction={sendQuoteAction.bind(null, quote.id)}
                detailHref={fromHere.href}
                mailConfigured={isLiveMailConfigured()}
                recipientEmail={customer.email}
                canSend={canSend}
              />
            </div>
          )}
        </Card>
      ) : null}

      {quote.status === "skickad" ? (
        <Card className="mb-6 flex items-start gap-3 border-warn/20 bg-warn-soft/40 px-5 py-4">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-warn" />
          <div className="text-[14px] leading-relaxed text-soft">
            <span className="font-medium text-ink">Offerten är skickad och väntar på att {customer.name} ska godkänna.</span>{" "}
            Skickad {quote.sentAt ? relativ(quote.sentAt) : ""}
            {quote.viewedAt ? `, öppnad av kunden ${relativ(quote.viewedAt)}` : ", inte öppnad ännu"}.
            {quote.followUps.length > 0 ? ` ${quote.followUps.length} påminnelse${quote.followUps.length > 1 ? "r" : ""} skickad.` : ""}{" "}
            Kunden godkänner direkt i offertlänken genom att skriva sitt namn och trycka Godkänn offert.
          </div>
        </Card>
      ) : null}

      {isQuoteWithdrawnByOwner(quote) ? (
        <Card className="mb-6 px-5 py-4 text-[14px] text-soft">
          <span className="font-medium text-ink">Offerten är tillbakadragen.</span> Kunden kan inte längre godkänna den.
        </Card>
      ) : null}

      {acceptance ? (
        <div data-quote-owner-accepted="">
        <Card className="mb-6 px-5 py-4">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px]">
            <BadgeCheck className="size-5 shrink-0 text-ok" />
            <span className="font-semibold text-ok">{acceptedByLabel(acceptance)}</span>
            <span className="text-soft">· {datumTid(acceptance.acceptedAt)}</span>
            <a
              href={`${publicPath}/underlag`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-accent-deep hover:underline"
            >
              <FileLock2 className="size-3.5" /> Visa intyg
            </a>
          </p>
        </Card>
        </div>
      ) : null}

      <div className="mb-6 lg:hidden">
        <LinkedToBox view={linkView} />
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="overflow-hidden rounded-2xl border border-line shadow-card">{doc}</div>

        <div className="space-y-8">
          <div className="hidden lg:block">
            <LinkedToBox view={linkView} />
          </div>

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
                    ? {
                        label: isQuoteWithdrawnByOwner(quote) ? "Tillbakadragen" : QUOTE_TIMELINE.avbojd,
                        at: quote.decidedAt,
                        done: true,
                      }
                    : {
                        // Historiken är precis: vem som godkände hör hemma här, inte i statusen.
                        label: acceptance ? acceptedByLabel(acceptance) : QUOTE_TIMELINE.godkand,
                        at: acceptance?.acceptedAt,
                        done: !!acceptance,
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
                    {v.lockedAt ? <Badge tone="ok">Låst</Badge> : <Badge tone="neutral">Utkast</Badge>}
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
