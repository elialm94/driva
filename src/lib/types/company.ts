/**
 * Företagsinställningar, produktomfattning, verifierade påståenden och ägarnotiser.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

import type { VatPeriodicity, VatRate } from "./common";

/* ---------------------------------- Företag ---------------------------------- */

export interface CompanySettings {
  name: string;
  /** Bolagsform. Styr eget kapital-konton och skatt vid bokslut. Default "ab". */
  companyForm?: "ab" | "enskild";
  orgNumber: string;
  vatNumber: string;
  email: string;
  /**
   * Egen mottagare för hemsidans kontaktformulär (Hemsida → Webbformulär).
   * Tomt/samma som `email` = följ företagets kontaktmail. Redigeras inte här.
   */
  websiteNotificationEmail?: string;
  phone: string;
  /** Företagets webbplats (URL). Inte densamma som Ferva-hemsidan. */
  websiteUrl?: string;
  address: string;
  postalCode: string;
  city: string;
  /** Juridiskt säte. Om tomt används city på fakturan. */
  sate?: string;
  country?: string;
  bankgiro: string;
  plusgiro?: string;
  /** Fritt bankkontonummer, t.ex. clearing + konto. */
  bankAccount?: string;
  iban?: string;
  bic?: string;
  logoInitials: string;
  /** JPEG data-URL. Saknas = visa initialer. */
  logoDataUrl?: string;
  /**
   * Redovisningsperiod för moms – speglar registreringen hos Skatteverket.
   * Saknas = kvartal, huvudregeln för ett litet aktiebolag. Styr både
   * periodindelningen på momssidan och förfallodagen.
   */
  vatPeriodicity?: VatPeriodicity;
  /** Preliminärskatt (F-skatt) som dras varje månad. */
  fSkattPerMonth: number;
  /**
   * false = användaren bokför F-skatt själv. Saknas / true = Ferva bokför
   * debiteringen på förfallodagen.
   */
  autoBookFSkatt?: boolean;
  /**
   * Branschprofil från onboarding. Styr bara startregler för kända
   * leverantörer; användarens egna regler vinner.
   */
  tradeProfile?: "snickare" | "elektriker" | "vvs" | "malare" | "ovrigt";
  /**
   * Referensnummer (OCR) för inbetalningar till skattekontot. Räknas fram ur
   * organisationsnumret och bekräftas en gång mot Skatteverkets OCR-beräkning.
   */
  taxAccountOcr?: string;
  /**
   * Reserv för arbetsgivaravgifter och personalskatt per månad. Används bara när
   * ingen anställd är upplagd – finns lönen räknas reserven ur den faktiska
   * lönen och den åldersberoende avgiften (services/finance.ts).
   */
  payrollReservePerMonth: number;
  /** Standard betalningsvillkor i dagar. */
  paymentTermsDays: number;
  /** Standard dröjsmålsränta i procent per år (räntelagen: referensränta + 8 %-enheter). */
  lateInterestRate: number;
  /** Standard giltighetstid för nya offerter, i dagar. */
  quoteValidityDays: number;
  /** Vanlig momssats för nya dokumentrader. */
  defaultVatRate: VatRate;
  /**
   * Standard timpris i hela kronor för nya arbetsrader (offert/faktura
   * "+ Arbete" och tidregistrering utan offertpris). Saknas / undefined =
   * inte satt. 0 på en rad är ett explicit pris och får inte skrivas över.
   */
  defaultHourlyRate?: number;
  /**
   * Standardvillkor som kopieras till nya offerter (`quote.terms`).
   * Tomt/saknas = fallback till STANDARD_TERMS. Ändring här skriver inte
   * om befintliga offerter. ROT/RUT-villkor ligger i taxReductionTerms.
   */
  defaultQuoteTerms?: string;
  /**
   * Stabil lokal-del för inkommande leverantörsmejl (`slug@in.ferva.se`).
   * Allokeras från företagsnamn vid skapande och låses därefter.
   * Tenantuppslag sker på den här sluggen – aldrig på From-headern.
   */
  inboundMailSlug?: string;
  /**
   * Företagets BETALKONTO för utgående leverantörsbetalningar (pain.001-
   * debitor). Skilt från bankgiro/iban ovan som är MOTTAGARUPPGIFTER på
   * kundfakturor. Endast fälten som betalfilsprofilen kräver.
   */
  payerBankName?: string;
  /** Debiteringskontots IBAN (kontrollsiffervaliderat vid sparande). */
  payerIban?: string;
  /** Debiteringsbankens BIC, t.ex. ESSESESS. */
  payerBic?: string;
  /**
   * Notiser till företagaren (Inställningar → Notiser). Saknas = allt på,
   * till företagets e-post. Se `lib/notices/owner-notices.ts`.
   */
  notices?: OwnerNoticeSettings;
  /**
   * Verifierbara påståenden om företaget (F-skatt, ansvarsförsäkring).
   * Genererad text (offertvillkor, dokumentsidfot, hemsida) får bara
   * påstå något när motsvarande aktuell verifiering finns här. Saknas eller
   * utgången = påståendet utelämnas tyst. Se `lib/company-claims.ts`.
   */
  claims?: CompanyClaims;
  /**
   * Produktomfattning (spec §10): onboardingens svar mot supportmatrisen,
   * bedömningen och konsultens godkännanden av konsultfall. Saknas = bolaget
   * skapades före matrisen; behandlas som obedömt aktiebolag utan godkännanden.
   * Se `lib/support/`.
   */
  scope?: BusinessScope;
  /**
   * Låg materialmarginal i procent av kundpriset. Under den här gränsen
   * varnas användaren, men fakturering blockeras inte. Saknas = 15.
   */
  lowMaterialMarginPercent?: number;
}

/** Onboardingens ja/nej-frågor som pekar ut konsult- eller ej stödda fall. */
export type ScopeFlag = "foreign" | "inventory" | "k3_group" | "complex_payroll" | "reverse_charge";

/** En redovisningskonsults godkännande av att ett konsultfall får användas i bolaget. */
export interface ScopeApproval {
  /** Post i supportmatrisen (nivå consultant). */
  entryId: string;
  approvedAt: string;
  approvedBy: { userId: string; name: string; email: string };
  /** Matrisversionen godkännandet gavs mot. */
  matrixVersion: string;
  note?: string;
}

export interface BusinessScope {
  matrixVersion: string;
  assessedAt: string;
  flags: ScopeFlag[];
  approvals: ScopeApproval[];
}

/** Företagets aktiva bekräftelse av att det är godkänt för F-skatt. */
export interface FSkattVerification {
  /** Dag användaren bekräftade (YYYY-MM-DD). */
  confirmedAt: string;
  /** Valfri källa, t.ex. "Skatteverkets registerutdrag 2026-03-01". */
  source?: string;
}

/** Företagets ansvarsförsäkring – giltig bara till och med `validUntil`. */
export interface InsuranceVerification {
  /** Försäkringsbolag. */
  insurer: string;
  /** Sista giltighetsdag (YYYY-MM-DD). Efter den dagen försvinner påståendet. */
  validUntil: string;
  /** Dag användaren bekräftade (YYYY-MM-DD). */
  confirmedAt: string;
  /** Valfri källa/referens, t.ex. försäkringsnummer eller länk till försäkringsbrevet. */
  source?: string;
}

export interface CompanyClaims {
  fSkatt?: FSkattVerification;
  liabilityInsurance?: InsuranceVerification;
}

/**
 * Händelser som sker UTANFÖR appen och därför mejlas till företagaren:
 * kundens svar på offerten, förfrågningar från hemsidan och dokument som
 * landar i inkorgen via mejl. Det användaren själv gör i appen notifieras aldrig.
 */
export type OwnerNoticeKind = "offert_godkand" | "offert_avbojd" | "forfragan" | "inkorg" | "orderbekraftelse";

export interface OwnerNoticeSettings {
  /** Egen mottagare. Tom/saknas/samma som företagets e-post = företagets e-post. */
  email?: string;
  /** Avstängda händelser – allt annat är på så att nya händelser når fram utan inställning. */
  off?: OwnerNoticeKind[];
}
