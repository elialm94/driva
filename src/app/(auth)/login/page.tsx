import type { Metadata } from "next";
import { parseLoginAuthSearch } from "@/lib/auth/signup-flow";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Logga in – Driva" };
export const dynamic = "force-dynamic";

/** Ärliga meddelanden för lägen som landar på /login via redirect. */
function noticeFor(params: { bekraftelse?: string; demo?: string }): {
  text: string;
  tone: "info" | "error";
} | null {
  if (params.bekraftelse === "utgangen") {
    return { text: "Länken har gått ut. Logga in eller begär en ny länk.", tone: "error" };
  }
  if (params.bekraftelse === "ogiltig") {
    return {
      text: "Länken kunde inte verifieras. Öppna länken i samma webbläsare som du registrerade dig i, eller begär en ny.",
      tone: "error",
    };
  }
  if (params.demo === "upptagen") {
    return { text: "Demon har många besökare just nu. Försök igen om en liten stund.", tone: "info" };
  }
  return null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; email?: string; bekraftelse?: string; demo?: string }>;
}) {
  const params = await searchParams;
  const { email, next } = parseLoginAuthSearch(params);
  const notice = noticeFor(params);
  // Demo-CTA: /demo klonar exempeldatat till en egen JSON-fil per besökare –
  // fungerar i alla miljöer, ingen databas eller extra konfiguration krävs.
  const demoAvailable = true;
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
          {notice ? (
            <p
              role={notice.tone === "error" ? "alert" : "status"}
              className={
                notice.tone === "error"
                  ? "mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
                  : "mb-4 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700"
              }
            >
              {notice.text}
            </p>
          ) : null}
          <LoginForm next={next} defaultEmail={email ?? ""} />
          {demoAvailable ? (
            <>
              <div aria-hidden className="my-5 flex items-center gap-3 text-stone-300">
                <span className="h-px flex-1 bg-stone-200" />
                <span className="text-xs uppercase tracking-[0.14em] text-stone-400">eller</span>
                <span className="h-px flex-1 bg-stone-200" />
              </div>
              <p className="text-center text-sm text-stone-500">Vill du testa först?</p>
              <a
                href="/demo"
                className="mt-2 block w-full rounded-lg border border-stone-300 px-4 py-2.5 text-center text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                Se demo
              </a>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}
