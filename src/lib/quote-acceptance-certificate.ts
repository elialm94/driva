import type { Quote, QuoteAcceptance, QuoteVersion } from "./types";
import { quoteVersionHash } from "./hash";
import { datumTid, kr } from "./format";
import { docTotals } from "./calc";
import { resolveQuoteCompany } from "./invoices/snapshot";
import { db } from "./store";
import { getQuoteByToken, quoteAcceptance } from "./services/data";
import { describeUserAgent } from "./quote-acceptance";

/**
 * Underlag som intyg: samma sparade fält som QuoteAcceptance, omformulerat
 * så att en snickare kan lämna det till ett ombud. Inga nya bevisfält.
 */

export const CERTIFICATE_TITLE = "Intyg om godkännande av offert";
export const CERTIFICATE_PRINT_LABEL = "Skriv ut eller spara som PDF";

export const SIMPLE_SIGNATURE_DISCLAIMER =
  "Godkännandet är en enkel elektronisk underskrift. Det bygger på namnet kunden angav och på att offertlänken skickades till kundens e-post. Ingen e-legitimation har använts.";

export interface CertificateFact {
  label: string;
  value: string;
}

export interface AcceptanceCertificateModel {
  quoteToken: string;
  quoteNumber: number;
  title: string;
  companyName: string;
  companyOrgNumber: string;
  customerName: string;
  acceptedByName: string;
  acceptedAt: string;
  acceptedAtLabel: string;
  amountLabel: string;
  deductionLabel?: string;
  statement: string;
  intact: boolean;
  statusText: string;
  summary: string;
  facts: CertificateFact[];
  methodText: string;
  versionLabel: string;
  storedHash: string;
  currentHash: string;
  linkSentTo?: string;
  acceptedByEmail?: string;
  ip?: string;
  device?: string;
  legacyDemo: boolean;
}

function whenInProse(iso: string): string {
  return `den ${datumTid(iso).replace(", ", " klockan ")}`;
}

function methodSentence(acceptedByName: string, legacyDemo: boolean): string {
  if (legacyDemo) {
    return "Godkännandet kommer från en äldre demo-signering. Ingen legitimering har skett.";
  }
  return `Godkännandet skedde på den skickade offertlänken: ${acceptedByName} skrev sitt namn och tryckte Godkänn offert.`;
}

export function buildAcceptanceCertificate(input: {
  quote: Quote;
  version: QuoteVersion;
  acceptance: QuoteAcceptance;
}): AcceptanceCertificateModel {
  const { quote, version, acceptance } = input;
  const seller = resolveQuoteCompany(version, db().settings);
  const totals = docTotals(version.lines, version.rot);
  const currentHash = quoteVersionHash(version);
  const intact = currentHash === acceptance.contentHash;
  const legacyDemo = Boolean(acceptance.bankid) || acceptance.method === "bankid_mock";
  const acceptedAtLabel = datumTid(acceptance.acceptedAt);
  const amountLabel = kr(totals.total);
  const deductionLabel = totals.deduction > 0 ? kr(totals.deduction) : undefined;
  const amountSentence = deductionLabel
    ? `Det totala beloppet är ${amountLabel}, varav ${deductionLabel} är ett preliminärt ROT/RUT-avdrag.`
    : `Det totala beloppet är ${amountLabel}.`;

  const summary = [
    `${acceptance.acceptedByName} godkände offert #${quote.number} “${version.title}” från ${seller.name} ${whenInProse(acceptance.acceptedAt)}.`,
    amountSentence,
    `Kunden i offerten är ${acceptance.customerNameAtAccept}.`,
    methodSentence(acceptance.acceptedByName, legacyDemo),
    "Detta intyg redogör för vad som godkändes och kan lämnas vidare om det uppstår oenighet om godkännandet.",
  ].join(" ");

  const facts: CertificateFact[] = [
    { label: "Avsändare", value: `${seller.name} (org.nr ${seller.orgNumber})` },
    { label: "Kund", value: acceptance.customerNameAtAccept },
    { label: "Godkänd av", value: acceptance.acceptedByName },
    { label: "Tidpunkt", value: acceptedAtLabel },
    { label: "Offert", value: `#${quote.number} – ${version.title}` },
    { label: "Belopp", value: amountLabel },
  ];

  const locked = version.lockedAt ? `låst ${datumTid(version.lockedAt)}` : "låst vid godkännandet";

  return {
    quoteToken: quote.token,
    quoteNumber: quote.number,
    title: version.title,
    companyName: seller.name,
    companyOrgNumber: seller.orgNumber,
    customerName: acceptance.customerNameAtAccept,
    acceptedByName: acceptance.acceptedByName,
    acceptedAt: acceptance.acceptedAt,
    acceptedAtLabel,
    amountLabel,
    deductionLabel,
    statement: acceptance.statement,
    intact,
    statusText: intact
      ? "Dokumentet är oförändrat. Det som visades när offerten godkändes är detsamma som idag."
      : "Dokumentet har ändrats. Innehållet stämmer inte längre med det som godkändes.",
    summary,
    facts,
    methodText: methodSentence(acceptance.acceptedByName, legacyDemo),
    versionLabel: `Version ${version.version} (${locked})`,
    storedHash: acceptance.contentHash,
    currentHash,
    linkSentTo: acceptance.linkSentTo,
    acceptedByEmail: acceptance.acceptedByEmail,
    ip: acceptance.ip,
    device: describeUserAgent(acceptance.userAgent),
    legacyDemo,
  };
}

/** Laddar intyget för en publik offertlänk. Null = ingen sida. */
export function getAcceptanceCertificateByToken(token: string): AcceptanceCertificateModel | null {
  const quote = getQuoteByToken(token);
  if (!quote || quote.status === "utkast") return null;
  const acceptance = quoteAcceptance(quote.id);
  if (!acceptance) return null;
  const version = db().quoteVersions.find((v) => v.id === acceptance.quoteVersionId);
  if (!version) return null;
  return buildAcceptanceCertificate({ quote, version, acceptance });
}
