import type { ReactNode } from "react";

/**
 * Delade byggstenar för Drivas publika ytor (landning, villkor, integritet).
 *
 * Medvetet rena server-komponenter med vanliga <a>-länkar: inga
 * router-prefetches av appens tunga klientdelar, och navigering till "/"
 * går alltid genom proxyn (som avgör landning kontra app).
 */

export function MarketingHeader({ cta = true }: { cta?: boolean }) {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
      <a href="/" className="text-xl font-semibold tracking-tight text-ink">
        Driva
      </a>
      <nav className="flex items-center gap-3 sm:gap-4">
        <a
          href="/login"
          className="rounded-lg px-3 py-2 text-sm font-medium text-soft hover:bg-white hover:text-ink"
        >
          Logga in
        </a>
        {cta ? (
          <a
            href="/signup"
            className="hidden rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-deep sm:block"
          >
            Testa gratis
          </a>
        ) : null}
      </nav>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-3 px-5 py-8 text-sm text-muted sm:flex-row sm:justify-between sm:px-8">
        <p className="font-medium text-soft">Driva © {new Date().getFullYear()}</p>
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <a href="/integritet" className="hover:text-ink hover:underline">
            Integritetspolicy
          </a>
          <a href="/villkor" className="hover:text-ink hover:underline">
            Villkor
          </a>
          <a href="/login" className="hover:text-ink hover:underline">
            Logga in
          </a>
        </nav>
      </div>
    </footer>
  );
}

/** Enkel dokumentyta för villkor/integritetspolicy. */
export function MarketingDocument({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <MarketingHeader cta={false} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10 sm:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-sm text-muted">Senast uppdaterad: {updated}</p>
        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-soft">{children}</div>
      </main>
      <MarketingFooter />
    </div>
  );
}

export function DocSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink">{heading}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}
