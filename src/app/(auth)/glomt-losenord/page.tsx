import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Glömt lösenord – Driva" };
export const dynamic = "force-dynamic";

/**
 * Publik sida: begär återställningslänk via e-post. Länken går till
 * /auth/confirm?next=/aterstall-losenord där nytt lösenord sätts.
 */
export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-semibold tracking-tight text-stone-900">Driva</div>
          <p className="mt-1 text-sm text-stone-500">Återställ ditt lösenord</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-stone-600">
            Ange e-postadressen till ditt konto så skickar vi en länk där du väljer ett nytt
            lösenord.
          </p>
          <div className="mt-4">
            <ForgotPasswordForm />
          </div>
          <p className="mt-4 text-center text-sm text-stone-500">
            Kom du på det?{" "}
            <Link href="/login" className="font-medium text-stone-900 underline">
              Logga in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
