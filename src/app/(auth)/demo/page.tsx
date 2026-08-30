import type { Metadata } from "next";
import Link from "next/link";
import { isSupabaseMode } from "@/lib/storage/config";
import { isDemoLoginConfigured } from "@/lib/auth/demo-session";
import { DemoStartForm } from "./demo-start-form";

export const metadata: Metadata = { title: "Prova Driva – Driva" };
export const dynamic = "force-dynamic";

/**
 * Publik demo-entré: inget konto, ingen e-post. Knappen startar en riktig,
 * tidsbegränsad demosession på servern (se demo-actions.ts) och landar i
 * appen med Södermalms Snickeri AB:s exempeldata.
 */
export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ utgangen?: string }>;
}) {
  const params = await searchParams;
  const expired = params.utgangen === "1";
  // JSON-läget (lokal utveckling) är alltid demo; i Supabase-läget krävs den
  // seedade demo-användaren + servermiljön (DEMO_USER_EMAIL/-PASSWORD).
  const available = !isSupabaseMode() || isDemoLoginConfigured();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-semibold tracking-tight text-stone-900">Driva</div>
          <p className="mt-1 text-sm text-stone-500">Prova Driva</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          {expired ? (
            <p role="status" className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Demosessionen har gått ut. Öppna demon igen för att fortsätta utforska.
            </p>
          ) : null}
          <p className="text-sm text-stone-600">
            Utforska en färdig demo med exempeldata för snickeriföretaget{" "}
            <span className="font-medium text-stone-900">Södermalms Snickeri AB</span> – kunder,
            offerter, fakturor och bokföring. Inget konto behövs, och ingenting du gör skickas
            vidare utanför demon.
          </p>
          <div className="mt-5">
            {available ? (
              <DemoStartForm />
            ) : (
              <p role="status" className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
                Demon är inte tillgänglig i den här miljön ännu.
              </p>
            )}
          </div>
          <p className="mt-4 text-center text-sm text-stone-500">
            Redo för ditt eget företag?{" "}
            <Link href="/login" className="font-medium text-stone-900 underline">
              Logga in eller skapa konto
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
