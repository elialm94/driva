import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
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
  currentVersion,
  quoteSignature,
  quoteTotals,
  requireCustomer,
  quoteVersions,
} from "@/lib/services/data";
import { kr, datumTid, relativ } from "@/lib/format";
import { Badge, ButtonLink, Card, SectionTitle, cx } from "@/components/ui";
import { QuoteStatusBadge, InvoiceStatusBadge } from "@/components/status";
import { QuoteDocument } from "@/components/quote-document";
import { PreviewModal } from "@/components/preview-modal";
import { CopyLinkButton } from "@/components/copy-button";
import { CreatePartInvoiceButton, FollowUpButton } from "@/components/money-widgets";
import { sendQuoteAction } from "@/app/actions";
import { docTotals } from "@/lib/calc";

export const metadata = { title: "Offert" };

export default async function QuotePage(props: PageProps<"/pengar/offerter/[id]">) {
  const { id } = await props.params;
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

  const invoicedTotal = relatedInvoices
    .filter((i) => i.status !== "krediterad")
    .reduce((s, i) => s + docTotals(i.lines, i.rot).total, 0);

  const doc = (
    <QuoteDocument company={data.settings} customer={customer} quote={quote} version={version} signature={signature} />
  );

  return (
    <div className="animate-fade-up">
      <Link href="/pengar?flik=offerter" className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Offerter
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-semibold tracking-tight">Offert #{quote.number}</h1>
            <QuoteStatusBadge quote={quote} />
            {version.lockedAt ? (
              <Badge tone="bankid">
                <FileLock2 className="size-3" /> Version {version.version} låst
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-[15px] text-soft">
            {version.title} · <Link href={`/kunder/${customer.id}` as never} className="font-medium text-ink hover:underline">{customer.name}</Link> · {kr(totals.toPay)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {quote.status === "utkast" ? (
            <>
              <ButtonLink href={`/pengar/offerter/${quote.id}/redigera`} variant="secondary">
                <Pencil className="size-4" /> Redigera
              </ButtonLink>
              <PreviewModal
                triggerLabel="Förhandsgranska & skicka"
                title={`Så här ser ${customer.name.split(" ")[0]} offerten`}
                document={doc}
                mode="send"
                sendAction={sendQuoteAction.bind(null, quote.id)}
                sendLabel="Skicka offert"
                sentTitle="Offerten är skickad"
                sentText={`Kunden får ett mejl med en länk där offerten godkänns med BankID.`}
                publicPath={publicPath}
                recipientEmail={customer.email}
              />
            </>
          ) : null}
          {quote.status === "skickad" ? (
            <>
              <FollowUpButton quoteId={quote.id} />
              <CopyLinkButton path={publicPath} />
              <a href={publicPath} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-soft hover:bg-ink/5 hover:text-ink">
                <ExternalLink className="size-3.5" /> Öppna kundvyn
              </a>
              <PreviewModal
                triggerLabel="Så här ser kunden offerten"
                triggerVariant="secondary"
                title={`Så här ser ${customer.name.split(" ")[0]} offerten`}
                document={doc}
                mode="view"
                publicPath={publicPath}
              />
            </>
          ) : null}
          {quote.status === "godkand" || quote.status === "avbojd" ? (
            <>
              <ButtonLink href={`/pengar/offerter/${quote.id}/redigera`} variant="secondary" size="md">
                <Pencil className="size-4" /> Ny version
              </ButtonLink>
              <PreviewModal
                triggerLabel="Visa offerten"
                triggerVariant="secondary"
                title={`Så här ser ${customer.name.split(" ")[0]} offerten`}
                document={doc}
                mode="view"
                publicPath={publicPath}
              />
            </>
          ) : null}
        </div>
      </div>

      {quote.status === "skickad" ? (
        <Card className="mb-6 flex items-start gap-3 border-warn/20 bg-warn-soft/40 px-5 py-4">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-warn" />
          <div className="text-[14px] leading-relaxed text-soft">
            <span className="font-medium text-ink">Väntar på BankID-godkännande.</span> Skickad {quote.sentAt ? relativ(quote.sentAt) : ""}
            {quote.viewedAt ? `, öppnad av kunden ${relativ(quote.viewedAt)}` : ", inte öppnad ännu"}.
            {quote.followUps.length > 0 ? ` ${quote.followUps.length} påminnelse${quote.followUps.length > 1 ? "r" : ""} skickad.` : ""}{" "}
            I demoläget kan du öppna kundvyn själv och genomföra BankID-flödet.
          </div>
        </Card>
      ) : null}

      {signature ? (
        <Card className="mb-6 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <BadgeCheck className="mt-0.5 size-5 shrink-0 text-ok" />
              <div>
                <p className="text-[15px] font-semibold text-ok">Godkänd med BankID</p>
                <p className="text-[14px] text-soft">
                  {signature.signerName} · {datumTid(signature.signedAt)}
                </p>
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
                  <Link href={`/uppdrag/${job.id}` as never} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 transition-colors hover:bg-canvas">
                    <Hammer className="size-4 text-accent" />
                    <div className="flex-1">
                      <p className="text-[14px] font-medium">{job.title}</p>
                      <p className="text-[12px] text-muted">Uppdrag</p>
                    </div>
                  </Link>
                ) : null}
                {version.paymentPlan.map((part, i) => {
                  const alreadyInvoiced = i < relatedInvoices.filter((inv) => inv.status !== "krediterad").length;
                  const partAmount = Math.round((totals.total * part.percent) / 100);
                  if (invoicedTotal >= totals.total) return null;
                  return alreadyInvoiced ? null : (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <p className="text-[13px] text-soft">
                        {part.label} · {kr(partAmount)}
                      </p>
                      <CreatePartInvoiceButton quoteId={quote.id} partIndex={i} label="Fakturera" />
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
                    href={`/pengar/fakturor/${inv.id}` as never}
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
                  { label: "Skapad", at: quote.createdAt, done: true },
                  { label: "Skickad", at: quote.sentAt, done: !!quote.sentAt },
                  { label: "Öppnad av kunden", at: quote.viewedAt, done: !!quote.viewedAt },
                  ...quote.followUps.map((f, i) => ({ label: `Påminnelse ${i + 1}`, at: f as string | undefined, done: true })),
                  quote.status === "avbojd"
                    ? { label: "Avböjd", at: quote.decidedAt, done: true }
                    : { label: "Godkänd med BankID", at: signature?.signedAt, done: !!signature },
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
