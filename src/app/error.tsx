"use client";

import { useEffect } from "react";

/**
 * Segmentgräns. Root-layoutfel och avhuggna RSC-navigeringar fångas i
 * global-error.tsx (annars Next.js engelska "This page couldn't load").
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold tracking-tight text-stone-900">Sidan kunde inte laddas</h1>
        <p className="mt-2 text-sm text-stone-500">
          Något gick fel när sidan hämtades. Försök igen, eller gå tillbaka till startsidan.
        </p>
        {error.digest ? <p className="mt-2 font-mono text-[11px] text-stone-400">{error.digest}</p> : null}
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => retry()}
            className="w-full rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
          >
            Försök igen
          </button>
          <a
            href="/"
            className="w-full rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            Till startsidan
          </a>
        </div>
      </div>
    </main>
  );
}
