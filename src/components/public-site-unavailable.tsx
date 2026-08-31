/** Neutral publik sida när Hemsida är avstängd eller pausad. Inget företagsinnehåll. */
export function PublicSiteUnavailable() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white px-6 py-10 text-center shadow-sm">
        <h1 className="text-[20px] font-semibold tracking-tight text-stone-900">Sidan är tillfälligt inte tillgänglig.</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-stone-600">
          Prova igen senare.
        </p>
      </div>
    </main>
  );
}
