/**
 * Bankkopplingens tillstånd i tenantens state – läs/skriv-hjälpare utan
 * leverantörsberoenden (importeras av både matchningsmotorn och providers).
 *
 * UI:t läser ALDRIG BankConnection-raden direkt: bankConnectionView() är en
 * projektion utan tokens, Tink-id:n eller CSRF-state.
 */
import { db, save } from "../store";
import { uid } from "../ids";
import type { BankAccount, BankConnection, BankConnectionStatus } from "../types";

export function bankConnections(): BankConnection[] {
  const data = db();
  data.bankConnections ??= [];
  return data.bankConnections;
}

/** Företagets (enda) bankkoppling, om raden finns. */
export function activeBankConnection(): BankConnection | undefined {
  return bankConnections()[0];
}

/** Skapa/uppdatera kopplingsraden. Sparar. */
export function upsertBankConnection(
  patch: Partial<Omit<BankConnection, "id" | "createdAt" | "updatedAt">> & { provider: BankConnection["provider"] }
): BankConnection {
  const list = bankConnections();
  const now = new Date().toISOString();
  let row = list[0];
  if (!row) {
    row = { id: `bankconn-${uid()}`, provider: patch.provider, status: "disconnected", createdAt: now, updatedAt: now };
    list.push(row);
  }
  Object.assign(row, patch, { updatedAt: now });
  // Valfria fält som satts till undefined ska bort ur JSON:en (exakt rundresa).
  for (const key of Object.keys(row) as (keyof BankConnection)[]) {
    if (row[key] === undefined) delete row[key];
  }
  save();
  return row;
}

/** Projektion för UI – innehåller inga hemligheter. */
export interface BankConnectionView {
  status: BankConnectionStatus;
  provider: "mock" | "tink";
  bankName?: string;
  maskedAccount?: string;
  lastSyncAt?: string;
  connectedAt?: string;
  /** Senaste användarvända felet (bara i status error). */
  error?: string;
  /** Saldo på huvudkontot (bara när kopplad). */
  balance?: number;
  /** Finns tidigare transaktioner kvar att visa (även efter Koppla från)? */
  hasHistory: boolean;
}

/**
 * Härled vyn. Äldre data (seed/JSON före kopplingsraden) har ett mock-konto
 * men ingen rad – det presenteras som kopplad demo-bank tills användaren
 * kopplar från, då raden skapas.
 */
export function bankConnectionView(): BankConnectionView {
  const data = db();
  const row = activeBankConnection();
  const account = data.bankAccounts[0];
  const hasHistory = data.bankTransactions.length > 0;
  if (row) {
    return {
      status: row.status,
      provider: row.provider,
      bankName: row.bankName ?? (row.status === "connected" ? account?.name : undefined),
      maskedAccount: row.maskedAccount ?? (row.status === "connected" ? account?.accountNumber : undefined),
      lastSyncAt: row.lastSyncAt,
      connectedAt: row.connectedAt,
      error: row.status === "error" ? row.lastError : undefined,
      balance: row.status === "connected" ? account?.balance : undefined,
      hasHistory,
    };
  }
  if (account) {
    return {
      status: "connected",
      provider: account.provider,
      bankName: account.name,
      maskedAccount: account.accountNumber,
      connectedAt: account.connectedAt,
      balance: account.balance,
      hasHistory,
    };
  }
  return { status: "disconnected", provider: "mock", hasHistory };
}

export function hasConnectedBank(): boolean {
  return bankConnectionView().status === "connected";
}

/** Kontot att simulera/importera mot – bara när kopplingen är aktiv. */
export function connectedBankAccount(): BankAccount | undefined {
  if (!hasConnectedBank()) return undefined;
  return db().bankAccounts[0];
}
