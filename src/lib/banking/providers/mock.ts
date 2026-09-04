/**
 * MockBankProvider – demo-banken. Används för /demo, is_demo-företaget och
 * JSON-läget. Gör NOLL HTTP-anrop: "Koppla företagskonto" kopplar direkt och
 * skapar syntetiska transaktioner som går genom exakt samma import
 * (registerBankTransactions) och matchning som riktiga Tink-transaktioner.
 *
 * Syntetiken är gjord för att visa hela kedjan i Bank-fliken:
 *   * en inbetalning med OCR för äldsta öppna fakturan → bokförs automatiskt
 *   * en inbetalning utan OCR (bara belopp + kundnamn) → "Matcha betalning"
 *   * ett kortköp utan kvitto → "Behöver åtgärd"
 */
import { db, save } from "../../store";
import { uid } from "../../ids";
import type { BankAccount, BankTransaction, Invoice } from "../../types";
import { invoiceOutstanding, isOpenReceivable } from "../../services/data";
import { registerBankTransactions } from "../../services/banking";
import { logActivity } from "../../services/activity";
import { activeBankConnection, upsertBankConnection } from "../connection-state";
import { BANK_ERROR_TEXT, BankConnectionError } from "../errors";
import type {
  BankCallbackInput,
  BankCallbackOutcome,
  BankProvider,
  ProviderAccount,
  ProviderTransaction,
  StartConnectResult,
} from "../provider";

export const MOCK_BANK_NAME = "SEB";
export const MOCK_MASKED_ACCOUNT = "···· 4512";
/** Ingående saldo på demo-kontot – saldot ska se ut som ett riktigt företagskonto, inte börja på noll. */
export const MOCK_OPENING_BALANCE = 48_250;

function ensureMockAccount(): BankAccount {
  const data = db();
  let account = data.bankAccounts[0];
  if (!account) {
    account = {
      id: `acc-${uid()}`,
      provider: "mock",
      name: "Företagskonto",
      accountNumber: `${MOCK_BANK_NAME} ${MOCK_MASKED_ACCOUNT}`,
      balance: MOCK_OPENING_BALANCE,
      connectedAt: new Date().toISOString(),
      externalId: "mock-account-1",
    };
    data.bankAccounts.push(account);
    save();
  }
  return account;
}

function openInvoicesOldestFirst(): Invoice[] {
  return db()
    .invoices.filter((inv) => isOpenReceivable(inv))
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
}

function customerName(customerId: string): string {
  return db().customers.find((c) => c.id === customerId)?.name ?? "Okänd avsändare";
}

/** Syntetiska transaktioner. `variant` styr hur många scenarier som skapas. */
export function mockSyntheticTransactions(accountId: string, variant: "connect" | "refresh"): BankTransaction[] {
  const now = new Date().toISOString();
  const open = openInvoicesOldestFirst();
  const out: BankTransaction[] = [];
  const [first, second] = open;

  if (first) {
    out.push({
      id: uid(),
      accountId,
      externalId: `mock-${uid()}`,
      date: now,
      amount: invoiceOutstanding(first),
      counterpart: customerName(first.customerId),
      description: "Inbetalning bankgiro",
      reference: `OCR ${first.ocr}`,
      status: "ny",
    });
  }
  if (variant === "connect") {
    if (second) {
      out.push({
        id: uid(),
        accountId,
        externalId: `mock-${uid()}`,
        date: now,
        amount: invoiceOutstanding(second),
        counterpart: customerName(second.customerId),
        description: "Inbetalning",
        status: "ny",
      });
    }
    out.push({
      id: uid(),
      accountId,
      externalId: `mock-${uid()}`,
      date: now,
      amount: -489,
      counterpart: "Clas Ohlson",
      description: "Kortköp CLAS OHLSON STOCKHOLM",
      status: "ny",
    });
  } else if (!first) {
    out.push({
      id: uid(),
      accountId,
      externalId: `mock-${uid()}`,
      date: now,
      amount: 1250,
      counterpart: "Okänd avsändare",
      description: "Inbetalning",
      status: "ny",
    });
  }
  return out;
}

export class MockBankProvider implements BankProvider {
  readonly name = "mock" as const;

  async startConnect(): Promise<StartConnectResult> {
    const account = ensureMockAccount();
    const now = new Date().toISOString();
    upsertBankConnection({
      provider: "mock",
      status: "connected",
      bankName: MOCK_BANK_NAME,
      maskedAccount: MOCK_MASKED_ACCOUNT,
      connectedAt: now,
      revokedAt: undefined,
      lastError: undefined,
      pendingState: undefined,
      pendingStateExpiresAt: undefined,
    });
    const txs = mockSyntheticTransactions(account.id, "connect");
    for (const tx of txs) account.balance += tx.amount;
    save();
    const { imported } = registerBankTransactions(txs);
    upsertBankConnection({ provider: "mock", lastSyncAt: new Date().toISOString() });
    logActivity(`Demo-banken kopplades och ${imported} transaktioner hämtades.`);
    return { kind: "connected" };
  }

  async handleCallback(_input: BankCallbackInput): Promise<BankCallbackOutcome> {
    // Mocken skickar aldrig användaren till Tink – en callback är ett no-op.
    return activeBankConnection()?.status === "connected" ? "connected" : "cancelled";
  }

  async refresh(): Promise<{ imported: number; skipped: number }> {
    const row = activeBankConnection();
    const account = db().bankAccounts[0];
    if (!account || (row && row.status !== "connected")) {
      throw new BankConnectionError(BANK_ERROR_TEXT.notConnected);
    }
    const txs = mockSyntheticTransactions(account.id, "refresh");
    for (const tx of txs) account.balance += tx.amount;
    save();
    const result = registerBankTransactions(txs);
    upsertBankConnection({
      provider: "mock",
      status: "connected",
      bankName: row?.bankName ?? MOCK_BANK_NAME,
      maskedAccount: row?.maskedAccount ?? MOCK_MASKED_ACCOUNT,
      connectedAt: row?.connectedAt ?? account.connectedAt,
      lastSyncAt: new Date().toISOString(),
    });
    return result;
  }

  async listAccounts(): Promise<ProviderAccount[]> {
    return db().bankAccounts.map((a) => ({
      externalId: a.externalId ?? a.id,
      name: a.name,
      maskedNumber: a.accountNumber,
      balance: a.balance,
    }));
  }

  async listTransactions(input: { accountExternalIds: string[]; since?: string }): Promise<ProviderTransaction[]> {
    const accounts = db().bankAccounts.filter((a) => input.accountExternalIds.includes(a.externalId ?? a.id));
    const ids = new Set(accounts.map((a) => a.id));
    return db()
      .bankTransactions.filter((t) => ids.has(t.accountId) && (!input.since || t.date >= input.since))
      .map((t) => ({
        externalId: t.externalId ?? t.id,
        accountExternalId: accounts.find((a) => a.id === t.accountId)?.externalId ?? t.accountId,
        date: t.date,
        amount: t.amount,
        counterpart: t.counterpart,
        description: t.description,
        reference: t.reference,
      }));
  }

  async disconnect(): Promise<void> {
    const row = activeBankConnection();
    upsertBankConnection({
      provider: "mock",
      status: "revoked",
      revokedAt: new Date().toISOString(),
      bankName: row?.bankName ?? db().bankAccounts[0]?.name ?? MOCK_BANK_NAME,
      maskedAccount: row?.maskedAccount ?? db().bankAccounts[0]?.accountNumber ?? MOCK_MASKED_ACCOUNT,
      lastError: undefined,
      pendingState: undefined,
      pendingStateExpiresAt: undefined,
    });
    logActivity("Demo-banken kopplades från. Tidigare transaktioner och verifikationer finns kvar.");
  }
}
