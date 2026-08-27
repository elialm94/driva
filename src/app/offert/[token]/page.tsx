import { notFound } from "next/navigation";
import { BadgeCheck, FileLock2, XCircle, Clock } from "lucide-react";
import { db } from "@/lib/store";
import { getQuoteByToken, currentVersion, quoteSignature, quoteTotals, requireCustomer } from "@/lib/services/data";
import { markQuoteViewed } from "@/lib/services/quotes";
import { kr, datumTid, datumLang, dagarTill } from "@/lib/format";
import { QuoteDocument } from "@/components/quote-document";
import { BankIDApproval, DeclineQuoteButton, QuoteQuestionButton } from "@/components/bankid-flow";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/offert/[token]">) {
  const { token } = await props.params;
  const quote = getQuoteByToken(token);
  return { title: quote ? `Offert #${quote.number} – ${db().settings.name}` : "Offert" };
}

export default async function PublicQuotePage(props: PageProps<"/offert/[token]">) {
  const { token } = await props.params;
  const quote = getQuoteByToken(token);
  if (!quote || quote.status === "utkast") notFound();

  markQuoteViewed(quote.id);

  const data = db();
  const version = currentVersion(quote);
  const customer = requireCustomer(quote.customerId);
  const signature = quoteSignature(quote.id);
  const totals = quoteTotals(quote);
  const expired = quote.status === "skickad" && dagarTill(version.validUntil) < 0;
  const canSign = quote.status === "skickad" && !expired;

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-accent text-[13px] font-bold text-white">
              {data.settings.logoInitials}
            </div>
            <div>
              <p className="text-[14px] font-semibold leading-tight">{data.settings.name}</p>
              <p className="text-[12px] text-muted">Offert #{quote.number} till {customer.name}</p>
            </div>
          </div>
          <p className="text-[15px] font-semibold tabular">{kr(totals.toPay)}</p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-5">
        {quote.status === "godkand" && signature ? (
          <div className="mb-6 rounded-2xl border border-ok/25 bg-ok-soft/70 px-5 py-4 animate-fade-up">
            <div className="flex items-start gap-3">
              <BadgeCheck className="mt-0.5 size-5 shrink-0 text-ok" />
              <div className="flex-1">
                <p className="text-[15px] font-semibold text-ok">Offerten är godkänd</p>
                <p className="mt-0.5 text-[14px] text-soft">
                  Tack! Din BankID-signering är registrerad. Godkänd av {signature.signerName},{" "}
                  {datumTid(signature.signedAt)}.
                </p>
                <a
                  href={`/offert/${quote.token}/underlag`}
                  className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-bankid hover:underline"
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
                Ändrat dig? Hör av dig till {data.settings.name} på {data.settings.phone} så tar vi det därifrån.
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
                Giltighetstiden gick ut {datumLang(version.validUntil)}. Kontakta {data.settings.name} för en uppdaterad
                offert.
              </p>
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-card">
          <QuoteDocument company={data.settings} customer={customer} quote={quote} version={version} signature={signature} />
        </div>

        <p className="mt-6 text-center text-[12px] text-muted">
          Skickad med Driva · Frågor? Kontakta {data.settings.name} på {data.settings.email}
        </p>
        <div className="h-28" />
      </main>

      {canSign ? (
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
          <div className="mx-auto flex max-w-3xl flex-col gap-2.5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex items-center justify-between gap-3 sm:block">
              <p className="text-[14px] font-medium">
                Att betala: <span className="font-semibold">{kr(totals.toPay)}</span>
              </p>
              <DeclineQuoteButton quoteId={quote.id} />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <QuoteQuestionButton quoteId={quote.id} companyName={data.settings.name} />
              <BankIDApproval
                token={quote.token}
                quoteNumber={quote.number}
                toPay={kr(totals.toPay)}
                companyName={data.settings.name}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
