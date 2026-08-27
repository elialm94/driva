import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";
import { fiscalYears, currentFiscalYear } from "@/lib/accounting/fiscal";
import { generateSie, encodeSieToPc8 } from "@/lib/accounting/sie";
import {
  balansCsv,
  huvudbokCsv,
  momsCsv,
  resultatCsv,
  saldobalansCsv,
  verifikationerCsv,
} from "@/lib/accounting/export";

/**
 * Export av bokföringsdata: CSV för rapporterna och SIE 4 för hela bokföringen.
 * GET /api/bokforing/export?typ=sie|verifikationer|saldobalans|huvudbok|resultat|balans|moms[&ar=2026][&period=2026-K2]
 */
export async function GET(req: NextRequest) {
  const typ = req.nextUrl.searchParams.get("typ") ?? "";
  const ar = req.nextUrl.searchParams.get("ar");
  const period = req.nextUrl.searchParams.get("period");

  const fy = ar ? fiscalYears().find((f) => f.label === ar) : currentFiscalYear();
  if (!fy) return NextResponse.json({ error: `Okänt räkenskapsår: ${ar}` }, { status: 400 });
  const range = { from: fy.startDate, to: fy.endDate };
  const slug = db().settings.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  try {
    if (typ === "sie") {
      const text = generateSie(fy.id);
      const bytes = encodeSieToPc8(text);
      return new NextResponse(Buffer.from(bytes), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${slug}-${fy.label}.se"`,
        },
      });
    }

    let csv: string;
    let name: string;
    switch (typ) {
      case "verifikationer":
        csv = verifikationerCsv(range);
        name = `verifikationer-${fy.label}`;
        break;
      case "saldobalans":
        csv = saldobalansCsv(range);
        name = `saldobalans-${fy.label}`;
        break;
      case "huvudbok":
        csv = huvudbokCsv(range);
        name = `huvudbok-${fy.label}`;
        break;
      case "resultat":
        csv = resultatCsv(range);
        name = `resultatrapport-${fy.label}`;
        break;
      case "balans":
        csv = balansCsv(range.to);
        name = `balansrapport-${fy.label}`;
        break;
      case "moms": {
        if (!period) return NextResponse.json({ error: "Ange period, t.ex. 2026-K2." }, { status: 400 });
        csv = momsCsv(period);
        name = `momsunderlag-${period}`;
        break;
      }
      default:
        return NextResponse.json({ error: `Okänd exporttyp: ${typ}` }, { status: 400 });
    }
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.csv"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Exporten misslyckades." }, { status: 400 });
  }
}
