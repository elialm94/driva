import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Glömt lösenord" };
export const dynamic = "force-dynamic";

export default function GlomtLosenordPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-semibold tracking-tight text-stone-900">Driva</div>
          <p className="mt-1 text-sm text-stone-500">
            Ange din e-postadress så skickar vi en länk för att välja ett nytt lösenord.
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <ForgotPasswordForm />
          <p className="mt-4 text-center text-sm text-stone-500">
            <Link href="/login" className="font-medium text-stone-900 underline">
              Tillbaka till inloggningen
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
