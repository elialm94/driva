/**
 * Server-inläsning av den gemensamma redovisningsarbetsytan.
 *
 *   loadOwnerWorkspace()              – ägaren under /bokforing
 *   loadPortfolioWorkspace(businessId) – konsult/revisor under /redovisning/k/<id>
 *
 * Båda laddar tenanttillståndet in i requestens cell (så att db() fungerar i
 * varje nästlad serverkomponent), verifierar medlemskapet och returnerar SAMMA
 * AccountingWorkspace-typ. Vykomponenterna känner bara den typen – de vet inte
 * vilken router som anropade dem.
 */
import { cache } from "react";
import { notFound } from "next/navigation";
import { ensurePageBusiness, requireBusiness } from "../auth/session";
import { loadAccountantClientPage } from "../collaboration/client-page";
import { isDemoBusiness, isDemoMode, isJsonDemoStore } from "../demo";
import { db } from "../store";
import type { AccountingWorkspace } from "./shared";
import { capabilitiesForRole } from "./shared";
import { OWNER_WORKSPACE_BASE } from "./tabs";

function demoFlag(): boolean {
  try {
    return isDemoMode() || isDemoBusiness() || isJsonDemoStore();
  } catch {
    return false;
  }
}

export const loadOwnerWorkspace = cache(async (): Promise<AccountingWorkspace> => {
  await ensurePageBusiness();
  const ctx = await requireBusiness();
  const settings = db().settings;
  return {
    surface: "owner",
    businessId: ctx.businessId,
    businessName: settings.name,
    actor: { userId: ctx.user.id, name: ctx.user.name ?? "", email: ctx.user.email },
    role: ctx.role,
    capabilities: capabilitiesForRole(ctx.role),
    basePath: OWNER_WORKSPACE_BASE,
    showPortfolioNav: false,
    demo: demoFlag(),
  };
});

export const loadPortfolioWorkspace = cache(async (businessId: string): Promise<AccountingWorkspace> => {
  const { access, snap } = await loadAccountantClientPage(businessId);
  if (!access) notFound();
  return {
    surface: "portfolio",
    businessId,
    businessName: snap.name,
    actor: { userId: access.user.id, name: access.user.name ?? "", email: access.user.email },
    role: access.role,
    capabilities: capabilitiesForRole(access.role),
    basePath: `/redovisning/k/${businessId}`,
    actionBusinessId: businessId,
    showPortfolioNav: true,
    demo: demoFlag(),
  };
});
