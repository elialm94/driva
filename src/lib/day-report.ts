/**
 * "Rapportera dagens jobb" - strukturerad tolkning av en fritextrapport till
 * granskningsbara förslag. Regelbaserad och helt lokal: ingen text skickas
 * till någon leverantör, och tolkaren hittar aldrig på priser - material och
 * ändringar föreslås utan belopp som användaren fyller i själv.
 *
 * Exempel: "Tre timmar arbete, fyrtiofem minuter resa, jag köpte skruv och
 * reglar på Beijer och kunden ville även att vi byter två lister."
 *   → tid 3 tim · resa 45 min · material "skruv och reglar" (Beijer) ·
 *     ändring "byter två lister".
 *
 * Gränssnittet är byggt så att röst kan läggas till senare: en diktering
 * hamnar i samma textfält och går genom samma tolkning.
 */

export type DayReportItemKind = "tid" | "resa" | "material" | "andring" | "anteckning";

export interface DayReportItem {
  id: string;
  kind: DayReportItemKind;
  /** Kort, redigerbar beskrivning. */
  description: string;
  /** tid: timmar. resa: minuter. */
  qty?: number;
  unit?: "tim" | "min" | "km";
  /** material: butik/leverantör om den nämndes. */
  supplier?: string;
  /** Ursprungsfrasen - visas som stöd vid granskning. */
  source: string;
}

const NUMBER_WORDS: Record<string, number> = {
  noll: 0,
  en: 1,
  ett: 1,
  två: 2,
  tva: 2,
  tre: 3,
  fyra: 4,
  fem: 5,
  sex: 6,
  sju: 7,
  åtta: 8,
  atta: 8,
  nio: 9,
  tio: 10,
  elva: 11,
  tolv: 12,
  tretton: 13,
  fjorton: 14,
  femton: 15,
  sexton: 16,
  sjutton: 17,
  arton: 18,
  nitton: 19,
  tjugo: 20,
  trettio: 30,
  fyrtio: 40,
  femtio: 50,
  sextio: 60,
  sjuttio: 70,
  åttio: 80,
  attio: 80,
  nittio: 90,
  hundra: 100,
};

const TENS = ["tjugo", "trettio", "fyrtio", "femtio", "sextio", "sjuttio", "åttio", "nittio"];
const ONES = ["en", "ett", "två", "tre", "fyra", "fem", "sex", "sju", "åtta", "nio"];

/** "fyrtiofem" → 45, "två och en halv" → 2.5, "1,5" → 1.5, "en halv" → 0.5, "kvart" → 0.25. */
export function parseSwedishNumber(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  const numeric = s.replace(",", ".").match(/^(\d+(?:\.\d+)?)$/);
  if (numeric) return Number(numeric[1]);
  if (s === "en halv" || s === "halv" || s === "halvtimme" || s === "en halvtimme") return 0.5;
  if (s === "kvart" || s === "en kvart") return 0.25;
  if (s === "tre kvart") return 0.75;
  const halfMatch = s.match(/^(.+?)\s+och\s+en\s+halv$/);
  if (halfMatch) {
    const base = parseSwedishNumber(halfMatch[1]);
    return base == null ? null : base + 0.5;
  }
  if (s in NUMBER_WORDS) return NUMBER_WORDS[s];
  for (const tens of TENS) {
    if (s.startsWith(tens)) {
      const rest = s.slice(tens.length);
      const idx = ONES.indexOf(rest);
      if (idx >= 0) return NUMBER_WORDS[tens] + (idx === 0 || idx === 1 ? 1 : idx);
    }
  }
  const hundred = s.match(/^(\w+)?hundra(\w+)?$/);
  if (hundred) {
    const h = hundred[1] ? parseSwedishNumber(hundred[1]) : 1;
    const r = hundred[2] ? parseSwedishNumber(hundred[2]) : 0;
    if (h != null && r != null) return h * 100 + r;
  }
  return null;
}

const NUM = "(\\d+(?:[.,]\\d+)?|[a-zåäö]+(?:\\s+och\\s+en\\s+halv)?|en halv|halv|kvart|en kvart|tre kvart)";
const HOURS_RE = new RegExp(`\\b${NUM}\\s*(?:timmar|timme|timmars|tim|h)\\b`, "i");
const MINUTES_RE = new RegExp(`\\b${NUM}\\s*(?:minuter|minut|min)\\b`, "i");
const KM_RE = new RegExp(`\\b${NUM}\\s*(?:kilometer|km|mil)\\b`, "i");
const HALF_HOUR_RE = /\b(?:en\s+)?halvtimme\b/i;
const QUARTER_RE = /\b(?:en\s+)?kvart\b/i;

const TRAVEL_RE = /\b(res(a|an|or|te|tid)?|körning|körde|kört|bilen|milersättning|restid)\b/i;
const MATERIAL_RE = /\b(köpte|köpt|handlade|handlat|hämtade|hämtat|inköp|material|beställde|beställt)\b/i;
const CHANGE_RE = /\b(kunden (ville|vill|bad|önskar|önskade|frågade)|tillägg|ändring|extra(arbete|jobb)?|även att|dessutom att|utöver offerten)\b/i;
const SPLIT_TRIGGER = /^(kunden|jag köpte|köpte|handlade|hämtade|vi köpte|res[a-z]*\b|\d|en |ett |två |tre |fyra |fem |sex |sju |åtta |nio |tio |elva |tolv |femton |tjugo|trettio|fyrtio|femtio|halv|kvart)/i;

function splitClauses(text: string): string[] {
  const rough = text
    .replace(/\s+/g, " ")
    // Decimalkomma/punkt mellan siffror ("2,5 timmar") är inte en avgränsare.
    .replace(/(\d)[,.](\d)/g, "$1\u0000$2")
    .split(/[,.;!?\n]+/)
    .map((s) => s.replace(/\u0000/g, ","))
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const clause of rough) {
    // "och" delar bara när det som följer ser ut som en ny post (trigger),
    // annars hör det till frasen ("skruv och reglar").
    const parts = clause.split(/\s+och\s+/i);
    let current = parts[0];
    for (let i = 1; i < parts.length; i++) {
      const next = parts[i];
      if (SPLIT_TRIGGER.test(next) && !/\bhalv\b/i.test(next.slice(0, 8))) {
        out.push(current);
        current = next;
      } else {
        current = `${current} och ${next}`;
      }
    }
    out.push(current);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

function pickNumber(re: RegExp, clause: string): number | null {
  const m = clause.match(re);
  if (!m) return null;
  return parseSwedishNumber(m[1]);
}

function cleanDescription(s: string): string {
  return s
    .replace(/^(jag|vi)\s+/i, "")
    .replace(/^(så|sen|sedan|också|även)\s+/i, "")
    .trim()
    .replace(/^\p{Ll}/u, (c) => c.toUpperCase());
}

function supplierFrom(clause: string): string | undefined {
  const m = clause.match(/\b(?:på|hos|från|i)\s+([A-ZÅÄÖ][\wåäöÅÄÖ&.-]*(?:\s+[A-ZÅÄÖ][\wåäöÅÄÖ&.-]*)*)/);
  return m?.[1];
}

function materialDescription(clause: string, supplier?: string): string {
  let s = clause.replace(MATERIAL_RE, "").replace(/^(jag|vi)\s+/i, "");
  if (supplier) s = s.replace(new RegExp(`\\b(på|hos|från|i)\\s+${supplier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "");
  s = s.replace(/\s{2,}/g, " ").trim().replace(/^(på|hos|från)\s+/i, "");
  return cleanDescription(s || "Material");
}

function changeDescription(clause: string): string {
  const s = clause
    .replace(/\bkunden (ville|vill|bad|önskar|önskade|frågade)( om| att)?( också| även| dessutom)?\b/i, "")
    .replace(/\b(även|också|dessutom)\s+att\b/i, "")
    .replace(/^\s*att\s+/i, "")
    .replace(/^\s*(vi|jag)\s+/i, "")
    .trim();
  return cleanDescription(s || clause);
}

export function parseDayReport(text: string): DayReportItem[] {
  const items: DayReportItem[] = [];
  let n = 0;
  const id = () => `dr-${++n}`;
  for (const clause of splitClauses(text)) {
    const lower = clause.toLowerCase();
    const hours = pickNumber(HOURS_RE, clause);
    const minutes = pickNumber(MINUTES_RE, clause);
    const km = pickNumber(KM_RE, clause);
    const halfHour = HALF_HOUR_RE.test(clause) && hours == null && minutes == null;
    const quarter = QUARTER_RE.test(clause) && hours == null && minutes == null && !halfHour;

    if (TRAVEL_RE.test(lower) && (hours != null || minutes != null || km != null || halfHour || quarter)) {
      const qty = km != null ? km : minutes != null ? minutes : hours != null ? hours * 60 : halfHour ? 30 : 15;
      items.push({ id: id(), kind: "resa", description: "Resa", qty, unit: km != null ? "km" : "min", source: clause });
      continue;
    }
    if (hours != null || minutes != null || halfHour || quarter) {
      // "två timmar extra på lister" - tiden är huvudsaken, resten blir beskrivning.
      const qty = hours != null ? hours : minutes != null ? Math.round((minutes / 60) * 100) / 100 : halfHour ? 0.5 : 0.25;
      const desc = clause
        .replace(HOURS_RE, "")
        .replace(MINUTES_RE, "")
        .replace(HALF_HOUR_RE, "")
        .replace(QUARTER_RE, "")
        .replace(/\b(arbete|arbetade|jobb|jobbade|med|på plats)\b/gi, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
      items.push({ id: id(), kind: "tid", description: cleanDescription(desc || "Arbete"), qty, unit: "tim", source: clause });
      continue;
    }
    if (MATERIAL_RE.test(lower)) {
      const supplier = supplierFrom(clause);
      items.push({ id: id(), kind: "material", description: materialDescription(clause, supplier), ...(supplier ? { supplier } : {}), source: clause });
      continue;
    }
    if (CHANGE_RE.test(lower)) {
      items.push({ id: id(), kind: "andring", description: changeDescription(clause), source: clause });
      continue;
    }
    items.push({ id: id(), kind: "anteckning", description: cleanDescription(clause), source: clause });
  }
  return items;
}

export const DAY_REPORT_KIND_LABEL: Record<DayReportItemKind, string> = {
  tid: "Tid",
  resa: "Resa",
  material: "Material",
  andring: "Ändring",
  anteckning: "Anteckning",
};
