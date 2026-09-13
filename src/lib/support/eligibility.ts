/**
 * Eligibility – få begripliga frågor i onboardingen som mappas mot
 * supportmatrisen och ger ett direkt besked: Ferva passar, passar med
 * konsult, eller stöder inte bolaget ännu (spec §10).
 *
 * Samma funktioner används av klientformuläret (direkt besked), av servern
 * (blockera ej stött val även om UI kringgås) och av konsultvyn. Ren och
 * klientsäker: ingen store, ingen fs.
 */

import type { BusinessScope, CompanySettings, ScopeApproval, ScopeFlag } from "../types";
import {
  SUPPORT_MATRIX_VERSION,
  isSupportEntryId,
  supportEntry,
  worstLevel,
  type SupportEntry,
  type SupportEntryId,
  type SupportLevel,
} from "./matrix";

export type CompanyFormAnswer = "ab" | "enskild" | "annan";

export interface ScopeQuestion {
  flag: ScopeFlag;
  /** Kryssrutans text – skrivet för företagaren, inte för redovisaren. */
  label: string;
  /** Poster i matrisen som frågan pekar ut. Strängaste nivån avgör. */
  entryIds: readonly SupportEntryId[];
}

/**
 * Onboardingens enda extrafråga: "Stämmer något av det här in på företaget?"
 * Ordningen är den som visas. Inget val låser – svaren går att ändra i
 * Inställningar → Företag, och konsulten ser dem i sin vy.
 */
export const SCOPE_QUESTIONS: readonly ScopeQuestion[] = [
  {
    flag: "foreign",
    label: "Säljer eller köper utanför Sverige, eller fakturerar i annan valuta än kronor",
    entryIds: ["eu_sales_export", "foreign_currency"],
  },
  {
    flag: "inventory",
    label: "Har lager eller egen tillverkning",
    entryIds: ["inventory_manufacturing"],
  },
  {
    flag: "k3_group",
    label: "Ingår i en koncern eller redovisar enligt K3",
    entryIds: ["group_company", "framework_k3"],
  },
  {
    flag: "complex_payroll",
    label: "Betalar timlön, övertid, förmåner eller följer kollektivavtal",
    entryIds: ["payroll_complex"],
  },
  {
    flag: "reverse_charge",
    label: "Fakturerar byggtjänster till andra byggföretag (omvänd byggmoms)",
    entryIds: ["reverse_charge_construction_outgoing"],
  },
];

const FLAGS = new Set<string>(SCOPE_QUESTIONS.map((q) => q.flag));

export function isScopeFlag(value: unknown): value is ScopeFlag {
  return typeof value === "string" && FLAGS.has(value);
}

/** Tar emot vad som helst från ett formulär och ger en sorterad, unik flagglista. */
export function parseScopeFlags(values: readonly unknown[]): ScopeFlag[] {
  const out = new Set<ScopeFlag>();
  for (const v of values) if (isScopeFlag(v)) out.add(v);
  return SCOPE_QUESTIONS.map((q) => q.flag).filter((f) => out.has(f));
}

export function companyFormEntryId(form: CompanyFormAnswer | ""): SupportEntryId {
  if (form === "ab") return "company_ab";
  if (form === "enskild") return "company_enskild";
  return "company_other";
}

export interface EligibilityInput {
  companyForm: CompanyFormAnswer | "";
  flags: readonly ScopeFlag[];
}

export interface Eligibility {
  verdict: SupportLevel;
  /** Poster som gör att bolaget inte kan skapas/köras i Ferva. */
  blocking: SupportEntry[];
  /** Poster som kräver konsultens godkännande. */
  consultant: SupportEntry[];
  matrixVersion: string;
}

/**
 * Bedömningen. En obesvarad företagsform räknas inte som ett hinder – det
 * är formulärets valideringsfel, inte matrisens. Strängaste nivån vinner.
 */
export function assessEligibility(input: EligibilityInput): Eligibility {
  const entries: SupportEntry[] = [];
  if (input.companyForm) entries.push(supportEntry(companyFormEntryId(input.companyForm)));
  for (const q of SCOPE_QUESTIONS) {
    if (!input.flags.includes(q.flag)) continue;
    for (const id of q.entryIds) entries.push(supportEntry(id));
  }
  const unique = [...new Map(entries.map((e) => [e.id, e])).values()];
  const blocking = unique.filter((e) => e.level === "unsupported");
  const consultant = unique.filter((e) => e.level === "consultant");
  return {
    verdict: worstLevel(unique.map((e) => e.level)),
    blocking,
    consultant,
    matrixVersion: SUPPORT_MATRIX_VERSION,
  };
}

export const VERDICT_TITLE: Record<SupportLevel, string> = {
  supported: "Ferva passar företaget",
  consultant: "Ferva passar – tillsammans med din redovisningskonsult",
  unsupported: "Ferva stöder inte företaget ännu",
};

export function verdictLead(e: Eligibility): string {
  if (e.verdict === "unsupported") {
    return "Vi vill inte gissa regler som blir fel i bokföringen eller deklarationen. Ändra svaren om något blev fel – annars är Ferva inte rätt verktyg för bolaget just nu.";
  }
  if (e.verdict === "consultant") {
    return "Företaget kan skapas. Det markerade fallet får användas först när en redovisningskonsult med tillgång till bolaget har godkänt det i Ferva – bjud in konsulten under Samarbeta.";
  }
  return "Aktiebolag i Sverige, kronor, svensk fakturering med moms och ROT/RUT, fast månadslön och K2-bokslut – allt det ligger inom det Ferva stödjer.";
}

/* ------------------------------- bolagets scope ------------------------------- */

export function newBusinessScope(flags: readonly ScopeFlag[], now = new Date().toISOString()): BusinessScope {
  return {
    matrixVersion: SUPPORT_MATRIX_VERSION,
    assessedAt: now,
    flags: parseScopeFlags(flags),
    approvals: [],
  };
}

/** Tolerant läsning ur jsonb/JSON – okända fält och trasiga poster faller bort. */
export function normalizeBusinessScope(raw: unknown): BusinessScope | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const approvals: ScopeApproval[] = [];
  if (Array.isArray(r.approvals)) {
    for (const a of r.approvals) {
      if (!a || typeof a !== "object") continue;
      const x = a as Record<string, unknown>;
      const by = x.approvedBy as Record<string, unknown> | undefined;
      if (!isSupportEntryId(x.entryId) || typeof x.approvedAt !== "string" || !by || typeof by.userId !== "string") continue;
      approvals.push({
        entryId: x.entryId,
        approvedAt: x.approvedAt,
        approvedBy: { userId: by.userId, name: typeof by.name === "string" ? by.name : "", email: typeof by.email === "string" ? by.email : "" },
        matrixVersion: typeof x.matrixVersion === "string" ? x.matrixVersion : "",
        ...(typeof x.note === "string" && x.note.trim() ? { note: x.note.trim() } : {}),
      });
    }
  }
  return {
    matrixVersion: typeof r.matrixVersion === "string" ? r.matrixVersion : "",
    assessedAt: typeof r.assessedAt === "string" ? r.assessedAt : "",
    flags: parseScopeFlags(Array.isArray(r.flags) ? r.flags : []),
    approvals,
  };
}

type ScopeSource = Pick<CompanySettings, "scope" | "companyForm">;

/** Gäller ett konsultgodkännande för posten i det här bolaget? */
export function scopeApproval(settings: ScopeSource | undefined, entryId: SupportEntryId): ScopeApproval | undefined {
  return settings?.scope?.approvals.find((a) => a.entryId === entryId);
}

export type EntryStatus = "supported" | "approved" | "consultant" | "unsupported";

/**
 * Status för en matrispost i ett visst bolag. "approved" = konsultfall som
 * konsulten godkänt; det är det enda sättet ett consultant-fall blir tillåtet.
 */
export function entryStatusFor(settings: ScopeSource | undefined, entryId: SupportEntryId): EntryStatus {
  const entry = supportEntry(entryId);
  if (entry.level === "supported") return "supported";
  if (entry.level === "unsupported") return "unsupported";
  return scopeApproval(settings, entryId) ? "approved" : "consultant";
}

export function entryAllowed(settings: ScopeSource | undefined, entryId: SupportEntryId): boolean {
  const status = entryStatusFor(settings, entryId);
  return status === "supported" || status === "approved";
}

/**
 * Bolagets bedömning så som den ser ut nu: sparade svar + företagsform.
 * Bolag skapade före matrisen har inga svar och bedöms bara på formen.
 */
export function businessEligibility(settings: ScopeSource | undefined): Eligibility {
  return assessEligibility({
    companyForm: settings?.companyForm ?? "ab",
    flags: settings?.scope?.flags ?? [],
  });
}

/** Konsultfall i bolaget som ännu inte godkänts – det konsulten ska ta ställning till. */
export function pendingConsultantEntries(settings: ScopeSource | undefined): SupportEntry[] {
  return businessEligibility(settings).consultant.filter((e) => !scopeApproval(settings, e.id));
}
