/**
 * Val av katalogstore för requestens företag + den tenant-id domänkoden ser.
 *
 * Företags-id:t hämtas ALLTID från serverns tenantkontext (withBusiness /
 * sidans request-cell) – aldrig från klientinput.
 */
import { isSupabaseMode } from "../storage/config";
import { tenantContext } from "../storage/context";
import { requestSlot } from "../storage/request-scope";
import { LOCAL_JSON_BUSINESS_ID } from "../collaboration/actor";
import { fileCatalogStore, usesSqlCatalog, type WholesalerCatalogStore } from "./catalog-store";

export function currentBusinessId(): string {
  const ctx = tenantContext();
  if (ctx?.businessId) return ctx.businessId;
  try {
    const slot = requestSlot();
    if (slot.businessId) return slot.businessId;
  } catch {
    // utanför RSC-render
  }
  return LOCAL_JSON_BUSINESS_ID;
}

export async function catalogStoreFor(businessId: string): Promise<WholesalerCatalogStore> {
  if (usesSqlCatalog(businessId, isSupabaseMode())) {
    const { sqlCatalogStore } = await import("./catalog-store-sql");
    return sqlCatalogStore();
  }
  return fileCatalogStore();
}

export async function catalogStore(): Promise<{ businessId: string; store: WholesalerCatalogStore }> {
  const businessId = currentBusinessId();
  return { businessId, store: await catalogStoreFor(businessId) };
}
