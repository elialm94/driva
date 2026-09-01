import Link from "next/link";

/** Minimal publik ram för Drivas juridiska sidor (villkor, integritet). */
export default function JuridikLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="text-xl font-semibold tracking-tight">
          Driva
        </Link>
        <a href="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-soft transition-colors hover:text-ink">
          Logga in
        </a>
      </header>
      <main className="mx-auto max-w-3xl px-5 pb-20 pt-4 sm:px-8">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-8 text-sm text-muted sm:px-8">
          <span className="font-semibold tracking-tight text-soft">Driva</span>
          <nav className="flex items-center gap-6">
            <a href="/integritet" className="transition-colors hover:text-ink">
              Integritetspolicy
            </a>
            <a href="/villkor" className="transition-colors hover:text-ink">
              Villkor
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
