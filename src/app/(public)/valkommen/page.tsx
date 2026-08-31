import type { Metadata } from "next";
import { MarketingFooter, MarketingHeader } from "../marketing";

export const metadata: Metadata = {
  title: "Driva – mindre administration, mer tid till jobbet",
  description:
    "Offerter, fakturor, kunder och bokföring för småföretagare. Testa gratis i 14 dagar.",
};

/**
 * Drivas publika landningssida. Utloggade besökare på "/" rewritas hit av
 * proxyn (URL:en förblir "/"); inloggade ser appens Hem som vanligt.
 *
 * Hålls medvetet lätt: ren server-rendering, inga kartor, ingen demo-seed
 * och inga av appens klientkomponenter. Produktvisualen är en statisk,
 * handbyggd återgivning av Hem-vyn med samma designtokens som produkten.
 */

const PRICE_LINE = "199 kr/mån efter provperioden · Inget kort krävs · Säg upp när du vill";

const STEPS: { label: string; title: string; body: string }[] = [
  {
    label: "1",
    title: "Få jobbet",
    body: "Skicka proffsiga offerter från mobilen. Kunden godkänner digitalt – med BankID när det behövs.",
  },
  {
    label: "2",
    title: "Gör jobbet",
    body: "Kunder, uppdrag, tid och material på ett ställe. Allt du loggar följer med hela vägen till fakturan.",
  },
  {
    label: "3",
    title: "Få betalt",
    body: "Skapa fakturan direkt från jobbet och ha koll på vad som är skickat, betalt och förfallet.",
  },
  {
    label: "4",
    title: "Slipp administrationen",
    body: "Kvitton, leverantörsfakturor, ROT/RUT och bokföring sköts löpande – inte i en hög i december.",
  },
];

function CtaButtons({ align = "start" }: { align?: "start" | "center" }) {
  return (
    <div
      className={`flex flex-col gap-3 sm:flex-row ${align === "center" ? "items-center justify-center" : "items-stretch sm:items-center"}`}
    >
      <a
        href="/signup"
        className="rounded-xl bg-accent px-6 py-3.5 text-center text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-deep"
      >
        Testa gratis i 14 dagar
      </a>
      <a
        href="/demo"
        className="rounded-xl border border-line-strong bg-white px-6 py-3.5 text-center text-[15px] font-semibold text-ink transition-colors hover:bg-accent-soft"
      >
        Se demo
      </a>
    </div>
  );
}

/** Statisk, lättviktig återgivning av Hem-vyn – ingen riktig data laddas. */
function ProductVisual() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-3xl">
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line bg-canvas px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="ml-3 text-[12px] font-medium text-muted">Driva · Hem</span>
        </div>
        <div className="px-5 py-5 sm:px-7 sm:py-6">
          <p className="text-[12px] font-medium text-muted">Torsdag 14 augusti</p>
          <p className="mt-0.5 text-xl font-semibold tracking-tight text-ink">God morgon!</p>

          <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Behöver din uppmärksamhet
          </p>
          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-ink">
                  Offert · Altanbygge – Göran Eriksson
                </p>
                <p className="text-[12px] text-muted">Skickad för 5 dagar sedan</p>
              </div>
              <span className="shrink-0 rounded-full bg-warn-soft px-2.5 py-1 text-[11px] font-semibold text-warn">
                Väntar på signering
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-ink">
                  Faktura 2026-14 · 46 500 kr
                </p>
                <p className="text-[12px] text-muted">BRF Sjöutsikten</p>
              </div>
              <span className="shrink-0 rounded-full bg-danger-soft px-2.5 py-1 text-[11px] font-semibold text-danger">
                Förfallen
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-ink">
                  Kvitto · Beijer Byggmaterial, 2 340 kr
                </p>
                <p className="text-[12px] text-muted">Fotat i går</p>
              </div>
              <span className="shrink-0 rounded-full bg-info-soft px-2.5 py-1 text-[11px] font-semibold text-info">
                Att bokföra
              </span>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { label: "Offererat", value: "182 400 kr" },
              { label: "Att fakturera", value: "38 250 kr" },
              { label: "Betalt i aug", value: "96 800 kr" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-line bg-canvas px-3 py-2.5">
                <p className="text-[11px] font-medium text-muted">{s.label}</p>
                <p className="tabular mt-0.5 truncate text-[13px] font-semibold text-ink sm:text-[15px]">
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card absolute -bottom-5 right-3 hidden items-center gap-2.5 px-4 py-3 sm:flex">
        <span className="flex size-7 items-center justify-center rounded-full bg-ok-soft text-[13px] font-bold text-ok">
          ✓
        </span>
        <div>
          <p className="text-[13px] font-semibold text-ink">Offert godkänd med BankID</p>
          <p className="text-[12px] text-muted">Köksrenovering · 148 000 kr</p>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <MarketingHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto w-full max-w-5xl px-5 pb-14 pt-10 sm:px-8 sm:pb-20 sm:pt-16">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-balance text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
              Driva ditt företag. Inte administrationen.
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-[17px] leading-relaxed text-soft">
              Offerter, fakturor, kunder och bokföring på ett ställe. Driva hjälper dig från
              första förfrågan tills pengarna är på kontot.
            </p>
            <div className="mt-7">
              <CtaButtons align="center" />
            </div>
            <p className="mt-3.5 text-[13px] text-muted">{PRICE_LINE}</p>
          </div>

          <div className="mt-12 sm:mt-16">
            <ProductVisual />
          </div>
        </section>

        {/* Så fungerar det */}
        <section className="border-y border-line bg-white">
          <div className="mx-auto w-full max-w-5xl px-5 py-14 sm:px-8 sm:py-20">
            <h2 className="text-center text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              Så fungerar det
            </h2>
            <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step) => (
                <div key={step.label}>
                  <div className="flex size-9 items-center justify-center rounded-full bg-accent-soft text-[15px] font-bold text-accent">
                    {step.label}
                  </div>
                  <h3 className="mt-3 text-[15px] font-semibold uppercase tracking-[0.04em] text-ink">
                    {step.title}
                  </h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-soft">{step.body}</p>
                </div>
              ))}
            </div>

            <p className="mt-12 text-center text-[14px] font-medium text-soft">
              <span className="inline-flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5">
                <span>✓ ROT/RUT</span>
                <span>✓ BankID</span>
                <span>✓ Kvitton &amp; bokföring</span>
                <span>✓ Egen hemsida</span>
              </span>
            </p>
          </div>
        </section>

        {/* Slut-CTA */}
        <section className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 sm:py-24">
          <div className="mx-auto max-w-xl text-center">
            <h2 className="text-balance text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              Redo att slippa administrationen?
            </h2>
            <div className="mt-6 flex justify-center">
              <a
                href="/signup"
                className="rounded-xl bg-accent px-7 py-3.5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-deep"
              >
                Testa gratis i 14 dagar
              </a>
            </div>
            <p className="mt-3.5 text-[13px] text-muted">
              14 dagar gratis · Inget kreditkort · 199 kr/mån därefter · Säg upp när du vill
            </p>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
