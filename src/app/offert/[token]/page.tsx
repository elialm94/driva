import { notFound } from "next/navigation";
import { BadgeCheck, FileLock2, XCircle, Clock } from "lucide-react";
import { db } from "@/lib/store";
import { getQuoteByToken, currentVersion, quoteSignature, quoteTotals, requireCustomer } from "@/lib/services/data";
import { markQuoteViewed } from "@/lib/services/quotes";
import { kr, datumTid, datumLang, dagarTill } from "@/lib/format";
import { QUOTE_ACCEPTANCE_ID, QuoteDocument } from "@/components/quote-document";
import { QuoteSignBar } from "@/components/quote-sign-bar";
import { CompanyLogo } from "@/components/company-logo";
import { signedWithBankIdBy } from "@/lib/status-labels";
import { BankIDApproval, DeclineQuoteButton, QuoteQuestionButton } from "@/components/bankid-flow";
import { PrintButton } from "@/components/print-button";
import { DemoTag } from "@/components/ui";
import { resolveQuoteCompany } from "@/lib/invoices/snapshot";
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
  const signature = quoteSignature(quote.id);
  const totals = quoteTotals(quote);
  const expired = quote.status === "skickad" && dagarTill(version.validUntil) < 0;
  const canSign = quote.status === "skickad" && !expired;

  const seller = resolveQuoteCompany(version, data.settings);

  const approval = canSign ? (
    <BankIDApproval
      token={quote.token}
      quoteNumber={quote.number}
      toPay={kr(totals.toPay)}
      companyName={seller.name}
    />
  ) : undefined;

  return (
    <div className="min-h-dvh bg-canvas print:bg-white">
      <header className="border-b border-line bg-card/80 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <CompanyLogo company={seller} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold leading-tight">{seller.name}</p>
              <p className="truncate text-[12px] text-muted">Offert #{quote.number} till {customer.name}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <p className="text-[15px] font-semibold tabular">{kr(totals.toPay)}</p>
            <PrintButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-5 print:max-w-none print:px-0 print:py-0">
        {quote.status === "godkand" && signature ? (
          <div className="mb-6 rounded-2xl border border-ok/25 bg-ok-soft/70 px-5 py-4 animate-fade-up">
            <div className="flex items-start gap-3">
              <BadgeCheck className="mt-0.5 size-5 shrink-0 text-ok" />
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[15px] font-semibold text-ok">Offerten är signerad</p>
                  {signature.environment === "mock" ? <DemoTag>Demo-signering</DemoTag> : null}
                </div>
                <p className="mt-0.5 text-[14px] text-soft">
                  Tack! {signedWithBankIdBy(signature.signerName)}, {datumTid(signature.signedAt)}.
                </p>
                <a
                  href={`/offert/${quote.token}/underlag`}
                  className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-bankid hover:underline print:hidden"
                >
                  <FileLock2 className="size-3.5" /> Visa signeringsunderlag
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
                Ändrat dig? Hör av dig till {seller.name} på {seller.phone} så tar vi det därifrån.
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
                Giltighetstiden gick ut {datumLang(version.validUntil)}. Kontakta {seller.name} för en uppdaterad
                offert.
              </p>
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-card print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
          <QuoteDocument
            company={data.settings}
            customer={customer}
            quote={quote}
            version={version}
            signature={signature}
            approval={approval}
          />
        </div>

        <p className="mt-6 text-center text-[12px] text-muted print:hidden">
          Skickad med Driva · Frågor? Kontakta {seller.name} på {seller.email}
        </p>
        <div className="h-28 print:hidden" />
      </main>

      {canSign ? (
        <QuoteSignBar watchElementId={QUOTE_ACCEPTANCE_ID}>
          <div className="mx-auto flex max-w-3xl flex-col gap-2.5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex items-center justify-between gap-3 sm:block">
              <p className="text-[14px] font-medium">
                Att betala: <span className="font-semibold">{kr(totals.toPay)}</span>
              </p>
              <DeclineQuoteButton token={quote.token} />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <QuoteQuestionButton token={quote.token} companyName={seller.name} />
              <BankIDApproval
                token={quote.token}
                quoteNumber={quote.number}
                toPay={kr(totals.toPay)}
                companyName={seller.name}
              />
            </div>
          </div>
        </QuoteSignBar>
      ) : null}
    </div>
  );
}
