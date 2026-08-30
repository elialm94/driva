import type { Metadata } from "next";
import Link from "next/link";
import { DemoStartForm } from "./demo-start-form";

export const metadata: Metadata = { title: "Testa Driva – Driva" };
export const dynamic = "force-dynamic";

/**
 * Publik demo-entré: så lite text som möjligt. Knappen skapar en isolerad
 * demosession och landar i appen med Södermalms Snickeri AB.
 */
export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ utgangen?: string }>;
}) {
  const params = await searchParams;
  const expired = params.utgangen === "1";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-2xl font-semibold tracking-tight text-stone-900">Driva</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          {expired ? (
            <p role="status" className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Demosessionen har gått ut. Öppna demon igen för att fortsätta.
            </p>
          ) : null}
          <h1 className="text-center text-xl font-semibold tracking-tight text-stone-900">Testa Driva</h1>
          <p className="mt-2 text-center text-sm text-stone-500">
            Se hur Driva fungerar med ett färdigt exempelföretag.
          </p>
          <div className="mt-6">
            <DemoStartForm />
          </div>
          <p className="mt-5 text-center text-sm text-stone-500">
            Har du redan ett konto?{" "}
            <Link href="/login" className="font-medium text-stone-900 underline">
              Logga in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
