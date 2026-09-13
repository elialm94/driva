/**
 * Onboarding, Kom igång-uppgifter och dataimport.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

import type { ID } from "./common";

/* ------------------------- Onboarding och Kom igång -------------------------- */

/** Vad företaget arbetar med. Styr förslag och startuppgifter – aldrig behörighet. */
export type OnboardingIndustry = "el" | "vvs" | "bygg" | "maleri" | "mark" | "annat";
/** Betalar företaget ut lön? Behov – inte en funktionsflagga. */
export type OnboardingPayroll = "none" | "owner" | "employees" | "later";
/** Hur bokföringen ser ut idag. Skapar Kom igång-uppgiften "Flytta in bokföringen" m.m. */
export type OnboardingBookkeeping = "existing" | "new" | "consultant" | "later";
/**
 * Onboardingens tillstånd. Företaget skapas efter steg 1 (company_done) –
 * medlemskapet räcker därför inte längre som "onboarding klar".
 */
export type OnboardingStatus = "not_started" | "company_done" | "complete";
export type OnboardingStep = "company" | "personalize";

/** Uppgifterna i Kom igång-centret. Status härleds ur verklig data när det går. */
export type SetupTaskId =
  | "move_bookkeeping"
  | "connect_bank"
  | "payment_details"
  | "first_customer"
  | "first_job"
  | "invite_consultant"
  | "payroll"
  | "f_skatt"
  | "company_claims"
  | "articles_prices";

/** Bara det som inte kan härledas sparas: "gör senare" och "behövs inte". */
export interface SetupTaskOverride {
  state: "later" | "not_needed";
  at: string;
}

export interface OnboardingState {
  status: OnboardingStatus;
  /** Steget användaren fortsätter på när onboarding inte är klar. */
  currentStep: OnboardingStep | null;
  startedAt: string;
  companyCompletedAt?: string;
  personalizationCompletedAt?: string;
  completedAt?: string;
  industries: OnboardingIndustry[];
  otherIndustry?: string;
  payroll: OnboardingPayroll | null;
  bookkeeping: OnboardingBookkeeping | null;
  taskOverrides: Partial<Record<SetupTaskId, SetupTaskOverride>>;
  updatedAt: string;
}

/* ------------------------------- Dataimport --------------------------------- */

/** Vad en fil innehåller enligt analysen. */
export type DataImportKind = "bokforing" | "kunder" | "leverantorer" | "artiklar";
export type DataImportStatus = "imported" | "failed";

/**
 * Audit av genomförda (och misslyckade) importer. Filen sparas inte –
 * hash + sammanfattning räcker för spårbarhet och dubblettskydd.
 */
export interface DataImport {
  id: ID;
  kind: DataImportKind;
  status: DataImportStatus;
  filename: string;
  /** csv | txt | xlsx | xml | sie */
  fileKind: string;
  /** SHA-256 (hex) av filinnehållet. */
  fileHash: string;
  fileSize: number;
  userId?: string | null;
  /** Vald kolumnmappning eller andra val (t.ex. räkenskapsår) – för spårbarhet. */
  choices?: Record<string, unknown>;
  created: number;
  updated: number;
  ignored: number;
  warnings: string[];
  /** Kort svensk sammanfattning: "1 284 verifikationer, 2025". */
  summary: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}
