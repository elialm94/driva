import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/shell";
import {
  activeSupportContext,
  ensureLocalPlatformAdmin,
  getPlatformAdmin,
  getPlatformSessionUser,
} from "@/lib/platform/auth";
import { countSupportTicketsByStatus, businessNameById } from "@/lib/platform/store";
import { platformRoleLabel, SUPER_ADMIN } from "@/lib/platform/types";
import { isSupabaseMode } from "@/lib/storage/config";

export const metadata: Metadata = {
  title: { default: "Driva Admin", template: "%s · Driva Admin" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Grinden till Driva Admin. Layouten avgör bara VAD SOM RENDERAS – varje
 * server action och varje sida gör om sina egna behörighetskontroller
 * (requirePlatformAdmin/requireSuperAdmin). Kraven är kumulativa:
 * verifierad auth-session → aktiv platform_admins-rad → ev. MFA-krav.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  // JSON-/utvecklingsläge: seeda dev-superadminen så ytan är testbar lokalt.
  if (!isSupabaseMode()) await ensureLocalPlatformAdmin();

  const user = await getPlatformSessionUser();
  if (!user) {
    if (isSupabaseMode()) redirect("/login?next=/admin");
    // JSON-läge utan vald identitet: visa dev-vägen i stället för en död yta.
    return (
      <DeniedScreen title="Driva Admin (lokalt utvecklingsläge)">
        <p>
          Ingen lokal identitet vald. Byt till den seedade dev-superadminen för att testa adminytan –
          detta är en ren utvecklingsväg och finns inte i produktion.
        </p>
        <Link
          href={"/dev/som-admin" as never}
          className="mt-4 inline-flex h-9 items-center rounded-lg bg-amber-400 px-4 text-[13px] font-semibold text-neutral-950"
        >
          Fortsätt som Dev Superadmin
        </Link>
      </DeniedScreen>
    );
  }

  const ctx = await getPlatformAdmin();
  if (!ctx) {
    // Inloggad men INTE plattformsadmin: ärlig 403, ingen omdirigering till
    // kundappen (det ska synas att adressen finns men är stängd).
    return (
      <DeniedScreen title="403 – Ingen behörighet">
        <p>
          Ditt konto ({user.email || user.id}) har inte behörighet till Driva Admin. Ytan är endast
          för Drivas plattformsteam och åtkomsten styrs av tabellen <code>platform_admins</code>,
          aldrig av kontots företagsroller.
        </p>
        <Link href="/" className="mt-4 inline-flex text-[13px] text-amber-300 hover:underline">
          ← Till Driva
        </Link>
      </DeniedScreen>
    );
  }

  if (!ctx.mfaSatisfied) {
    return (
      <DeniedScreen title="Tvåfaktorsautentisering krävs">
        <p>
          Den här miljön kräver MFA för Driva Admin (<code>PLATFORM_ADMIN_REQUIRE_MFA=1</code>).
          Logga in igen och verifiera din andra faktor – sessionen behöver AAL2 innan adminytan
          öppnas.
        </p>
      </DeniedScreen>
    );
  }

  const [ticketCounts, support] = await Promise.all([
    countSupportTicketsByStatus(),
    activeSupportContext().catch(() => null),
  ]);
  const supportBusinessName = support
    ? ((await businessNameById(support.session.businessId).catch(() => null)) ?? support.session.businessId)
    : undefined;

  return (
    <AdminShell
      adminName={ctx.admin.name || ctx.admin.email}
      roleLabel={platformRoleLabel(ctx.admin.role)}
      isSuperAdmin={ctx.admin.role === SUPER_ADMIN}
      openTickets={ticketCounts.open}
      supportBusinessName={supportBusinessName}
    >
      {children}
    </AdminShell>
  );
}

function DeniedScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-950 px-4 text-neutral-100">
      <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-amber-400 text-[13px] font-bold text-neutral-950">
            DA
          </span>
          <h1 className="text-[16px] font-semibold">{title}</h1>
        </div>
        <div className="mt-3 text-[13.5px] leading-relaxed text-neutral-400">{children}</div>
      </div>
    </div>
  );
}
