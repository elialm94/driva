/**
 * Domänmodell för Ferva – AI-native business-in-a-box för svenska småföretag.
 * Alla belopp är i SEK (hela kronor om inget annat anges), datum är ISO-strängar.
 *
 * Barrel: typerna bor i ./types/ och re-exporteras här, så varje befintlig
 * import från "@/lib/types" fortsätter fungera oförändrad.
 */

export type { EconomicLineType, LineKind } from "./economic-line-type";

export * from "./types/common";
export * from "./types/company";
export * from "./types/customers";
export * from "./types/tax-reduction";
export * from "./types/documents";
export * from "./types/jobs";
export * from "./types/banking";
export * from "./types/expenses";
export * from "./types/accounting";
export * from "./types/audit";
export * from "./types/annual-report";
export * from "./types/filing";
export * from "./types/website";
export * from "./types/domains";
export * from "./types/assistant";
export * from "./types/collaboration";
export * from "./types/inbox";
export * from "./types/wholesalers";
export * from "./types/onboarding";
export * from "./types/db";
