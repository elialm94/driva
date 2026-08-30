/**
 * ISO 20022 pain.001.001.03 – typad domänbyggare + XML-serialiserare.
 *
 * Genererar CustomerCreditTransferInitiationV03, den version svenska banker
 * (SEB, Handelsbanken, Swedbank, Nordea) tar emot för filbaserade
 * leverantörsbetalningar. Svensk profil:
 *   * Bankgiro/Plusgiro som mottagarkonto via CdtrAcct/Id/Othr/Id med
 *     SchmeNm/Prtry = BGNR respektive PGNR.
 *   * OCR som strukturerad referens i RmtInf/Strd/CdtrRefInf (Cd = SCOR).
 *   * SEK-belopp med exakt 2 decimaler, punktdecimal.
 *   * UTF-8, LF-radslut, deterministisk elementordning enligt schemat.
 *
 * Ingen XML byggs någon annanstans – UI och tjänster går via
 * PaymentExportProvider (payment-export.ts) som anropar hit.
 * Se docs/payment-files.md för profilen i sin helhet.
 */

export const PAIN001_NAMESPACE = "urn:iso:std:iso:20022:tech:xsd:pain.001.001.03";
export const PAIN001_VERSION = "pain.001.001.03";

/* --------------------------------- Domän ---------------------------------- */

export interface Pain001Debtor {
  /** Företagsnamn (Nm, max 70 tecken används). */
  name: string;
  /** Organisationsnummer – enbart siffror i filen (OrgId/Othr). */
  orgNumber?: string;
  /** Betalkontot som debiteras (IBAN). */
  iban: string;
  /** Bankens BIC. Saknas den används Othr/NOTPROVIDED (tillåtet i schemat). */
  bic?: string;
}

export type Pain001CreditorAccountKind = "bankgiro" | "plusgiro" | "iban";

export interface Pain001CreditorAccount {
  kind: Pain001CreditorAccountKind;
  /** Bankgiro/plusgiro: enbart siffror. IBAN: fullt nummer utan mellanslag. */
  account: string;
}

export interface Pain001Payment {
  /** EndToEndId – följer betalningen hela vägen (max 35 tecken). */
  endToEndId: string;
  /** InstrId – instruktionens id mot banken (max 35 tecken). */
  instructionId: string;
  /** Belopp i kronor (två decimaler serialiseras). */
  amount: number;
  currency: "SEK";
  /** Önskat betaldatum YYYY-MM-DD. */
  requestedExecutionDate: string;
  creditorName: string;
  creditorAccount: Pain001CreditorAccount;
  /** OCR-/referensnummer → strukturerad SCOR-referens. */
  ocr?: string;
  /** Fritextmeddelande när OCR saknas (Ustrd, max 140 tecken). */
  message?: string;
}

export interface Pain001Document {
  /** GrpHdr/MsgId – unik per fil och företag (max 35 tecken). */
  messageId: string;
  /** Skapandetidpunkt (ISO). Serialiseras som CreDtTm. */
  createdAt: string;
  debtor: Pain001Debtor;
  payments: Pain001Payment[];
}

/* -------------------------------- Validering ------------------------------ */

const MSG_ID_PATTERN = /^[A-Za-z0-9/\-?:().,'+ ]{1,35}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BIC_PATTERN = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

/** IBAN mod-97-kontroll (ISO 13616). */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const value = ch >= "0" && ch <= "9" ? ch : String(ch.charCodeAt(0) - 55);
    for (const digit of value) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

/**
 * Strukturell validering av dokumentet FÖRE serialisering. Returnerar
 * exakta problem på svenska – aldrig ett generiskt XML-fel. Tom lista = OK.
 */
export function validatePain001Document(doc: Pain001Document): string[] {
  const problems: string[] = [];
  if (!MSG_ID_PATTERN.test(doc.messageId)) {
    problems.push("Filens meddelande-id (MsgId) är ogiltigt – max 35 tecken A–Z, 0–9 och skiljetecken.");
  }
  if (Number.isNaN(Date.parse(doc.createdAt))) {
    problems.push("Filens skapandetidpunkt är ogiltig.");
  }

  const d = doc.debtor;
  if (!d.name.trim()) problems.push("Företagets namn saknas.");
  if (!d.iban.trim()) {
    problems.push("Företagets betalkonto saknas.");
  } else if (!isValidIban(d.iban)) {
    problems.push(`Företagets betalkonto (${d.iban}) är inte ett giltigt IBAN.`);
  }
  if (d.bic && !BIC_PATTERN.test(d.bic.trim().toUpperCase())) {
    problems.push(`Företagets BIC (${d.bic}) är ogiltig – 8 eller 11 tecken (t.ex. ESSESESS).`);
  }
  if (d.orgNumber && !/^\d{10}$/.test(d.orgNumber.replace(/\D/g, ""))) {
    problems.push("Företagets organisationsnummer ser inte ut som 10 siffror.");
  }

  if (doc.payments.length === 0) problems.push("Filen innehåller inga betalningar.");
  for (const p of doc.payments) {
    const who = p.creditorName.trim() || "Okänd mottagare";
    if (!p.creditorName.trim()) problems.push("En betalning saknar mottagarnamn.");
    if (!/^[A-Za-z0-9/\-?:().,'+ ]{1,35}$/.test(p.endToEndId)) {
      problems.push(`Betalningen till ${who} har ogiltigt referens-id (EndToEndId).`);
    }
    if (!(p.amount > 0) || !Number.isFinite(p.amount)) {
      problems.push(`Betalningen till ${who} har ogiltigt belopp.`);
    } else if (Math.round(p.amount * 100) !== p.amount * 100) {
      problems.push(`Betalningen till ${who} har fler än två decimaler.`);
    }
    if (!DATE_PATTERN.test(p.requestedExecutionDate)) {
      problems.push(`Betalningen till ${who} saknar giltigt betaldatum (YYYY-MM-DD).`);
    }
    const acc = p.creditorAccount;
    const compact = acc.account.replace(/[\s-]/g, "");
    if (acc.kind === "bankgiro" && !/^\d{7,8}$/.test(compact)) {
      problems.push(`Bankgirot till ${who} (${acc.account}) är ogiltigt – 7–8 siffror.`);
    }
    if (acc.kind === "plusgiro" && !/^\d{2,8}$/.test(compact)) {
      problems.push(`Plusgirot till ${who} (${acc.account}) är ogiltigt – 2–8 siffror.`);
    }
    if (acc.kind === "iban" && !isValidIban(acc.account)) {
      problems.push(`IBAN till ${who} (${acc.account}) är ogiltigt.`);
    }
    if (p.ocr && !/^\d{2,25}$/.test(p.ocr.replace(/\s/g, ""))) {
      problems.push(`OCR-numret till ${who} (${p.ocr}) är ogiltigt – enbart siffror.`);
    }
  }
  return problems;
}

/* ------------------------------ XML-byggstenar ----------------------------- */

interface XmlNode {
  tag: string;
  attrs?: Record<string, string>;
  children?: XmlNode[];
  text?: string;
}

function el(tag: string, children: (XmlNode | undefined)[]): XmlNode;
function el(tag: string, text: string, attrs?: Record<string, string>): XmlNode;
function el(
  tag: string,
  content: string | (XmlNode | undefined)[],
  attrs?: Record<string, string>
): XmlNode {
  if (typeof content === "string") return { tag, text: content, ...(attrs ? { attrs } : {}) };
  return { tag, children: content.filter((c): c is XmlNode => c !== undefined) };
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function serializeNode(node: XmlNode, indent: number): string {
  const pad = "  ".repeat(indent);
  const attrs = node.attrs
    ? Object.entries(node.attrs)
        .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
        .join("")
    : "";
  if (node.text !== undefined) {
    return `${pad}<${node.tag}${attrs}>${escapeXml(node.text)}</${node.tag}>`;
  }
  const inner = (node.children ?? []).map((c) => serializeNode(c, indent + 1)).join("\n");
  return `${pad}<${node.tag}${attrs}>\n${inner}\n${pad}</${node.tag}>`;
}

/* -------------------------------- Mappning -------------------------------- */

/** Belopp med exakt 2 decimaler och punktdecimal (18500 → "18500.00"). */
export function pain001Amount(amount: number): string {
  return amount.toFixed(2);
}

/** Nm-fält: trimma och begränsa till 70 tecken (bankprofilernas gräns). */
function nm(value: string): string {
  return value.trim().slice(0, 70);
}

function debtorAgent(debtor: Pain001Debtor): XmlNode {
  const bic = debtor.bic?.trim().toUpperCase();
  if (bic) return el("DbtrAgt", [el("FinInstnId", [el("BIC", bic)])]);
  // Schemat kräver DbtrAgt [1..1]; utan BIC identifieras banken via IBAN.
  return el("DbtrAgt", [el("FinInstnId", [el("Othr", [el("Id", "NOTPROVIDED")])])]);
}

function debtorId(debtor: Pain001Debtor): XmlNode | undefined {
  const digits = debtor.orgNumber?.replace(/\D/g, "");
  if (!digits) return undefined;
  return el("Id", [el("OrgId", [el("Othr", [el("Id", digits)])])]);
}

function creditorAccount(account: Pain001CreditorAccount): XmlNode {
  if (account.kind === "iban") {
    return el("CdtrAcct", [el("Id", [el("IBAN", account.account.replace(/\s/g, "").toUpperCase())])]);
  }
  const scheme = account.kind === "bankgiro" ? "BGNR" : "PGNR";
  const digits = account.account.replace(/[\s-]/g, "");
  return el("CdtrAcct", [
    el("Id", [el("Othr", [el("Id", digits), el("SchmeNm", [el("Prtry", scheme)])])]),
  ]);
}

function remittance(payment: Pain001Payment): XmlNode | undefined {
  const ocr = payment.ocr?.replace(/\s/g, "");
  if (ocr) {
    return el("RmtInf", [
      el("Strd", [
        el("CdtrRefInf", [
          el("Tp", [el("CdOrPrtry", [el("Cd", "SCOR")])]),
          el("Ref", ocr),
        ]),
      ]),
    ]);
  }
  const message = payment.message?.trim().slice(0, 140);
  if (message) return el("RmtInf", [el("Ustrd", message)]);
  return undefined;
}

function transaction(payment: Pain001Payment): XmlNode {
  return el("CdtTrfTxInf", [
    el("PmtId", [el("InstrId", payment.instructionId), el("EndToEndId", payment.endToEndId)]),
    el("Amt", [
      { tag: "InstdAmt", text: pain001Amount(payment.amount), attrs: { Ccy: payment.currency } },
    ]),
    el("Cdtr", [el("Nm", nm(payment.creditorName))]),
    creditorAccount(payment.creditorAccount),
    remittance(payment),
  ]);
}

/** Betalningar grupperas per betaldatum – ReqdExctnDt ligger på PmtInf-nivå. */
function paymentGroups(payments: Pain001Payment[]): Map<string, Pain001Payment[]> {
  const groups = new Map<string, Pain001Payment[]>();
  for (const p of payments) {
    const list = groups.get(p.requestedExecutionDate) ?? [];
    list.push(p);
    groups.set(p.requestedExecutionDate, list);
  }
  return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function paymentInfo(
  doc: Pain001Document,
  executionDate: string,
  payments: Pain001Payment[],
  index: number
): XmlNode {
  const controlSum = payments.reduce((sum, p) => sum + p.amount, 0);
  return el("PmtInf", [
    el("PmtInfId", `${doc.messageId.slice(0, 30)}-P${index + 1}`),
    el("PmtMtd", "TRF"),
    el("BtchBookg", "false"),
    el("NbOfTxs", String(payments.length)),
    el("CtrlSum", pain001Amount(controlSum)),
    el("ReqdExctnDt", executionDate),
    el("Dbtr", [el("Nm", nm(doc.debtor.name)), debtorId(doc.debtor)]),
    el("DbtrAcct", [
      el("Id", [el("IBAN", doc.debtor.iban.replace(/\s/g, "").toUpperCase())]),
      el("Ccy", "SEK"),
    ]),
    debtorAgent(doc.debtor),
    el("ChrgBr", "SLEV"),
    ...payments.map(transaction),
  ]);
}

/** CreDtTm utan millisekunder – bankprofilerna förväntar sekundupplösning. */
function creationDateTime(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Serialisera dokumentet till pain.001.001.03-XML. Kastar om dokumentet inte
 * validerar – anropa validatePain001Document först för användbara fel.
 */
export function serializePain001(doc: Pain001Document): string {
  const problems = validatePain001Document(doc);
  if (problems.length > 0) {
    throw new Error(`Bankfilen kan inte skapas: ${problems.join(" ")}`);
  }
  const groups = paymentGroups(doc.payments);
  const totalSum = doc.payments.reduce((sum, p) => sum + p.amount, 0);

  const root: XmlNode = {
    tag: "Document",
    attrs: {
      xmlns: PAIN001_NAMESPACE,
      "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
    },
    children: [
      el("CstmrCdtTrfInitn", [
        el("GrpHdr", [
          el("MsgId", doc.messageId),
          el("CreDtTm", creationDateTime(doc.createdAt)),
          el("NbOfTxs", String(doc.payments.length)),
          el("CtrlSum", pain001Amount(totalSum)),
          el("InitgPty", [el("Nm", nm(doc.debtor.name)), debtorId(doc.debtor)]),
        ]),
        ...[...groups.entries()].map(([date, payments], i) => paymentInfo(doc, date, payments, i)),
      ]),
    ],
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serializeNode(root, 0)}\n`;
}
