import { cache } from "react";
import { notFound } from "next/navigation";
import { ensureAccountantPage, requireAccountingAccess } from "@/lib/auth/session";
import { markAccountantActive } from "@/lib/collaboration/service";
import { loadAccountantClient, type ClientWorkSnapshot } from "@/lib/collaboration/portfolio";
import { isSupabaseMode } from "@/lib/storage/config";

/**
 * Inläsning av en klient på konsultytan. React cache() gör att layouten,
 * sidan och den delade arbetsytan delar EN verifiering och EN snapshot per
 * request – de renderas parallellt, inte efter varandra.
 */
export const loadAccountantClientPage = cache(
  async (
    businessId: string
  ): Promise<{
    access: Awaited<ReturnType<typeof requireAccountingAccess>>;
    snap: ClientWorkSnapshot;
  }> => {
    const access = await requireAccountingAccess(businessId).catch(() => null);
    if (!access) notFound();
    if (isSupabaseMode()) await ensureAccountantPage(businessId);
    markAccountantActive(access.user.id, businessId);
    const snap = await loadAccountantClient(access.user.id, businessId);
    if (!snap) notFound();
    return { access, snap };
  }
);
