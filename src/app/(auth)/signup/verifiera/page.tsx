import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { parseVerifyEmailSearch, signupHrefWithNext } from "@/lib/auth/signup-flow";
import { ResendVerification } from "../../resend-verification";

export const metadata: Metadata = { title: "Verifiera din e-post – Driva" };
export const dynamic = "force-dynamic";

/**
 * Mellansteget efter /signup: kontot är skapat men e-posten obekräftad.
 * Länken i mejlet går till /auth/confirm som växlar koden till en session
 * och fortsätter till onboarding – användaren ska aldrig tillbaka hit.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; next?: string }>;
}) {
  const params = await searchParams;
  const { email, next } = parseVerifyEmailSearch(params);
  if (!email) redirect("/signup");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-semibold tracking-tight text-stone-900">Driva</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-stone-900">Verifiera din e-post</h1>
          <p className="mt-2 text-sm text-stone-600">
            Vi har skickat en länk till:{" "}
            <span className="font-medium text-stone-900">{email}</span>
          </p>
          <p className="mt-2 text-sm text-stone-600">
            Klicka på länken i mejlet så fortsätter du direkt till nästa steg. Kolla skräpposten
            om mejlet dröjer.
          </p>
          <div className="mt-5 space-y-3 border-t border-stone-100 pt-4">
            <ResendVerification email={email} label="Skicka igen" next={next !== "/" ? next : undefined} />
            <p className="text-sm text-stone-500">
              Fel adress?{" "}
              <Link href={signupHrefWithNext(next)} className="font-medium text-stone-900 underline">
                Byt e-post
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
