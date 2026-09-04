import { notFound } from "next/navigation";
import { BadgeCheck, FileLock2, XCircle, Clock } from "lucide-react";
import { db } from "@/lib/store";
import { getQuoteByToken, currentVersion, quoteAcceptance, quoteTotals, requireCustomer } from "@/lib/services/data";
import { markQuoteViewed } from "@/lib/services/quotes";
import { quoteAcceptanceStatement } from "@/lib/services/quote-accept";
import { quoteVersionHash } from "@/lib/hash";
import { kr, datumTid, datumLang, dagarTill } from "@/lib/format";
import { QuoteDocument } from "@/components/quote-document";
import { CompanyLogo } from "@/components/company-logo";
import { acceptedByLabel } from "@/lib/status-labels";
import { AcceptJumpButton, QuoteAcceptForm } from "@/components/quote-accept";
import { DeclineQuoteButton, QuoteQuestionButton } from "@/components/quote-public-actions";
import { DemoTag } from "@/components/ui";
import { resolveQuoteCompany, resolveQuoteCustomer } from "@/lib/invoices/snapshot";
import { ensurePublicPage, withPublicBusiness } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/offert/[token]">) {
  const { token } = await props.params;
  if (!(await ensurePublicPage("quote", token))) return { title: "Offert" };
  const quote = getQuoteByToken(token);
  // Utkast är inte publika – läck inte offertnummer/avsändare via metadata.
  if (!quote || quote.status === "utkast") return { title: "Offert" };
  const seller = resolveQuoteCompany(currentVersion(quote), db().settings);
  return { title: `Offert #${quote.number} – ${seller.name}` };
}

/**
 * Kundens offertsida. Kunden godkänner EXAKT det dokument som visas: namn +
 * knapp i dokumentets avslutning (QuoteAcceptForm). Ingen BankID, ingen ritad
 * signatur – godkännandet sparas med versionens hash, namn, tidpunkt och
 * varifrån det gjordes.
 */
export default async function PublicQuotePage(props: PageProps<"/offert/[token]">) {
  const { token } = await props.params;
  // "Visad"-stämpeln är en mutation – den körs i ett eget skrivblock INNAN
  // sidans läs-state laddas, så att renderingen ser stämpeln direkt.
  const marked = await withPublicBusiness("quote", token, () => {
    const q = getQuoteByToken(token);
    if (!q || q.status === "utkast") return false;
    markQuoteViewed(q.id);
    return true;
  });
  if (marked === null || marked === false) notFound();
  if (!(await ensurePublicPage("quote", token))) notFound();
  const quote = getQuoteByToken(token);
  if (!quote || quote.status === "utkast") notFound();

  const data = db();
  const version = currentVersion(quote);
  const customer = requireCustomer(quote.customerId);
  const acceptance = quoteAcceptance(quote.id);
  const totals = quoteTotals(quote);
  const expired = quote.status === "skickad" && dagarTill(version.validUntil) < 0;
  const canAccept = quote.status === "skickad" && !expired;

  const seller = resolveQuoteCompany(version, data.settings);
  const buyer = resolveQuoteCustomer(version, customer);
  // Förifyll med personens namn – för företag kontaktpersonen, inte bolaget.
  const prefillName = buyer.kind === "foretag" ? (buyer.contactPerson ?? "") : buyer.name;
  const contentHash = quoteVersionHash(version);

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <CompanyLogo company={seller} size="sm" />
            <div>
              <p className="text-[14px] font-semibold leading-tight">{seller.name}</p>
              <p className="text-[12px] text-muted">Offert #{quote.number} till {customer.name}</p>
            </div>
          </div>
          <p className="text-[15px] font-semibold tabular">{kr(totals.toPay)}</p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-5">
        {quote.status === "godkand" && acceptance ? (
          <div
            data-quote-accepted-banner=""
            className="mb-6 rounded-2xl border border-ok/25 bg-ok-soft/70 px-5 py-4 animate-fade-up"
          >
            <div className="flex items-start gap-3">
              <BadgeCheck className="mt-0.5 size-5 shrink-0 text-ok" />
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[15px] font-semibold text-ok">Offerten är godkänd</p>
                  {acceptance.method === "bankid_mock" ? <DemoTag>Demo</DemoTag> : null}
                </div>
                <p className="mt-0.5 text-[14px] text-soft">
                  {acceptedByLabel(acceptance)}, {datumTid(acceptance.acceptedAt)} · {kr(totals.toPay)}
                </p>
                <a
                  href={`/offert/${quote.token}/underlag`}
                  className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-deep hover:underline"
                >
                  <FileLock2 className="size-3.5" /> Visa underlag för godkännandet
                </a>
              </div>
            </div>
          </div>
        ) : null}

        {quote.status === "avbojd" ? (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-line bg-card px-5 py-4">
            <XCircle className="mt-0.5 size-5 shrink-0 text-muted" />
            <div>
              <p className="text-[15px] font-semibold">Offerten är avböjd</p>
              <p className="text-[14px] text-soft">
                Offerten kan inte längre godkännas här. Ändrat dig? Hör av dig till {seller.name} på {seller.phone} så
                tar vi det därifrån.
              </p>
            </div>
          </div>
        ) : null}

        {expired ? (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-warn/25 bg-warn-soft/60 px-5 py-4">
            <Clock className="mt-0.5 size-5 shrink-0 text-warn" />
            <div>
              <p className="text-[15px] font-semibold text-warn">Offerten har gått ut</p>
              <p className="text-[14px] text-soft">
                Giltighetstiden gick ut {datumLang(version.validUntil)} och offerten kan inte längre godkännas.
                Kontakta {seller.name} för en uppdaterad offert.
              </p>
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-card">
          <QuoteDocument
            company={data.settings}
            customer={customer}
            quote={quote}
            version={version}
            acceptance={acceptance}
            acceptForm={
              // Godkännandet hör hemma i dokumentets avslutning – inte i en popover.
              canAccept ? (
                <QuoteAcceptForm
                  token={quote.token}
                  statement={quoteAcceptanceStatement(quote, version)}
                  prefillName={prefillName}
                  contentHash={contentHash}
                />
              ) : undefined
            }
          />
        </div>

        <p className="mt-6 text-center text-[12px] text-muted">
          Skickad med Driva · Frågor? Kontakta {seller.name} på {seller.email}
          <br />
          <a href={`/offert/${quote.token}/pdf`} target="_blank" rel="noreferrer" className="mt-1 inline-block font-medium text-soft underline-offset-2 hover:text-ink hover:underline">
            Skriv ut eller spara som PDF
          </a>
        </p>
        {/* Luft under dokumentet så att formuläret aldrig hamnar under bottenlisten. */}
        <div className={canAccept ? "h-36" : "h-10"} />
      </main>

      {canAccept ? (
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
          <div className="mx-auto flex max-w-3xl flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4">
            <div className="flex items-center justify-between gap-3 sm:block">
              {/* Inget betalas vid godkännandet – beloppet är offertens värde. */}
              <p className="text-[14px] font-medium">
                Offertvärde: <span className="font-semibold">{kr(totals.toPay)}</span>
              </p>
              <DeclineQuoteButton token={quote.token} />
            </div>
            <div className="flex gap-2 sm:items-center">
              <QuoteQuestionButton token={quote.token} companyName={seller.name} />
              <AcceptJumpButton />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
