/**
 * 404 för en publik tokenlänk (offert/faktura/ändring/uppdrag). Avsändaren är
 * företaget kunden känner – ingen FervaMark, ingen länk in i produkten.
 */
export function PublicDocumentNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-sm">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-stone-400">404</p>
        <h1 className="mt-2 text-lg font-semibold tracking-tight text-stone-900">Sidan finns inte</h1>
        <p className="mt-2 text-sm text-stone-500">
          Länken kan vara fel eller ha slutat gälla. Har du fått den i ett mejl – be avsändaren skicka en
          ny.
        </p>
      </div>
    </main>
  );
}
