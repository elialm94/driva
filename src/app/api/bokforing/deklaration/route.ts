import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";
import { fiscalYears } from "@/lib/accounting/fiscal";
import { eskdBytes, eskdForPeriod } from "@/lib/accounting/eskd";
import { agiForMonth } from "@/lib/accounting/agi-xml";
import { sruBytes, sruForFiscalYear } from "@/lib/accounting/sru";
import { ixbrlBytes, ixbrlForAnnualReport } from "@/lib/accounting/ixbrl";
import { FilingDataError } from "@/lib/accounting/filing-format";
import { withBusinessRead } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Myndighetsfilerna, hämtade som filer:
 *
 *   GET /api/bokforing/deklaration?typ=moms&period=2026-K2
 *   GET /api/bokforing/deklaration?typ=agi&manad=2026-05
 *   GET /api/bokforing/deklaration?typ=ink2&ar=2026&fil=info|blanketter
 *   GET /api/bokforing/deklaration?typ=arsredovisning&rapport=<id>
 *
 * Filerna byggs vid hämtningen ur det som redan är redovisat – ingen mutering,
 * så en läsande tenantkontext räcker. INK2 är två filer och hämtas en i taget:
 * Skatteverkets e-tjänst vill ha båda, men en zip skulle bara vara ett lager
 * mellan användaren och det e-tjänsten faktiskt tar emot.
 *
 * Teckenuppsättningen är formatens, inte vår: eSKD och SRU går i ISO 8859-1,
 * AGI och iXBRL i UTF-8. Därför skickas byte-innehållet, aldrig strängen.
 */
export async function GET(req: NextRequest) {
  return withBusinessRead(() => handle(req));
}

function handle(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const typ = p.get("typ") ?? "";

  try {
    switch (typ) {
      case "moms": {
        const period = p.get("period");
        if (!period) return bad("Ange momsperiod, t.ex. 2026-K2.");
        const file = eskdForPeriod(period);
        return download(eskdBytes(file), file.filename, "text/xml; charset=iso-8859-1");
      }
      case "agi": {
        const manad = p.get("manad");
        if (!manad) return bad("Ange redovisningsmånad, t.ex. 2026-05.");
        const file = agiForMonth(manad);
        return download(new TextEncoder().encode(file.xml), file.filename, "text/xml; charset=utf-8");
      }
      case "ink2": {
        const fy = fiscalYearFrom(p);
        if (!fy) return bad(`Okänt räkenskapsår: ${p.get("ar") ?? p.get("rakenskapsar") ?? ""}`);
        const filing = sruForFiscalYear(fy.id);
        const which = p.get("fil") ?? "blanketter";
        if (which !== "info" && which !== "blanketter") return bad(`Okänd SRU-fil: ${which}`);
        const text = which === "info" ? filing.info : filing.blanketter;
        const name = which === "info" ? filing.infoFilename : filing.blanketterFilename;
        return download(sruBytes(text), name, "text/plain; charset=iso-8859-1");
      }
      case "arsredovisning": {
        const report = annualReportFrom(p);
        if (!report) return bad("Årsredovisningen finns inte. Upprätta den på bokslutssidan först.");
        const file = ixbrlForAnnualReport(report);
        return download(ixbrlBytes(file), file.filename, "application/xhtml+xml; charset=utf-8");
      }
      default:
        return bad(`Okänd deklarationstyp: ${typ}`);
    }
  } catch (e) {
    if (e instanceof FilingDataError) return bad(e.message);
    return bad(e instanceof Error ? e.message : "Filen kunde inte skapas.");
  }
}

function fiscalYearFrom(p: URLSearchParams) {
  const id = p.get("rakenskapsar");
  if (id) return fiscalYears().find((f) => f.id === id);
  const label = p.get("ar");
  return label ? fiscalYears().find((f) => f.label === label) : undefined;
}

/** Rapporten på id, eller den senast upprättade för året. */
function annualReportFrom(p: URLSearchParams): string | undefined {
  const id = p.get("rapport");
  if (id) return db().annualReports.find((r) => r.id === id)?.id;
  const fy = fiscalYearFrom(p);
  if (!fy) return undefined;
  const forYear = db().annualReports.filter((r) => r.fiscalYearId === fy.id && !r.supersededAt);
  return forYear[forYear.length - 1]?.id;
}

function download(bytes: Uint8Array, filename: string, contentType: string) {
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
