import { NextRequest, NextResponse } from "next/server";
import { withBusiness } from "@/lib/auth/session";
import { db } from "@/lib/store";
import { wholesalersEnabled } from "@/lib/features";
import { importPriceFile, previewPriceFile } from "@/lib/services/wholesalers";
import { MAX_PRICE_FILE_BYTES, PriceFileError, isSupportedPriceFilename } from "@/lib/wholesalers/file-detect";
import type { WholesalerColumnMapping } from "@/lib/types";
import { COLUMN_KEYS } from "@/lib/wholesalers/column-mapping";

/**
 * Prisfil till en grossistanslutning (multipart, upp till 8 MB).
 *
 *   mode=preview  → tolka filen, föreslå kolumnmappning, visa de första raderna
 *   mode=import   → importera med vald mappning (atomisk – gamla prislistan
 *                   står kvar om något går fel)
 *
 * Route handler i stället för server action: filerna är större än vad
 * action-kroppen tål som base64. Sessionen krävs av proxyn; här kontrolleras
 * dessutom Origin (CSRF) och rollen (manage_wholesalers via withBusiness).
 * Filinnehållet loggas aldrig.
 */

const MANAGE = { capability: "manage_wholesalers" } as const;
const MANAGE_NO_RETRY = { capability: "manage_wholesalers", retry: false } as const;

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // Same-origin fetch utan Origin-header (äldre klienter) – proxyn kräver ändå session.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function safeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 160) || "prisfil";
}

function parseMapping(raw: string | null): WholesalerColumnMapping | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: WholesalerColumnMapping = {};
    for (const key of COLUMN_KEYS) {
      const v = parsed[key];
      if (typeof v === "string" && v.trim()) out[key] = v.trim().slice(0, 200);
    }
    return out;
  } catch {
    return undefined;
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "Begäran avvisades." }, { status: 403 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Filen kunde inte tas emot." }, { status: 400 });
  }
  const connectionId = String(form.get("connectionId") ?? "").trim();
  const mode = String(form.get("mode") ?? "preview");
  const mapping = parseMapping(typeof form.get("mapping") === "string" ? (form.get("mapping") as string) : null);
  const file = form.get("file");
  if (!connectionId || !(file instanceof Blob)) {
    return NextResponse.json({ ok: false, error: "Välj en prisfil." }, { status: 400 });
  }
  if (file.size > MAX_PRICE_FILE_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Prisfilen är för stor (max 8 MB). Dela upp filen eller exportera ett mindre urval." },
      { status: 413 },
    );
  }
  const filename = safeFilename((file as File).name ?? "prisfil");
  if (!isSupportedPriceFilename(filename)) {
    return NextResponse.json(
      { ok: false, error: "Filformatet stöds inte. Ladda upp CSV, TXT, XLSX, XML eller ett ZIP med någon av dem." },
      { status: 415 },
    );
  }
  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    if (mode === "import") {
      const outcome = await importPriceFile({ connectionId, filename, bytes, mapping }, (fn) =>
        withBusiness(
          () => {
            assertEnabled();
            return fn();
          },
          MANAGE_NO_RETRY,
        ),
      );
      return NextResponse.json(outcome, { status: outcome.ok ? 200 : 422 });
    }
    const preview = await withBusiness(() => {
      assertEnabled();
      return previewPriceFile({ connectionId, filename, bytes, mapping });
    }, MANAGE);
    return NextResponse.json({ ok: true, preview });
  } catch (e) {
    if (e instanceof PriceFileError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 422 });
    }
    const message = e instanceof Error ? e.message : "";
    if (message.startsWith("Du har inte") || message.startsWith("Den här åtgärden") || message.startsWith("Grossistbeställningar är avstängd")) {
      return NextResponse.json({ ok: false, error: message }, { status: 403 });
    }
    console.error("[grossist] prisfil misslyckades:", message);
    return NextResponse.json({ ok: false, error: "Filen kunde inte behandlas just nu. Försök igen." }, { status: 500 });
  }
}

function assertEnabled(): void {
  if (!wholesalersEnabled(db())) {
    throw new Error("Grossistbeställningar är avstängd. Aktivera funktionen under Inställningar → Funktioner.");
  }
}
