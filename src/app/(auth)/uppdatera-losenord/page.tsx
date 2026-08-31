import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { isSupabaseMode } from "@/lib/storage/config";
import { UpdatePasswordForm } from "./update-password-form";

export const metadata: Metadata = { title: "Välj nytt lösenord" };
export const dynamic = "force-dynamic";

/**
 * Landning efter återställningslänken: /auth/bekrafta har verifierat token
 * och satt en session – här väljer användaren sitt nya lösenord. Utan
 * session (t.ex. utgången länk) skickar proxyn hit via /login i stället.
 */
export default async function UppdateraLosenordPage() {
  if (!isSupabaseMode()) redirect("/");
  const user = await getSessionUser();
  if (!user) redirect("/glomt-losenord");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-semibold tracking-tight text-stone-900">Driva</div>
          <p className="mt-1 text-sm text-stone-500">Välj ett nytt lösenord för {user.email}.</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <UpdatePasswordForm />
        </div>
      </div>
    </main>
  );
}
