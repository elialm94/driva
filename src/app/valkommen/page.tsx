import type { Metadata } from "next";
import Link from "next/link";
import { HomePreview } from "@/components/home-preview";

/**
 * Drivas publika landningssida.
 *
 * Serveras på "/" för utloggade besökare via proxyns rewrite (URL:en förblir
 * "/"); direktbesök på /valkommen skickas till "/". Sidan är ren server-HTML
 * utan klientbibliotek, kartor eller demo-seed – demosessionen provisioneras
 * först när besökaren klickar "Se demo". Vanliga <a>-länkar i stället för
 * <Link>: fulla dokumentnavigeringar, ingen prefetch av appen från landningen.
 */

export const metadata: Metadata = {
  title: { absolute: "Driva – mindre administration, mer tid till jobbet" },
  description: "Offerter, fakturor, kunder och bokföring för småföretagare. Testa gratis i 14 dagar.",
};

const STEPS = [
  {
    n: "1",
    title: "Få jobbet",
    body: "Skapa och skicka professionella offerter. Kunden kan godkänna digitalt eller med BankID.",
  },
  {
    n: "2",
    title: "Gör jobbet",
    body: "Håll koll på kunder, uppdrag, tid och material.",
  },
  {
    n: "3",
    title: "Få betalt",
    body: "Skapa fakturan direkt från jobbet och håll koll på vad som är betalt.",
  },
  {
    n: "4",
    title: "Slipp administrationen",
    body: "Kvitton, leverantörsfakturor, ROT/RUT och bokföring hanteras så enkelt och automatiskt som möjligt.",
  },
];

const FEATURES = ["ROT/RUT", "BankID", "Kvitton & bokföring", "Egen hemsida"];

function CtaButtons({ center = false }: { center?: boolean }) {
  return (
    <div className={`flex flex-col gap-3 sm:flex-row ${center ? "sm:justify-center" : ""}`}>
      <a
        href="/signup"
        className="inline-flex items-center justify-center rounded-xl bg-accent px-6 py-3.5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-deep"
      >
        Testa gratis i 14 dagar
      </a>
      <a
        href="/demo"
        className="inline-flex items-center justify-center rounded-xl border border-line-strong bg-card px-6 py-3.5 text-[15px] font-semibold text-ink transition-colors hover:bg-stone-50"
      >
        Se demo
      </a>
    </div>
  );
}


export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="text-xl font-semibold tracking-tight">
          Driva
        </Link>
        <nav className="flex items-center gap-2 sm:gap-3">
          <a
            href="/login"
            className="rounded-lg px-3 py-2 text-sm font-medium text-soft transition-colors hover:text-ink"
          >
            Logga in
          </a>
          <a
            href="/signup"
            className="rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-deep"
          >
            Testa gratis
          </a>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-5xl px-5 pb-16 pt-10 sm:px-8 sm:pt-16">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-[52px]">
              Driva ditt företag. Inte administrationen.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-[17px] leading-relaxed text-soft">
              Offerter, fakturor, kunder och bokföring på ett ställe. Driva hjälper dig från första förfrågan
              tills pengarna är på kontot.
            </p>
            <div className="mt-8 flex justify-center">
              <CtaButtons center />
            </div>
            <p className="mt-4 text-[13px] text-muted">
              199 kr/mån efter provperioden · Inget kort krävs · Säg upp när du vill
            </p>
          </div>

          <div className="mt-14 sm:mt-16">
            <HomePreview />
            <p className="mx-auto mt-5 max-w-md text-center text-[15px] leading-relaxed text-soft">
              Driva håller koll. Du säger bara vad du vill göra.
            </p>
          </div>

          <ul className="mx-auto mt-10 flex max-w-2xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-soft">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-1.5">
                <svg viewBox="0 0 16 16" className="size-4 text-accent" fill="none" aria-hidden>
                  <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {f}
              </li>
            ))}
          </ul>
        </section>

        <section className="border-t border-line bg-card">
          <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
            <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">Så fungerar det</h2>
            <ol className="mx-auto mt-10 grid max-w-4xl gap-8 sm:grid-cols-2 sm:gap-x-12 sm:gap-y-10">
              {STEPS.map((s) => (
                <li key={s.n} className="flex gap-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-deep">
                    {s.n}
                  </span>
                  <div>
                    <h3 className="text-[17px] font-semibold">{s.title}</h3>
                    <p className="mt-1 text-[15px] leading-relaxed text-soft">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
          <div className="mx-auto max-w-xl text-center">
            <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              Redo att slippa administrationen?
            </h2>
            <div className="mt-7 flex justify-center">
              <a
                href="/signup"
                className="inline-flex items-center justify-center rounded-xl bg-accent px-7 py-3.5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-deep"
              >
                Testa gratis i 14 dagar
              </a>
            </div>
            <p className="mt-4 text-[13px] text-muted">
              14 dagar gratis · Inget kreditkort · 199 kr/mån därefter · Säg upp när du vill
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-5 py-8 text-sm text-muted sm:flex-row sm:px-8">
          <span className="font-semibold tracking-tight text-soft">Driva</span>
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <a href="/integritet" className="transition-colors hover:text-ink">
              Integritetspolicy
            </a>
            <a href="/villkor" className="transition-colors hover:text-ink">
              Villkor
            </a>
            <a href="/login" className="transition-colors hover:text-ink">
              Logga in
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
