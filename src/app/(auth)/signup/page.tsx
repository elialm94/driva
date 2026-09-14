import type { Metadata } from "next";
import Link from "next/link";
import { safeAuthNext, loginHrefWithNext } from "@/lib/auth/signup-flow";
import {
  SIGNUP_CLOSED_EXISTING_USERS,
  SIGNUP_CLOSED_HEADING,
  SIGNUP_CLOSED_MESSAGE,
  signupClosedForLegalEntity,
} from "@/lib/auth/signup-gate";
import { SignupForm } from "./signup-form";
import { FervaMark } from "@/components/ferva-mark";

export const metadata: Metadata = { title: "Skapa konto" };
export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = safeAuthNext(params.next);
  // Samma bedömning som server actionen gör: kan ingen ta betalt efter
  // provperioden visas inget formulär alls. Ingen spinner, ingen tyst POST.
  const closed = signupClosedForLegalEntity();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2">
            <FervaMark size={28} />
            <span className="text-2xl font-semibold tracking-tight text-stone-900">Ferva</span>
          </div>
          <p className="mt-1 text-sm text-stone-500">
            {closed
              ? "Nya konton kan inte skapas just nu"
              : next.startsWith("/inbjudan")
                ? "Skapa konto för att acceptera inbjudan."
                : "Skapa ditt konto"}
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          {closed ? (
            <div data-signup-closed>
              <h1 className="text-base font-semibold text-stone-900">{SIGNUP_CLOSED_HEADING}</h1>
              <p className="mt-2 text-sm text-stone-600">{SIGNUP_CLOSED_MESSAGE}</p>
              <p className="mt-2 text-sm text-stone-600">{SIGNUP_CLOSED_EXISTING_USERS}</p>
              <Link
                href={loginHrefWithNext(next)}
                className="mt-5 block w-full rounded-lg bg-stone-900 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-stone-800"
              >
                Logga in
              </Link>
            </div>
          ) : (
            <SignupForm next={next} />
          )}
        </div>
      </div>
    </main>
  );
}
