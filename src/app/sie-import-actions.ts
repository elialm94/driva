"use server";

import { revalidatePath } from "next/cache";
import { withBusiness } from "@/lib/auth/session";
import {
  importSieOpeningBalances,
  previewSieImport,
  SieImportError,
  type SieImportResult,
} from "@/lib/accounting/sie-import";
import type { SieImportPreview } from "@/lib/accounting/sie";

/**
 * Serveråtgärder för SIE-import. Tunna omslag runt accounting/sie-import.
 *
 * Två åtgärder, inte en: förhandsvisningen läser filen och skriver ingenting,
 * importen skriver. Filen skickas med båda gångerna i stället för att ligga
 * kvar i ett serverminne mellan anropen – ett halvfärdigt importläge på servern
 * skulle vara ett tillstånd att hålla reda på, och det är inte värt det för en
 * handling som görs en gång per klient.
 *
 * Behörigheten är `year_end`: att sätta ingående balanser är samma sorts
 * ingrepp som ett bokslut, och det är byråns arbete – inte en läsande revisors.
 */

const MAX_BYTES = 8 * 1024 * 1024;

function refresh() {
  revalidatePath("/", "layout");
}

function bytesFromBase64(base64: string): Uint8Array {
  const payload = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const buffer = Buffer.from(payload, "base64");
  if (buffer.byteLength === 0) throw new SieImportError("Filen är tom.");
  if (buffer.byteLength > MAX_BYTES) {
    throw new SieImportError("SIE-filen är större än 8 MB. Exportera ett enskilt räkenskapsår i stället.");
  }
  return new Uint8Array(buffer);
}

function errorText(e: unknown): string {
  if (e instanceof SieImportError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return "SIE-filen kunde inte läsas.";
}

export async function previewSieImportAction(
  fileBase64: string,
  businessId?: string
): Promise<{ ok: true; preview: SieImportPreview } | { ok: false; error: string }> {
  try {
    const preview = await withBusiness(async () => previewSieImport(bytesFromBase64(fileBase64)), {
      capability: "year_end",
      businessId,
    });
    return { ok: true, preview };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

export async function importSieOpeningBalancesAction(
  fileBase64: string,
  fiscalYearId: string,
  businessId?: string
): Promise<{ ok: true; result: SieImportResult } | { ok: false; error: string }> {
  try {
    const result = await withBusiness(
      async () => importSieOpeningBalances(previewSieImport(bytesFromBase64(fileBase64)), fiscalYearId, "anvandare"),
      { capability: "year_end", businessId }
    );
    refresh();
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}
