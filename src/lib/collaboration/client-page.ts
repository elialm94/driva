import { notFound } from "next/navigation";
import { ensureAccountantPage, requireAccountingAccess } from "@/lib/auth/session";
import { markAccountantActive } from "@/lib/collaboration/service";
import { loadAccountantClient, type ClientWorkSnapshot } from "@/lib/collaboration/portfolio";
import { isSupabaseMode } from "@/lib/storage/config";

export async function loadAccountantClientPage(businessId: string): Promise<{
  access: Awaited<ReturnType<typeof requireAccountingAccess>>;
  snap: ClientWorkSnapshot;
}> {
  const access = await requireAccountingAccess(businessId).catch(() => null);
  if (!access) notFound();
  if (isSupabaseMode()) await ensureAccountantPage(businessId);
  markAccountantActive(access.user.id, businessId);
  const snap = await loadAccountantClient(access.user.id, businessId);
  if (!snap) notFound();
  return { access, snap };
}
