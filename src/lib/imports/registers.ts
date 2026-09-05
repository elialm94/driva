/**
 * Registerimport (kunder, leverantörer) från CSV/TXT/XLSX/XML.
 *
 * Deterministisk kolumnmappning på rubriksynonymer (svenska/engelska) med
 * innehållsheuristik som stöd. Användaren ser förslaget ("Vi tror att dessa
 * kolumner hör ihop"), rättar och bekräftar innan något sparas. Dubbletter
 * mot befintligt register hoppas över – inget skrivs över.
 */
import type { Customer, Supplier } from "../types";
import { uid } from "../ids";
import { cell, type RawTable } from "../wholesalers/table";
import { normalizeHeader } from "../wholesalers/column-mapping";
import { customerContactFieldErrors, personnummerFieldError, sanitizePropertyDesignations } from "../customer-validation";
import { isEmailFormat } from "../settings-validation";
import {
  normalizeSwedishOrganizationNumber,
  normalizeSwedishPhone,
  normalizeSwedishPostalCode,
  validateSwedishOrganizationNumber,
  validateSwedishPhone,
  validateSwedishPostalCode,
} from "../validation/swedish";
import { isPersonnummerFormat, normalizePersonnummer } from "../personnummer";
import { isBankgiroFormat, isPlusgiroFormat, normalizeBankgiro, normalizePlusgiro } from "../invoices/formats";


export type RegisterKind = "kunder" | "leverantorer";

export const CUSTOMER_FIELDS = [
  "name",
  "kind",
  "contactPerson",
  "orgNumber",
  "personalIdentityNumber",
  "email",
  "phone",
  "address",
  "postalCode",
  "city",
  "propertyDesignation",
  "notes",
] as const;
export type CustomerField = (typeof CUSTOMER_FIELDS)[number];

export const SUPPLIER_FIELDS = [
  "name",
  "orgNumber",
  "email",
  "phone",
  "address",
  "postalCode",
  "city",
  "bankgiro",
  "plusgiro",
  "bankAccount",
  "iban",
  "notes",
] as const;
export type SupplierField = (typeof SUPPLIER_FIELDS)[number];

export type RegisterField = CustomerField | SupplierField;

/** Enkla svenska etiketter i mappningsvyn. */
export const REGISTER_FIELD_LABELS: Record<RegisterField, string> = {
  name: "Namn",
  kind: "Privatperson/företag",
  contactPerson: "Kontaktperson",
  orgNumber: "Organisationsnummer",
  personalIdentityNumber: "Personnummer",
  email: "E-post",
  phone: "Telefon",
  address: "Adress",
  postalCode: "Postnummer",
  city: "Ort",
  propertyDesignation: "Fastighetsbeteckning",
  notes: "Anteckning",
  bankgiro: "Bankgiro",
  plusgiro: "Plusgiro",
  bankAccount: "Bankkonto",
  iban: "IBAN",
};

/** fält → kolumnrubrik (som i filen). */
export type RegisterMapping = Partial<Record<RegisterField, string>>;

interface FieldSynonyms {
  /** Hela rubriken (normaliserad) är exakt ett av dessa. */
  exact: string[];
  /** Rubriken innehåller något av dessa. */
  contains?: string[];
  /** …men aldrig något av dessa (t.ex. "e-postadress" är inte en adress). */
  exclude?: string[];
}

const SYNONYMS: Record<RegisterField, FieldSynonyms> = {
  name: {
    exact: ["namn", "kundnamn", "kund", "foretag", "företag", "foretagsnamn", "företagsnamn", "name", "company", "customer", "leverantor", "leverantör", "leverantorsnamn", "leverantörsnamn", "supplier", "vendor", "bolag"],
    contains: ["namn", "name"],
    exclude: ["kontakt", "contact", "referens", "fil", "anvandar", "user"],
  },
  kind: { exact: ["typ", "kundtyp", "type", "kategori", "kundkategori"] },
  contactPerson: { exact: ["kontakt", "kontaktperson", "referens", "attention", "att", "contact", "kontaktnamn", "var referens", "er referens"], contains: ["kontakt", "referens", "attention", "contact"] },
  orgNumber: { exact: ["orgnr", "organisationsnummer", "org nr", "org.nr", "orgnummer", "organisationsnr", "orgnumber", "organization number", "momsnr", "vatnr"], contains: ["orgnr", "organisationsnummer", "orgnummer", "organisationsnr", "organizationnumber"] },
  personalIdentityNumber: { exact: ["personnummer", "pnr", "persnr", "personnr"], contains: ["personnummer", "persnr", "personnr"] },
  email: { exact: ["e-post", "epost", "email", "e-mail", "mail", "mejl", "e-postadress", "epostadress", "mailadress"], contains: ["epost", "email", "mail", "mejl"] },
  phone: { exact: ["telefon", "tel", "telefonnummer", "mobil", "mobilnummer", "mobiltelefon", "phone", "telnr", "tfn"], contains: ["telefon", "mobil", "phone", "tfn", "telnr"], exclude: ["fax"] },
  address: { exact: ["adress", "gatuadress", "postadress", "address", "street", "gata", "adress 1", "adressrad 1", "utdelningsadress", "besöksadress", "besoksadress"], contains: ["adress", "address", "gatu", "street"], exclude: ["epost", "email", "mail", "mejl", "ip"] },
  postalCode: { exact: ["postnummer", "postnr", "post nr", "zip", "zipcode", "postal code", "postcode", "postkod"], contains: ["postnummer", "postnr", "zip", "postalcode", "postcode", "postkod"] },
  city: { exact: ["ort", "postort", "stad", "city", "town"], contains: ["postort"] },
  propertyDesignation: { exact: ["fastighetsbeteckning", "fastighet", "fastighetsbet", "property"], contains: ["fastighet"] },
  notes: { exact: ["anteckning", "anteckningar", "kommentar", "notering", "noteringar", "notes", "comment", "info", "övrigt", "ovrigt"], contains: ["anteckning", "kommentar", "notering", "notes", "comment", "ovrigt"] },
  bankgiro: { exact: ["bankgiro", "bg", "bankgironummer", "bg-nr", "bg nr"], contains: ["bankgiro"] },
  plusgiro: { exact: ["plusgiro", "pg", "postgiro", "plusgironummer", "pg-nr", "pg nr"], contains: ["plusgiro", "postgiro"] },
  bankAccount: { exact: ["bankkonto", "kontonummer", "konto", "bank account", "clearing konto", "bankkontonummer", "kontonr"], contains: ["bankkonto", "kontonummer", "kontonr"] },
  iban: { exact: ["iban"], contains: ["iban"] },
};

const CUSTOMER_ONLY: RegisterField[] = ["kind", "personalIdentityNumber", "propertyDesignation", "contactPerson"];
const SUPPLIER_ONLY: RegisterField[] = ["bankgiro", "plusgiro", "bankAccount", "iban"];

function fieldsFor(kind: RegisterKind): readonly RegisterField[] {
  return kind === "kunder" ? CUSTOMER_FIELDS : SUPPLIER_FIELDS;
}

function headerMatchesExact(header: string, field: RegisterField): boolean {
  const norm = normalizeHeader(header);
  return Boolean(norm) && SYNONYMS[field].exact.some((syn) => normalizeHeader(syn) === norm);
}

function headerMatches(header: string, field: RegisterField): boolean {
  const norm = normalizeHeader(header);
  if (!norm) return false;
  const def = SYNONYMS[field];
  if (def.exclude?.some((x) => norm.includes(normalizeHeader(x)))) return false;
  if (def.exact.some((syn) => normalizeHeader(syn) === norm)) return true;
  return (def.contains ?? []).some((c) => norm.includes(normalizeHeader(c)));
}

/* ---------------------------------- klassning ------------------------------- */

export type RegisterClassification = { kind: RegisterKind | "artiklar" | "unknown"; reason: string };

const ARTICLE_WORDS = ["artikelnummer", "artnr", "art nr", "artikel", "e-nummer", "enummer", "e nr", "rsk", "rsk-nummer", "gtin", "ean", "listpris", "nettopris", "pris", "inköpspris", "inkopspris", "enhet", "förp", "forp", "rabattgrupp"];

/** Vad innehåller tabellen? Bestäms av rubrikerna – aldrig av filnamnet ensamt. */
export function classifyRegisterTable(table: RawTable): RegisterClassification {
  const headers = table.headers.map(normalizeHeader);
  const has = (words: string[]) => headers.some((h) => words.some((w) => h === normalizeHeader(w) || h.includes(normalizeHeader(w))));
  const articleScore = ARTICLE_WORDS.filter((w) => has([w])).length;
  const hasName = CUSTOMER_FIELDS.includes("name") && headers.some((h) => headerMatches(h, "name"));
  const supplierScore = SUPPLIER_ONLY.filter((f) => headers.some((h) => headerMatches(h, f))).length + (has(["leverantör", "leverantor", "supplier", "vendor"]) ? 2 : 0);
  const customerScore = CUSTOMER_ONLY.filter((f) => headers.some((h) => headerMatches(h, f))).length + (has(["kund", "customer"]) ? 2 : 0);
  const contactScore = ["email", "phone", "address", "postalCode", "city"].filter((f) => headers.some((h) => headerMatches(h, f as RegisterField))).length;

  if (articleScore >= 2 && articleScore > customerScore && articleScore > supplierScore) {
    return { kind: "artiklar", reason: "Rubrikerna ser ut som ett artikel- eller prisregister." };
  }
  if (!hasName && contactScore === 0) return { kind: "unknown", reason: "Hittade ingen kolumn för namn eller kontaktuppgifter." };
  if (supplierScore > customerScore) return { kind: "leverantorer", reason: "Rubrikerna innehåller betalningsuppgifter eller leverantörsbegrepp." };
  if (customerScore > 0 || hasName || contactScore >= 2) return { kind: "kunder", reason: "Rubrikerna ser ut som ett kundregister." };
  return { kind: "unknown", reason: "Kunde inte avgöra vad tabellen innehåller." };
}

/* --------------------------------- mappning --------------------------------- */

export interface DetectedRegisterMapping {
  mapping: RegisterMapping;
  confidence: Partial<Record<RegisterField, "high" | "medium">>;
  /** Kolumner i filen som inte används. */
  unmapped: string[];
}

function looksLikeEmailColumn(table: RawTable, index: number): boolean {
  const sample = table.rows.slice(0, 30).map((r) => cell(r, index)).filter(Boolean);
  return sample.length > 0 && sample.filter((v) => isEmailFormat(v)).length / sample.length > 0.7;
}
function looksLikePostalColumn(table: RawTable, index: number): boolean {
  const sample = table.rows.slice(0, 30).map((r) => cell(r, index)).filter(Boolean);
  return sample.length > 0 && sample.filter((v) => /^\d{3} ?\d{2}$/.test(v.trim())).length / sample.length > 0.7;
}
function looksLikeOrgnrColumn(table: RawTable, index: number): boolean {
  const sample = table.rows.slice(0, 30).map((r) => cell(r, index)).filter(Boolean);
  return sample.length > 0 && sample.filter((v) => /^\d{6}-?\d{4}$/.test(v.trim())).length / sample.length > 0.7;
}

export function detectRegisterMapping(table: RawTable, kind: RegisterKind): DetectedRegisterMapping {
  const mapping: RegisterMapping = {};
  const confidence: DetectedRegisterMapping["confidence"] = {};
  const used = new Set<number>();
  const fields = fieldsFor(kind);

  // 1. Rubriksynonymer – första träffen per fält, exakt match först.
  for (const field of fields) {
    const exact = table.headers.findIndex((h, i) => !used.has(i) && headerMatchesExact(h, field));
    const idx = exact >= 0 ? exact : table.headers.findIndex((h, i) => !used.has(i) && headerMatches(h, field));
    if (idx >= 0) {
      mapping[field] = table.headers[idx];
      confidence[field] = exact >= 0 ? "high" : "medium";
      used.add(idx);
    }
  }
  // 2. Innehållsheuristik för det som saknas.
  if (!mapping.email) {
    const idx = table.headers.findIndex((_, i) => !used.has(i) && looksLikeEmailColumn(table, i));
    if (idx >= 0) {
      mapping.email = table.headers[idx];
      confidence.email = "medium";
      used.add(idx);
    }
  }
  if (!mapping.postalCode) {
    const idx = table.headers.findIndex((_, i) => !used.has(i) && looksLikePostalColumn(table, i));
    if (idx >= 0) {
      mapping.postalCode = table.headers[idx];
      confidence.postalCode = "medium";
      used.add(idx);
    }
  }
  if (!mapping.orgNumber) {
    const idx = table.headers.findIndex((_, i) => !used.has(i) && looksLikeOrgnrColumn(table, i));
    if (idx >= 0) {
      mapping.orgNumber = table.headers[idx];
      confidence.orgNumber = "medium";
      used.add(idx);
    }
  }
  const unmapped = table.headers.filter((_, i) => !used.has(i));
  return { mapping, confidence, unmapped };
}

/** Behåll bara rubriker som finns i filen och fält som hör till registret. */
export function sanitizeRegisterMapping(table: RawTable, kind: RegisterKind, mapping: RegisterMapping): RegisterMapping {
  const out: RegisterMapping = {};
  const fields = fieldsFor(kind);
  const seen = new Set<string>();
  for (const field of fields) {
    const header = mapping[field];
    if (!header || !table.headers.includes(header) || seen.has(header)) continue;
    out[field] = header;
    seen.add(header);
  }
  return out;
}

export function registerMappingProblems(mapping: RegisterMapping): string[] {
  const problems: string[] = [];
  if (!mapping.name) problems.push("Välj vilken kolumn som är namnet.");
  return problems;
}

/* ------------------------------- radtolkning -------------------------------- */

export interface RegisterRowIssue {
  /** Radnummer i filen. */
  line: number;
  message: string;
}

export interface CustomerDraft {
  kind: Customer["kind"];
  name: string;
  contactPerson?: string;
  orgNumber?: string;
  personalIdentityNumber?: string;
  email: string;
  phone: string;
  address?: string;
  postalCode?: string;
  city?: string;
  propertyDesignations: string[];
  notes: string;
}

export interface SupplierDraft {
  name: string;
  orgNumber?: string;
  email?: string;
  phone?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  bankgiro?: string;
  plusgiro?: string;
  bankAccount?: string;
  iban?: string;
  notes?: string;
}

export interface RegisterPreview<TDraft> {
  kind: RegisterKind;
  mapping: RegisterMapping;
  rowCount: number;
  /** Rader som skapas. */
  drafts: TDraft[];
  /** Rader som redan finns i registret – hoppas över. */
  duplicates: { line: number; name: string; matchedOn: string }[];
  /** Rader som inte kan tas med (fel), med radnummer. */
  invalid: RegisterRowIssue[];
  /** Rader som tas med men bör kontrolleras (t.ex. ogiltigt postnummer – fältet lämnas tomt). */
  review: RegisterRowIssue[];
  /** Kolumner i filen som inte används. */
  unmapped: string[];
  sampleHeaders: string[];
  sampleRows: string[][];
}

const MAX_ISSUES = 200;

function value(table: RawTable, row: string[], mapping: RegisterMapping, field: RegisterField): string {
  const header = mapping[field];
  if (!header) return "";
  const idx = table.headers.indexOf(header);
  return idx >= 0 ? cell(row, idx).trim() : "";
}

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim();
}

function digits(s: string): string {
  return s.replace(/\D/g, "");
}

function inferCustomerKind(raw: string, orgNumber: string, personalIdentityNumber: string, name: string): Customer["kind"] {
  const norm = raw.toLowerCase();
  if (/privat|person|private|individual/.test(norm)) return "privat";
  if (/f[öo]retag|company|business|bolag|ab\b|org/.test(norm)) return "foretag";
  if (personalIdentityNumber) return "privat";
  if (orgNumber) return digits(orgNumber).length === 10 && /^(1[6-9]|2[0-9]|[3-9]\d)/.test(digits(orgNumber)) ? "foretag" : "foretag";
  if (/\b(ab|hb|kb|aktiebolag|förening|kommun|region|fastighets)\b/i.test(name)) return "foretag";
  return "privat";
}

export function previewCustomerImport(
  table: RawTable,
  mappingInput: RegisterMapping,
  existing: readonly Customer[],
): RegisterPreview<CustomerDraft> {
  const mapping = sanitizeRegisterMapping(table, "kunder", mappingInput);
  const drafts: CustomerDraft[] = [];
  const duplicates: RegisterPreview<CustomerDraft>["duplicates"] = [];
  const invalid: RegisterRowIssue[] = [];
  const review: RegisterRowIssue[] = [];
  const byOrg = new Map<string, Customer>();
  const byPn = new Map<string, Customer>();
  const byEmail = new Map<string, Customer>();
  const byName = new Map<string, Customer>();
  for (const c of existing) {
    if (c.orgNumber) byOrg.set(digits(c.orgNumber), c);
    if (c.personalIdentityNumber) byPn.set(digits(c.personalIdentityNumber), c);
    if (c.email) byEmail.set(c.email.toLowerCase().trim(), c);
    byName.set(normalizeKey(c.name), c);
  }
  const seenInFile = new Set<string>();

  table.rows.forEach((row, i) => {
    const line = table.firstDataRowNumber + i;
    const name = value(table, row, mapping, "name");
    if (!name) {
      if (row.every((c) => !c.trim())) return; // tom rad
      if (invalid.length < MAX_ISSUES) invalid.push({ line, message: "Namn saknas – raden tas inte med." });
      return;
    }
    const orgRaw = value(table, row, mapping, "orgNumber");
    const pnRaw = value(table, row, mapping, "personalIdentityNumber");
    const email = value(table, row, mapping, "email");
    const phone = value(table, row, mapping, "phone");
    const contactPerson = value(table, row, mapping, "contactPerson");
    const address = value(table, row, mapping, "address");
    const postalRaw = value(table, row, mapping, "postalCode");
    const city = value(table, row, mapping, "city");
    const property = value(table, row, mapping, "propertyDesignation");
    const notes = value(table, row, mapping, "notes");

    // Ett tiosiffrigt "organisationsnummer" på en privatperson är ett personnummer.
    let orgNumber = orgRaw;
    let personalIdentityNumber = pnRaw;
    const kindRaw = value(table, row, mapping, "kind");
    if (!personalIdentityNumber && orgNumber && /privat|person/i.test(kindRaw) && isPersonnummerFormat(orgNumber)) {
      personalIdentityNumber = orgNumber;
      orgNumber = "";
    }
    const kind = inferCustomerKind(kindRaw, orgNumber, personalIdentityNumber, name);

    // Dubbletter mot registret och inom filen.
    const orgKey = orgNumber ? digits(orgNumber) : "";
    const pnKey = personalIdentityNumber ? digits(personalIdentityNumber) : "";
    const emailKey = email.toLowerCase();
    const nameKey = normalizeKey(name);
    const match =
      (orgKey && byOrg.get(orgKey) && { c: byOrg.get(orgKey)!, on: "organisationsnummer" }) ||
      (pnKey && byPn.get(pnKey) && { c: byPn.get(pnKey)!, on: "personnummer" }) ||
      (emailKey && byEmail.get(emailKey) && { c: byEmail.get(emailKey)!, on: "e-post" }) ||
      (byName.get(nameKey) && { c: byName.get(nameKey)!, on: "namn" }) ||
      null;
    if (match) {
      if (duplicates.length < MAX_ISSUES) duplicates.push({ line, name, matchedOn: match.on });
      return;
    }
    const fileKey = orgKey || pnKey || emailKey || nameKey;
    if (seenInFile.has(fileKey)) {
      if (duplicates.length < MAX_ISSUES) duplicates.push({ line, name, matchedOn: "samma rad två gånger i filen" });
      return;
    }
    seenInFile.add(fileKey);

    // Validering: samma regler som "Ny kund". Fel på frivilliga fält → fältet lämnas tomt och raden flaggas.
    const errors = customerContactFieldErrors({ name, email, phone, orgNumber: kind === "foretag" ? orgNumber : undefined, contactPerson });
    let finalEmail = email;
    let finalOrg = kind === "foretag" ? orgNumber : "";
    for (const err of errors) {
      if (err.field === "email") {
        finalEmail = "";
        if (review.length < MAX_ISSUES) review.push({ line, message: `${name}: e-postadressen "${email}" ser fel ut och lämnas tom.` });
      } else if (err.field === "orgNumber") {
        finalOrg = "";
        if (review.length < MAX_ISSUES) review.push({ line, message: `${name}: organisationsnumret "${orgRaw}" är inte giltigt och lämnas tomt.` });
      } else if (err.field === "phone") {
        if (review.length < MAX_ISSUES) review.push({ line, message: `${name}: telefonnumret "${phone}" ser fel ut och lämnas tomt.` });
      }
    }
    let finalPn: string | undefined;
    if (kind === "privat" && personalIdentityNumber) {
      const pnError = personnummerFieldError(personalIdentityNumber);
      if (pnError) {
        if (review.length < MAX_ISSUES) review.push({ line, message: `${name}: personnumret är inte giltigt och lämnas tomt.` });
      } else {
        finalPn = normalizePersonnummer(personalIdentityNumber);
      }
    }
    let postalCode: string | undefined;
    if (postalRaw) {
      if (validateSwedishPostalCode(postalRaw).ok) postalCode = normalizeSwedishPostalCode(postalRaw);
      else if (review.length < MAX_ISSUES) review.push({ line, message: `${name}: postnumret "${postalRaw}" är inte giltigt och lämnas tomt.` });
    }
    const finalPhone = phone && !/[a-zA-ZåäöÅÄÖ]/.test(phone) ? (validateSwedishPhone(phone).ok ? normalizeSwedishPhone(phone) : phone) : "";
    drafts.push({
      kind,
      name,
      ...(contactPerson ? { contactPerson } : {}),
      ...(finalOrg ? { orgNumber: normalizeSwedishOrganizationNumber(finalOrg) } : {}),
      ...(finalPn ? { personalIdentityNumber: finalPn } : {}),
      email: finalEmail,
      phone: finalPhone,
      ...(address ? { address } : {}),
      ...(postalCode ? { postalCode } : {}),
      ...(city ? { city } : {}),
      propertyDesignations: property ? sanitizePropertyDesignations([property]) : [],
      notes,
    });
  });

  return {
    kind: "kunder",
    mapping,
    rowCount: table.rows.length,
    drafts,
    duplicates,
    invalid,
    review,
    unmapped: table.headers.filter((h) => !Object.values(mapping).includes(h)),
    sampleHeaders: table.headers,
    sampleRows: table.rows.slice(0, 5),
  };
}

export function previewSupplierImport(
  table: RawTable,
  mappingInput: RegisterMapping,
  existing: readonly Supplier[],
): RegisterPreview<SupplierDraft> {
  const mapping = sanitizeRegisterMapping(table, "leverantorer", mappingInput);
  const drafts: SupplierDraft[] = [];
  const duplicates: RegisterPreview<SupplierDraft>["duplicates"] = [];
  const invalid: RegisterRowIssue[] = [];
  const review: RegisterRowIssue[] = [];
  const byOrg = new Map<string, Supplier>();
  const byName = new Map<string, Supplier>();
  for (const s of existing) {
    if (s.orgNumber) byOrg.set(digits(s.orgNumber), s);
    byName.set(normalizeKey(s.name), s);
  }
  const seenInFile = new Set<string>();

  table.rows.forEach((row, i) => {
    const line = table.firstDataRowNumber + i;
    const name = value(table, row, mapping, "name");
    if (!name) {
      if (row.every((c) => !c.trim())) return;
      if (invalid.length < MAX_ISSUES) invalid.push({ line, message: "Namn saknas – raden tas inte med." });
      return;
    }
    const orgRaw = value(table, row, mapping, "orgNumber");
    const orgKey = digits(orgRaw);
    const nameKey = normalizeKey(name);
    const match = (orgKey && byOrg.get(orgKey) && { on: "organisationsnummer" }) || (byName.get(nameKey) && { on: "namn" }) || null;
    if (match) {
      if (duplicates.length < MAX_ISSUES) duplicates.push({ line, name, matchedOn: match.on });
      return;
    }
    const fileKey = orgKey || nameKey;
    if (seenInFile.has(fileKey)) {
      if (duplicates.length < MAX_ISSUES) duplicates.push({ line, name, matchedOn: "samma rad två gånger i filen" });
      return;
    }
    seenInFile.add(fileKey);

    let orgNumber: string | undefined;
    if (orgRaw) {
      if (validateSwedishOrganizationNumber(orgRaw).ok) orgNumber = normalizeSwedishOrganizationNumber(orgRaw);
      else if (review.length < MAX_ISSUES) review.push({ line, message: `${name}: organisationsnumret "${orgRaw}" är inte giltigt och lämnas tomt.` });
    }
    const emailRaw = value(table, row, mapping, "email");
    let email: string | undefined;
    if (emailRaw) {
      if (isEmailFormat(emailRaw)) email = emailRaw;
      else if (review.length < MAX_ISSUES) review.push({ line, message: `${name}: e-postadressen "${emailRaw}" ser fel ut och lämnas tom.` });
    }
    const phoneRaw = value(table, row, mapping, "phone");
    const phone = phoneRaw && !/[a-zA-ZåäöÅÄÖ]/.test(phoneRaw) ? (validateSwedishPhone(phoneRaw).ok ? normalizeSwedishPhone(phoneRaw) : phoneRaw) : undefined;
    const postalRaw = value(table, row, mapping, "postalCode");
    let postalCode: string | undefined;
    if (postalRaw) {
      if (validateSwedishPostalCode(postalRaw).ok) postalCode = normalizeSwedishPostalCode(postalRaw);
      else if (review.length < MAX_ISSUES) review.push({ line, message: `${name}: postnumret "${postalRaw}" är inte giltigt och lämnas tomt.` });
    }
    const bgRaw = value(table, row, mapping, "bankgiro");
    let bankgiro: string | undefined;
    if (bgRaw) {
      if (isBankgiroFormat(bgRaw)) bankgiro = normalizeBankgiro(bgRaw);
      else if (review.length < MAX_ISSUES) review.push({ line, message: `${name}: bankgirot "${bgRaw}" har fel format och lämnas tomt.` });
    }
    const pgRaw = value(table, row, mapping, "plusgiro");
    let plusgiro: string | undefined;
    if (pgRaw) {
      if (isPlusgiroFormat(pgRaw)) plusgiro = normalizePlusgiro(pgRaw);
      else if (review.length < MAX_ISSUES) review.push({ line, message: `${name}: plusgirot "${pgRaw}" har fel format och lämnas tomt.` });
    }
    const bankAccount = value(table, row, mapping, "bankAccount") || undefined;
    const ibanRaw = value(table, row, mapping, "iban").replace(/\s/g, "").toUpperCase();
    const iban = ibanRaw && /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(ibanRaw) ? ibanRaw : undefined;
    if (ibanRaw && !iban && review.length < MAX_ISSUES) review.push({ line, message: `${name}: IBAN ser fel ut och lämnas tomt.` });
    const address = value(table, row, mapping, "address") || undefined;
    const city = value(table, row, mapping, "city") || undefined;
    const notes = value(table, row, mapping, "notes") || undefined;
    drafts.push({ name, orgNumber, email, phone, address, postalCode, city, bankgiro, plusgiro, bankAccount, iban, notes });
  });

  return {
    kind: "leverantorer",
    mapping,
    rowCount: table.rows.length,
    drafts,
    duplicates,
    invalid,
    review,
    unmapped: table.headers.filter((h) => !Object.values(mapping).includes(h)),
    sampleHeaders: table.headers,
    sampleRows: table.rows.slice(0, 5),
  };
}

/* ----------------------------------- skapa ---------------------------------- */

export function customersFromDrafts(drafts: CustomerDraft[], now = new Date().toISOString()): Customer[] {
  return drafts.map((d) => ({
    id: uid(),
    kind: d.kind,
    name: d.name,
    ...(d.contactPerson ? { contactPerson: d.contactPerson } : {}),
    ...(d.orgNumber ? { orgNumber: d.orgNumber } : {}),
    ...(d.personalIdentityNumber ? { personalIdentityNumber: d.personalIdentityNumber } : {}),
    email: d.email,
    phone: d.phone,
    ...(d.address ? { address: d.address } : {}),
    ...(d.postalCode ? { postalCode: d.postalCode } : {}),
    ...(d.city ? { city: d.city } : {}),
    notes: d.notes,
    createdAt: now,
  }));
}

export function suppliersFromDrafts(drafts: SupplierDraft[], now = new Date().toISOString()): Supplier[] {
  return drafts.map((d) => ({
    id: uid(),
    name: d.name,
    ...(d.orgNumber ? { orgNumber: d.orgNumber } : {}),
    ...(d.email ? { email: d.email } : {}),
    ...(d.phone ? { phone: d.phone } : {}),
    ...(d.address ? { address: d.address } : {}),
    ...(d.postalCode ? { postalCode: d.postalCode } : {}),
    ...(d.city ? { city: d.city } : {}),
    ...(d.bankgiro ? { bankgiro: d.bankgiro } : {}),
    ...(d.plusgiro ? { plusgiro: d.plusgiro } : {}),
    ...(d.bankAccount ? { bankAccount: d.bankAccount } : {}),
    ...(d.iban ? { iban: d.iban } : {}),
    ...(d.notes ? { notes: d.notes } : {}),
    source: "import",
    createdAt: now,
    updatedAt: now,
  }));
}
