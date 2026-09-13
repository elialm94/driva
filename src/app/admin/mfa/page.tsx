import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getPlatformAdmin, getPlatformSessionUser, platformMfaRequired } from "@/lib/platform/auth";
import { MFA_ONLY_SUPABASE, ownMfaState, type OwnMfaState } from "@/lib/platform/mfa";
import { isSupabaseMode } from "@/lib/storage/config";
import { MfaChallenge, MfaEnrollment, MfaManage } from "./mfa-panel";

export const metadata: Metadata = {
  title: "Tvåfaktorsautentisering · Ferva Admin",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * /admin/mfa – den enda adminsidan som får visas med en AAL1-session.
 * Ligger utanför (panel)-layouten så att inget admindata (räknare, namn,
 * supportkontext) renderas innan andra faktorn är verifierad.
 */
export default async function AdminMfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const user = await getPlatformSessionUser();
  if (!user) {
    if (isSupabaseMode()) redirect("/login?next=/admin/mfa");
    return (
      <Screen title="Tvåfaktorsautentisering">
        <p>{MFA_ONLY_SUPABASE}</p>
        <BackLink href="/admin" label="Till Ferva Admin" />
      </Screen>
    );
  }
  const ctx = await getPlatformAdmin();
  if (!ctx) {
    return (
      <Screen title="403 – Ingen behörighet">
        <p>Ditt konto ({user.email || user.id}) har inte behörighet till Ferva Admin.</p>
        <BackLink href="/" label="Till Ferva" />
      </Screen>
    );
  }
  if (!isSupabaseMode()) {
    return (
      <Screen title="Tvåfaktorsautentisering">
        <p>{MFA_ONLY_SUPABASE}</p>
        <BackLink href="/admin" label="Till Ferva Admin" />
      </Screen>
    );
  }

  let state: OwnMfaState;
  try {
    state = await ownMfaState();
  } catch (e) {
    return (
      <Screen title="Tvåfaktorsautentisering">
        <p className="text-red-300">{e instanceof Error ? e.message : "MFA-status kunde inte läsas."}</p>
        <BackLink href="/admin" label="Försök igen" />
      </Screen>
    );
  }

  const required = platformMfaRequired();
  const next = params.next && params.next.startsWith("/admin") ? params.next : "/admin";

  if (state.currentLevel === "aal2") {
    return (
      <Screen title="Säkerhet – tvåfaktorsautentisering">
        <MfaManage state={state} required={required} />
        <BackLink href="/admin" label="Till Ferva Admin" />
      </Screen>
    );
  }

  if (state.verified.length > 0) {
    return (
      <Screen title="Verifiera din andra faktor">
        <p>
          Inloggad som <span className="text-neutral-200">{user.email}</span>. Ange koden från din
          autentiseringsapp för att öppna Ferva Admin.
        </p>
        <MfaChallenge factors={state.verified} next={next} />
      </Screen>
    );
  }

  return (
    <Screen title="Aktivera tvåfaktorsautentisering">
      <p>
        Ferva Admin kräver en autentiseringsapp (TOTP) utöver din vanliga inloggning. Inget
        admindata visas förrän en faktor är registrerad och verifierad.
        {required ? null : (
          <span className="block pt-1 text-amber-300">
            Kravet är avstängt i den här miljön (PLATFORM_ADMIN_REQUIRE_MFA=0), men du kan
            registrera en faktor ändå.
          </span>
        )}
      </p>
      <MfaEnrollment />
      {required ? null : <BackLink href="/admin" label="Hoppa över just nu (endast utanför produktion)" />}
    </Screen>
  );
}

function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-950 px-4 py-10 text-neutral-100">
      <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-amber-400 text-[13px] font-bold text-neutral-950">
            FA
          </span>
          <h1 className="text-[16px] font-semibold">{title}</h1>
        </div>
        <div className="mt-3 space-y-3 text-[13.5px] leading-relaxed text-neutral-400">{children}</div>
      </div>
    </div>
  );
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href as never} className="inline-flex text-[13px] text-amber-300 hover:underline">
      ← {label}
    </Link>
  );
}
