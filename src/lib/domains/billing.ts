export interface ChargeInput {
  idempotencyKey: string;
  amount: number;
  currency: "SEK";
  description: string;
  hostname: string;
}

export interface ChargeResult {
  ok: true;
  chargeId: string;
}

export interface ChargeFailure {
  ok: false;
  error: string;
}

export interface DomainBillingProvider {
  readonly id: "mock";
  charge(input: ChargeInput): Promise<ChargeResult | ChargeFailure>;
}

const charges = new Map<string, string>();

export function resetMockBilling(): void {
  charges.clear();
}

export class MockBillingProvider implements DomainBillingProvider {
  readonly id = "mock" as const;

  async charge(input: ChargeInput): Promise<ChargeResult | ChargeFailure> {
    const existing = charges.get(input.idempotencyKey);
    if (existing) return { ok: true, chargeId: existing };
    if (input.hostname.startsWith("fail-betala") || input.hostname.startsWith("fail-payment")) {
      return { ok: false, error: "Betalningen gick inte igenom." };
    }
    const chargeId = `chg-${input.idempotencyKey.slice(0, 16)}`;
    charges.set(input.idempotencyKey, chargeId);
    return { ok: true, chargeId };
  }
}

let cached: DomainBillingProvider | null = null;

export function getBillingProvider(): DomainBillingProvider {
  if (!cached) cached = new MockBillingProvider();
  return cached;
}

export function resetBillingCache(): void {
  cached = null;
}
