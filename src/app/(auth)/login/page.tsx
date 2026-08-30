import type { Metadata } from "next";
import Link from "next/link";
import { isSupabaseMode } from "@/lib/storage/config";
import { isDemoLoginConfigured } from "@/lib/auth/demo-session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Logga in – Driva" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; skapa?: string }>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  const startInSignup = params.skapa === "1";
  // Demo-CTA: lokalt JSON-läge är alltid demo; i produktion krävs den seedade
  // demo-användaren (servermiljön). Utan den visas ingen död knapp.
  const demoAvailable = !isSupabaseMode() || isDemoLoginConfigured();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-semibold tracking-tight text-stone-900">Driva</div>
          <p className="mt-1 text-sm text-stone-500">
            {next.startsWith("/inbjudan")
              ? "Logga in eller skapa konto för att acceptera inbjudan."
              : "Logga in för att fortsätta till ditt företag."}
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <LoginForm next={next} startInSignup={startInSignup} />
          {demoAvailable ? (
            <>
              <div aria-hidden className="my-5 flex items-center gap-3 text-stone-300">
                <span className="h-px flex-1 bg-stone-200" />
                <span className="text-xs uppercase tracking-[0.14em] text-stone-400">eller</span>
                <span className="h-px flex-1 bg-stone-200" />
              </div>
              <p className="text-center text-sm text-stone-500">Vill du bara titta runt?</p>
              <Link
                href="/demo"
                className="mt-2 block w-full rounded-lg border border-stone-300 px-4 py-2.5 text-center text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                Prova demo
              </Link>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}
