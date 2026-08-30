/**
 * Exportgräns för betalningsfiler. En PaymentExportProvider tar en neutral
 * exportförfrågan (betalare + betalningar) och producerar filinnehållet.
 *
 * V1 levererar ISO20022_PAIN001 (pain.001.001.03, svensk profil – se
 * pain001.ts och docs/payment-files.md). Bankspecifika profiler kan läggas
 * till senare som egna providers utan att livscykeln byggs om. Detta är
 * FILEXPORT – en framtida BankPaymentProvider.submitPayment() (direktkanal)
 * är en annan gräns (payment-provider.ts) och byggs inte här.
 */
import type { PaymentExportFormat } from "../types";
import {
  serializePain001,
  validatePain001Document,
  PAIN001_VERSION,
  type Pain001Document,
  type Pain001Payment,
} from "./pain001";

export interface PaymentExportPayer {
  name: string;
  orgNumber?: string;
  iban: string;
  bic?: string;
}

export interface PaymentExportInstruction {
  /** Instruktionens id i Driva (blir InstrId). */
  instructionId: string;
  /** Spårbar referens hela vägen till kontoutdraget (blir EndToEndId). */
  endToEndId: string;
  amount: number;
  currency: "SEK";
  requestedExecutionDate: string;
  recipientName: string;
  recipientAccount: { kind: "bankgiro" | "plusgiro" | "iban"; account: string };
  ocr?: string;
  message?: string;
}

export interface PaymentExportRequest {
  messageId: string;
  createdAt: string;
  payer: PaymentExportPayer;
  instructions: PaymentExportInstruction[];
}

export type PaymentExportResult =
  | { ok: true; content: string; contentType: string; extension: string; profile: string }
  | { ok: false; problems: string[] };

export interface PaymentExportProvider {
  readonly format: PaymentExportFormat;
  /** Mänskligt läsbar profilbeskrivning (visas i metadata/dokumentation). */
  readonly profile: string;
  /** Validera utan att generera – exakta problem på svenska. Tom lista = OK. */
  validate(request: PaymentExportRequest): string[];
  /** Validera + generera filinnehållet. Misslyckas aldrig med generiskt XML-fel. */
  build(request: PaymentExportRequest): PaymentExportResult;
}

/* ----------------------------- pain.001-provider --------------------------- */

function toPain001Document(request: PaymentExportRequest): Pain001Document {
  const payments: Pain001Payment[] = request.instructions.map((i) => ({
    endToEndId: i.endToEndId,
    instructionId: i.instructionId,
    amount: i.amount,
    currency: i.currency,
    requestedExecutionDate: i.requestedExecutionDate,
    creditorName: i.recipientName,
    creditorAccount: i.recipientAccount,
    ...(i.ocr ? { ocr: i.ocr } : {}),
    ...(i.message ? { message: i.message } : {}),
  }));
  return {
    messageId: request.messageId,
    createdAt: request.createdAt,
    debtor: {
      name: request.payer.name,
      ...(request.payer.orgNumber ? { orgNumber: request.payer.orgNumber } : {}),
      iban: request.payer.iban,
      ...(request.payer.bic ? { bic: request.payer.bic } : {}),
    },
    payments,
  };
}

const pain001Provider: PaymentExportProvider = {
  format: "ISO20022_PAIN001",
  profile: `ISO 20022 ${PAIN001_VERSION} (svensk profil: BGNR/PGNR + SCOR-OCR)`,
  validate(request) {
    return validatePain001Document(toPain001Document(request));
  },
  build(request) {
    const doc = toPain001Document(request);
    const problems = validatePain001Document(doc);
    if (problems.length > 0) return { ok: false, problems };
    return {
      ok: true,
      content: serializePain001(doc),
      contentType: "application/xml; charset=utf-8",
      extension: "xml",
      profile: this.profile,
    };
  },
};

const PROVIDERS: Record<PaymentExportFormat, PaymentExportProvider> = {
  ISO20022_PAIN001: pain001Provider,
};

export function getPaymentExportProvider(format: PaymentExportFormat = "ISO20022_PAIN001"): PaymentExportProvider {
  return PROVIDERS[format];
}
