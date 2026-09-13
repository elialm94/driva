/**
 * Verifierbara påståenden om företaget – F-skatt och ansvarsförsäkring.
 *
 * Regeln (spec §8): genererad text får bara påstå något när det finns en
 * AKTUELL verifiering som användaren själv gjort. Saknas verifieringen, eller
 * har försäkringen gått ut, utelämnas påståendet tyst – vi gissar aldrig.
 *
 * Klientsäker och ren: inga importer från server- eller lagringslagret, så att
 * både inställnings-UI, dokumentkomponenter och tjänster kan dela logiken.
 */

import type { CompanyClaims, CompanySettings, FSkattVerification, InsuranceVerification } from "./types";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Rimligt tak för fritextfälten (källa, försäkringsbolag). */
export const CLAIM_TEXT_MAX = 200;

type ClaimSource = Pick<CompanySettings, "claims">;

export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DAY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/* ---------------------------------- läsning --------------------------------- */

/** F-skatt är bekräftad av användaren. Ingen tidsgräns – men datumet visas alltid. */
export function fSkattVerified(settings: ClaimSource | undefined): boolean {
  const claim = settings?.claims?.fSkatt;
  return Boolean(claim && isIsoDay(claim.confirmedAt));
}

export type InsuranceStatus = "saknas" | "giltig" | "utgangen";

/** Ansvarsförsäkringen räknas som verifierad t.o.m. sista giltighetsdagen. */
export function insuranceStatus(settings: ClaimSource | undefined, today: string = todayIso()): InsuranceStatus {
  const claim = settings?.claims?.liabilityInsurance;
  if (!claim || !claim.insurer.trim() || !isIsoDay(claim.validUntil) || !isIsoDay(claim.confirmedAt)) return "saknas";
  return claim.validUntil >= today ? "giltig" : "utgangen";
}

export function insuranceVerified(settings: ClaimSource | undefined, today: string = todayIso()): boolean {
  return insuranceStatus(settings, today) === "giltig";
}

/**
 * Meningar som får läggas till i genererad copy – bara de påståenden som är
 * verifierade just nu. Tom lista = säg ingenting om F-skatt/försäkring.
 */
export function claimSentences(settings: ClaimSource | undefined, today: string = todayIso()): string[] {
  const out: string[] = [];
  if (fSkattVerified(settings)) out.push("Vi är godkända för F-skatt.");
  if (insuranceVerified(settings, today)) {
    out.push(`Vi har ansvarsförsäkring hos ${settings!.claims!.liabilityInsurance!.insurer.trim()}.`);
  }
  return out;
}

/** Kort sammanfattning för hemsida/marknadsföring, t.ex. "F-skatt och ansvarsförsäkring". Tom sträng när inget är verifierat. */
export function claimSummary(settings: ClaimSource | undefined, today: string = todayIso()): string {
  const parts: string[] = [];
  if (fSkattVerified(settings)) parts.push("F-skatt");
  if (insuranceVerified(settings, today)) parts.push("ansvarsförsäkring");
  if (parts.length === 0) return "";
  return parts.join(" och ");
}

/* --------------------------------- normalisering ---------------------------- */

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, CLAIM_TEXT_MAX);
  return trimmed ? trimmed : undefined;
}

function normalizeFSkatt(raw: unknown): FSkattVerification | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (!isIsoDay(r.confirmedAt)) return undefined;
  const source = cleanText(r.source);
  return { confirmedAt: r.confirmedAt, ...(source ? { source } : {}) };
}

function normalizeInsurance(raw: unknown): InsuranceVerification | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const insurer = cleanText(r.insurer);
  if (!insurer || !isIsoDay(r.validUntil) || !isIsoDay(r.confirmedAt)) return undefined;
  const source = cleanText(r.source);
  return { insurer, validUntil: r.validUntil, confirmedAt: r.confirmedAt, ...(source ? { source } : {}) };
}

/**
 * Tolkar lagrad/inskickad data strikt: ofullständiga poster faller bort i
 * stället för att bli halva påståenden. `undefined` när inget återstår.
 */
export function normalizeCompanyClaims(raw: unknown): CompanyClaims | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const fSkatt = normalizeFSkatt(r.fSkatt);
  const liabilityInsurance = normalizeInsurance(r.liabilityInsurance);
  if (!fSkatt && !liabilityInsurance) return undefined;
  return { ...(fSkatt ? { fSkatt } : {}), ...(liabilityInsurance ? { liabilityInsurance } : {}) };
}

/* ------------------------------------ input --------------------------------- */

/** Formulärvärden från Inställningar → Företag → Verifierade uppgifter. */
export interface CompanyClaimsInput {
  fSkatt: { confirmed: boolean; confirmedAt?: string; source?: string };
  liabilityInsurance: { confirmed: boolean; insurer?: string; validUntil?: string; source?: string };
}

export type ClaimsParseResult = { ok: true; claims: CompanyClaims | undefined } | { ok: false; errors: string[] };

/**
 * Validerar och bygger claims ur användarens aktiva bekräftelse. En avkryssad
 * bekräftelse tar bort påståendet helt. Bekräftelsedagen får inte ligga i
 * framtiden; försäkringens sista dag får inte redan ha passerat vid bekräftelsen.
 */
export function parseCompanyClaimsInput(input: CompanyClaimsInput, today: string = todayIso()): ClaimsParseResult {
  const errors: string[] = [];
  const claims: CompanyClaims = {};

  if (input.fSkatt?.confirmed) {
    const confirmedAt = input.fSkatt.confirmedAt?.trim() || today;
    if (!isIsoDay(confirmedAt)) errors.push("Ange dagen du bekräftade F-skatten som ÅÅÅÅ-MM-DD.");
    else if (confirmedAt > today) errors.push("Bekräftelsedagen för F-skatt kan inte ligga i framtiden.");
    else {
      const source = cleanText(input.fSkatt.source);
      claims.fSkatt = { confirmedAt, ...(source ? { source } : {}) };
    }
  }

  if (input.liabilityInsurance?.confirmed) {
    const insurer = cleanText(input.liabilityInsurance.insurer);
    const validUntil = input.liabilityInsurance.validUntil?.trim() ?? "";
    if (!insurer) errors.push("Ange försäkringsbolaget för ansvarsförsäkringen.");
    if (!isIsoDay(validUntil)) errors.push("Ange försäkringens sista giltighetsdag som ÅÅÅÅ-MM-DD.");
    else if (validUntil < today) errors.push("Försäkringen har redan gått ut – förnya den innan du bekräftar.");
    if (insurer && isIsoDay(validUntil) && validUntil >= today) {
      const source = cleanText(input.liabilityInsurance.source);
      claims.liabilityInsurance = { insurer, validUntil, confirmedAt: today, ...(source ? { source } : {}) };
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, claims: normalizeCompanyClaims(claims) };
}
