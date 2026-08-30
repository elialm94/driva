/**
 * Utbetalningsgräns mot open banking. Samma abstraktion som kontosynk –
 * ingen parallell bankstack. Utan live-provider: ärligt "Bank ej ansluten".
 * Aldrig fejkad framgång.
 */

export interface BankPaymentInstruction {
  amount: number;
  currency: "SEK";
  scheduledDate: string;
  ocr?: string;
  reference?: string;
  recipientAccount: string;
  recipientName: string;
  idempotencyKey: string;
}

export type BankPaymentProviderStatus = "SUBMITTED_TO_BANK" | "AWAITING_APPROVAL" | "SCHEDULED";

export type BankPaymentSubmitResult =
  | { ok: true; providerPaymentId: string; status: BankPaymentProviderStatus }
  | { ok: false; error: string; code: "BANK_NOT_CONNECTED" | "REJECTED" | "DUPLICATE" };

export interface BankPaymentProvider {
  readonly name: string;
  readonly connected: boolean;
  submitPayment(instruction: BankPaymentInstruction): BankPaymentSubmitResult;
}

const BANK_NOT_CONNECTED = "Bank ej ansluten";

export function liveBankPaymentsConfigured(): boolean {
  return process.env.BANK_PAYMENTS_ENABLED === "1" && Boolean(process.env.BANK_PAYMENTS_PROVIDER?.trim());
}

function unconfiguredProvider(): BankPaymentProvider {
  return {
    name: "none",
    connected: false,
    submitPayment: () => ({ ok: false, error: BANK_NOT_CONNECTED, code: "BANK_NOT_CONNECTED" }),
  };
}

let testProvider: BankPaymentProvider | null = null;

/** Endast tester – sätter en tillfällig provider utan att fejk-markera betald. */
export function setTestBankPaymentProvider(provider: BankPaymentProvider | null): void {
  testProvider = provider;
}

export function getBankPaymentProvider(): BankPaymentProvider {
  if (testProvider) return testProvider;
  if (!liveBankPaymentsConfigured()) return unconfiguredProvider();
  return unconfiguredProvider();
}

export function bankNotConnectedMessage(): string {
  return BANK_NOT_CONNECTED;
}
