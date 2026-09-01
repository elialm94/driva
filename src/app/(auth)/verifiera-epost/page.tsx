import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sanitizeAuthEmail, safeAuthNext, signupHrefWithNext } from "@/lib/auth/signup-flow";
import { ResendVerification } from "../login/resend-verification";

export const metadata: Metadata = { title: "Verifiera din e-post" };
export const dynamic = "force-dynamic";

/**
 * Efter registrering: bekräftelselänken är skickad – härifrån kan besökaren
 * skicka om mejlet eller börja om med en annan adress. Sidan är ren
 * information (ingen session ännu); verifieringen sker via /auth/bekrafta.
 */
export default async function VerifieraEpostPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; next?: string }>;
}) {
  const params = await searchParams;
  const email = sanitizeAuthEmail(params.email);
  if (!email) redirect("/signup");
  const next = safeAuthNext(params.next);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-semibold tracking-tight text-stone-900">Driva</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-accent-soft">
            <svg viewBox="0 0 20 20" className="size-5 text-accent-deep" fill="none" aria-hidden>
              <path
                d="M3 6.5 10 11l7-4.5M4 15h12a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 16 5H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 15Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1 className="mt-4 text-center text-xl font-semibold text-stone-900">Verifiera din e-post</h1>
          <p className="mt-2 text-center text-sm text-stone-600">
            Vi har skickat en länk till: <span className="font-medium text-stone-900">{email}</span>
          </p>
          <p className="mt-2 text-center text-sm text-stone-500">
            Klicka på länken i mejlet för att komma igång. Kolla skräpposten om det dröjer.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <ResendVerification email={email} label="Skicka igen" />
            <Link
              href={signupHrefWithNext(next)}
              className="text-sm font-medium text-stone-500 underline hover:text-stone-700"
            >
              Byt e-post
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
