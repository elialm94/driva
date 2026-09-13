/**
 * "Rapportera dagens jobb" - sparar de förslag användaren valt efter granskning.
 * Varje post går genom samma tjänster som manuell registrering, så ingenting
 * här skapar egna vägar in i tid, material, ändringar eller anteckningar.
 *
 * Priser hittas aldrig på: tid använder befintlig avtalad/standardtimtaxa
 * precis som "Registrera tid", material och resa får det pris användaren
 * själv skrivit (annars 0 kr, tydligt synligt på uppdraget), och ändringar
 * blir tomma utkast som prissätts i ändringsdialogen.
 */
import type { DayReportItem } from "../day-report";
import type { JobChange, JobWorkEntry } from "../types";
import { getJob } from "./data";
import { addJobMaterial, addJobWorkEntry, registerJobTime } from "./job-work";
import { createJobChange } from "./job-changes";
import { appendJobNote } from "./jobs";
import { logCloseoutEvent } from "./closeout";

export interface DayReportSaveItem extends DayReportItem {
  /** Pris per enhet i kronor som användaren angett (material, resa). */
  unitPrice?: number;
}

export interface DayReportSaveResult {
  entries: JobWorkEntry[];
  changes: JobChange[];
  notes: number;
}

const MAX_ITEMS = 40;

function cleanDescription(raw: unknown, fallback: string): string {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  return s || fallback;
}

function positive(n: unknown): number | null {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function money(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
}

export function saveDayReport(jobId: string, items: DayReportSaveItem[], date?: string): DayReportSaveResult {
  const job = getJob(jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  if (!Array.isArray(items) || items.length === 0) throw new Error("Välj minst en post att spara");
  if (items.length > MAX_ITEMS) throw new Error(`Högst ${MAX_ITEMS} poster per rapport`);
  const day = (date || new Date().toISOString()).slice(0, 10);

  const result: DayReportSaveResult = { entries: [], changes: [], notes: 0 };
  for (const item of items) {
    switch (item.kind) {
      case "tid": {
        const hours = positive(item.qty);
        if (!hours) throw new Error(`Ange antal timmar för "${cleanDescription(item.description, "Arbete")}"`);
        result.entries.push(
          registerJobTime(jobId, { hours, description: cleanDescription(item.description, "Arbete"), date: day })
        );
        break;
      }
      case "resa": {
        const qty = positive(item.qty);
        if (!qty) throw new Error("Ange restid eller sträcka");
        const km = item.unit === "km";
        result.entries.push(
          addJobWorkEntry(jobId, {
            type: "travel",
            description: cleanDescription(item.description, "Resa"),
            date: day,
            qty: km ? qty : Math.round((qty / 60) * 100) / 100,
            unit: km ? "km" : "tim",
            unitPrice: money(item.unitPrice),
          })
        );
        break;
      }
      case "material": {
        const supplier = typeof item.supplier === "string" ? item.supplier.trim().slice(0, 80) : "";
        const base = cleanDescription(item.description, "Material");
        result.entries.push(
          addJobMaterial(jobId, {
            description: supplier ? `${base} (${supplier})` : base,
            date: day,
            qty: positive(item.qty) ?? 1,
            unit: "st",
            unitPrice: money(item.unitPrice),
          })
        );
        break;
      }
      case "andring": {
        result.changes.push(
          createJobChange(jobId, {
            title: cleanDescription(item.description, "Ändring"),
            description: item.source ? `Från dagsrapport ${day}: "${item.source.trim().slice(0, 500)}"` : "",
            lines: [],
          })
        );
        break;
      }
      case "anteckning": {
        appendJobNote(jobId, cleanDescription(item.description, ""));
        result.notes += 1;
        break;
      }
      default:
        throw new Error("Okänd posttyp i rapporten");
    }
  }

  const parts: string[] = [];
  const hours = result.entries.filter((e) => e.type === "labor").reduce((s, e) => s + e.qty, 0);
  if (hours > 0) parts.push(`${hours} tim arbete`);
  const travel = result.entries.filter((e) => e.type === "travel").length;
  if (travel) parts.push(travel === 1 ? "resa" : `${travel} resor`);
  const material = result.entries.filter((e) => e.type === "material").length;
  if (material) parts.push(material === 1 ? "material" : `${material} material`);
  if (result.changes.length) parts.push(result.changes.length === 1 ? "ett ändringsutkast" : `${result.changes.length} ändringsutkast`);
  if (result.notes) parts.push(result.notes === 1 ? "en anteckning" : `${result.notes} anteckningar`);
  logCloseoutEvent(jobId, "dagsrapport", `Dagsrapport sparad: ${parts.join(", ")}`);
  return result;
}
