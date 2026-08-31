import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { isSupabaseMode } from "@/lib/storage/config";
import { NewPasswordForm } from "./new-password-form";

export const metadata: Metadata = { title: "Välj nytt lösenord – Driva" };
export const dynamic = "force-dynamic";

/**
 * Skyddad sida: nås via återställningslänken i mejlet (/auth/confirm växlar
 * koden till en session och skickar hit). Utan session → /login via proxyn.
 */
export default async function ResetPasswordPage() {
  if (!isSupabaseMode()) redirect("/");
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-semibold tracking-tight text-stone-900">Driva</div>
          <p className="mt-1 text-sm text-stone-500">Välj ett nytt lösenord</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-stone-600">
            Inloggad som <span className="font-medium text-stone-900">{user.email}</span>. Välj
            ett nytt lösenord för kontot.
          </p>
          <div className="mt-4">
            <NewPasswordForm />
          </div>
        </div>
      </div>
    </main>
  );
}
