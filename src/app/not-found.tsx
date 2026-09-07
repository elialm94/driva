import Link from "next/link";

/**
 * Global 404 för adresser som inte matchar någon rutt (och notFound() utanför
 * (app), t.ex. en offert- eller fakturalänk vars token inte finns). Ersätter
 * Next.js inbyggda engelska sida. Rotlayouten ligger kvar men inget appskal.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-sm">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-stone-400">404</p>
        <h1 className="mt-2 text-lg font-semibold tracking-tight text-stone-900">Sidan finns inte</h1>
        <p className="mt-2 text-sm text-stone-500">
          Länken kan vara fel eller ha slutat gälla. Har du fått den i ett mejl – be avsändaren skicka en ny.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Link
            href="/"
            className="w-full rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
          >
            Till startsidan
          </Link>
        </div>
      </div>
    </main>
  );
}
