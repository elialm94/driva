import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, withBusiness } from "@/lib/auth/session";
import {
  analyzeImportFile,
  DataImportError,
  MAX_IMPORT_FILE_BYTES,
  runImport,
  type AnalyzeOptions,
  type ImportChoices,
} from "@/lib/services/data-imports";
import type { DataImportKind, WholesalerColumnMapping } from "@/lib/types";
import { COLUMN_KEYS } from "@/lib/wholesalers/column-mapping";
import { CUSTOMER_FIELDS, SUPPLIER_FIELDS, type RegisterMapping } from "@/lib/imports/registers";
import { PriceFileError } from "@/lib/wholesalers/file-detect";
import { SieParseError } from "@/lib/imports/sie-parse";

/**
 * Flytta dina uppgifter till Ferva – filuppladdning (multipart, max 25 MB).
 *
 *   mode=analyze → identifiera filen, förhandsgranska, föreslå kolumner
 *   mode=import  → genomför med bekräftade val (filen laddas upp igen och
 *                  hashen måste stämma med analysen; atomiskt per fil)
 *
 * Route handler i stället för server action: filerna är för stora för en
 * action-kropp. Proxyn kräver session; här kontrolleras Origin (CSRF) och
 * behörigheten import_data via withBusiness. Filinnehållet lagras aldrig
 * och loggas aldrig.
 */

const CAPABILITY = { capability: "import_data" } as const;
const IMPORT = { capability: "import_data", retry: false } as const;
const KINDS: DataImportKind[] = ["bokforing", "kunder", "leverantorer", "artiklar"];

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function safeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 160) || "fil";
}

function parseJson(raw: FormDataEntryValue | null): Record<string, unknown> {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseKind(raw: unknown): DataImportKind | undefined {
  return typeof raw === "string" && (KINDS as string[]).includes(raw) ? (raw as DataImportKind) : undefined;
}

function parseRegisterMapping(raw: unknown): RegisterMapping | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: RegisterMapping = {};
  const fields = new Set<string>([...CUSTOMER_FIELDS, ...SUPPLIER_FIELDS]);
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (fields.has(k) && typeof v === "string" && v.trim()) out[k as keyof RegisterMapping] = v.trim().slice(0, 200);
  }
  return out;
}

function parseArticleMapping(raw: unknown): WholesalerColumnMapping | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: WholesalerColumnMapping = {};
  for (const key of COLUMN_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim().slice(0, 200);
  }
  return out;
}

function parseYearIndexes(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map(Number).filter((n) => Number.isInteger(n) && Math.abs(n) < 100).slice(0, 20);
}

function errorResponse(e: unknown) {
  if (e instanceof DataImportError || e instanceof PriceFileError || e instanceof SieParseError) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 422 });
  }
  const message = e instanceof Error ? e.message : "";
  if (message.startsWith("Du har inte") || message.startsWith("Den här åtgärden") || message.startsWith("Rollen")) {
    return NextResponse.json({ ok: false, error: "Du har inte behörighet att importera till det här företaget." }, { status: 403 });
  }
  if (message.startsWith("Välj") || message.startsWith("Räkenskapsåret") || message.startsWith("Ingående") || message.startsWith("Saldona")) {
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
  console.error("[kom-igang/import] misslyckades:", message);
  return NextResponse.json({ ok: false, error: "Filen kunde inte behandlas just nu. Inget har sparats – försök igen." }, { status: 500 });
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
  const mode = String(form.get("mode") ?? "analyze");
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ ok: false, error: "Välj en fil." }, { status: 400 });
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return NextResponse.json({ ok: false, error: "Filen är för stor (max 25 MB)." }, { status: 413 });
  }
  const filename = safeFilename((file as File).name ?? "fil");
  const bytes = Buffer.from(await file.arrayBuffer());
  const body = parseJson(form.get("options"));

  try {
    if (mode === "import") {
      const kind = parseKind(body.kind);
      const expectedHash = typeof body.expectedHash === "string" ? body.expectedHash : "";
      if (!kind || !/^[a-f0-9]{64}$/.test(expectedHash)) {
        return NextResponse.json({ ok: false, error: "Importen saknar bekräftade val. Kontrollera filen igen." }, { status: 400 });
      }
      const user = await getSessionUser();
      const choices: ImportChoices = {
        kind,
        expectedHash,
        yearIndexes: parseYearIndexes(body.yearIndexes),
        mapping: parseRegisterMapping(body.mapping),
        connectionId: typeof body.connectionId === "string" ? body.connectionId.slice(0, 80) : undefined,
        articleMapping: parseArticleMapping(body.articleMapping),
        userId: user?.id ?? null,
      };
      // Artiklar går via grossistmodulens egna, redan atomära steg (egen commit per steg).
      const outcome =
        kind === "artiklar"
          ? await runImport(bytes, filename, choices, (fn) => withBusiness(fn, IMPORT))
          : await withBusiness(() => runImport(bytes, filename, choices), IMPORT);
      return NextResponse.json(outcome);
    }

    const options: AnalyzeOptions = {
      kindOverride: parseKind(body.kind),
      mapping: parseRegisterMapping(body.mapping),
      articleMapping: parseArticleMapping(body.articleMapping),
    };
    const analysis = await withBusiness(() => analyzeImportFile(bytes, filename, options), CAPABILITY);
    return NextResponse.json({ ok: true, analysis });
  } catch (e) {
    return errorResponse(e);
  }
}
