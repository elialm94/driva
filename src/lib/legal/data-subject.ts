/**
 * Registrerades uppgifter (spec §7): export av det Ferva behandlar om en
 * användare i egenskap av personuppgiftsansvarig – kontot, medlemskap,
 * godkända villkor och supportärenden användaren själv skapat. Företagets
 * bokföring och kunddata exporteras via SIE/dokument i appen (företaget är
 * ansvarigt för dem) och ingår inte här.
 */
import { listMemberships, sessionPhoneHint, type SessionUser } from "../auth/session";
import { listSupportTickets, listTermsAcceptances, businessNameById } from "../platform/store";
import { LEGAL_DOCUMENTS } from "./documents";

export interface DataSubjectExport {
  exportedAt: string;
  format: "ferva-data-subject-export/1";
  subject: { userId: string; email: string; name?: string; phone?: string };
  memberships: { businessId: string; businessName: string | null; role: string; lastActiveAt?: string }[];
  termsAcceptances: { document: string; version: string; acceptedAt: string; source: string; businessId?: string }[];
  supportTickets: {
    id: string;
    createdAt: string;
    subject: string;
    message: string;
    status: string;
    businessName: string;
    attachmentName?: string;
  }[];
  notes: string[];
}

export async function buildDataSubjectExport(user: SessionUser): Promise<DataSubjectExport> {
  const [memberships, acceptances, tickets, phone] = await Promise.all([
    listMemberships(user.id),
    listTermsAcceptances(user.id),
    listSupportTickets({ userId: user.id, limit: 200 }),
    sessionPhoneHint(),
  ]);
  const names = await Promise.all(memberships.map((m) => businessNameById(m.businessId).catch(() => null)));
  return {
    exportedAt: new Date().toISOString(),
    format: "ferva-data-subject-export/1",
    subject: { userId: user.id, email: user.email, name: user.name, phone: phone || undefined },
    memberships: memberships.map((m, i) => ({
      businessId: m.businessId,
      businessName: names[i],
      role: m.role,
      lastActiveAt: m.lastActiveAt,
    })),
    termsAcceptances: acceptances.map((a) => ({
      document: a.document,
      version: a.version,
      acceptedAt: a.acceptedAt,
      source: a.source,
      businessId: a.businessId,
    })),
    supportTickets: tickets.map((t) => ({
      id: t.id,
      createdAt: t.createdAt,
      subject: t.subject,
      message: t.message,
      status: t.status,
      businessName: t.businessName,
      attachmentName: t.attachmentName,
    })),
    notes: [
      "Exporten omfattar de uppgifter Ferva behandlar om dig som användare (personuppgiftsansvarig: se /integritet).",
      "Företagets kunder, fakturor, kvitton och bokföring exporteras från appen (SIE, PDF, JSON) – för dem är företaget personuppgiftsansvarigt.",
      `Lösenord och MFA-hemligheter lagras hashade hos Supabase Auth och kan inte exporteras. Aktuell villkorsversion: ${LEGAL_DOCUMENTS.villkor.version}.`,
      "Räkenskapsinformation bevaras enligt bokföringslagen i sju år och kan inte raderas i förtid; övriga uppgifter raderas eller anonymiseras vid kontoavslut.",
    ],
  };
}

export function dataSubjectExportFilename(now = new Date()): string {
  return `ferva-mina-uppgifter-${now.toISOString().slice(0, 10)}.json`;
}
