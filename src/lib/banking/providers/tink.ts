/**
 * LiveTinkProvider – riktig Tink-koppling (sandbox eller produktion, styrt av
 * TINK_ENV). Väljs bara av selectBankProvider när miljön är komplett OCH
 * requesten inte är demo – en demo-request kan aldrig nå hit.
 *
 * Datamodell: en permanent Tink-användare per Driva-företag
 * (external_user_id = företagets id), ett bankmedgivande (credentials) och
 * en cachad användartoken på bank_connections-raden (server-only).
 *
 * Belopp konverteras till hela kronor vid gränsen (tink/amounts.ts) och
 * importeras via registerBankTransactions – matchning/autopilot är orörd.
 */
import { db, save } from "../../store";
import { uid } from "../../ids";
import type { BankAccount, BankConnection, BankTransaction } from "../../types";
import { registerBankTransactions } from "../../services/banking";
import { logActivity } from "../../services/activity";
import { requireActor } from "../../collaboration/actor";
import { isDemoBusiness } from "../../demo";
import { activeBankConnection, upsertBankConnection } from "../connection-state";
import {
  BANK_ERROR_TEXT,
  BankConnectionError,
  TinkApiError,
  tinkCredentialsStatusMessage,
  tinkLinkErrorMessage,
  userFacingBankError,
} from "../errors";
import {
  BANK_STATE_TTL_MS,
  isValidConnectState,
  newConnectState,
  type BankCallbackInput,
  type BankCallbackOutcome,
  type BankProvider,
  type ProviderAccount,
  type ProviderTransaction,
  type StartConnectResult,
} from "../provider";
import { tinkAmountToKronor } from "../tink/amounts";
import type { TinkConfig } from "../tink/config";
import * as tink from "../tink/client";

/** Första synken: så här långt bakåt hämtas bokförda transaktioner. */
const INITIAL_LOOKBACK_DAYS = 90;
/** Vid Uppdatera: överlapp bakåt från senaste synk (idempotent på externalId). */
const REFRESH_OVERLAP_DAYS = 7;
/** Hur länge vi väntar på att banken svarat på refresh innan vi läser det som finns. */
const REFRESH_POLL_ATTEMPTS = 6;
const REFRESH_POLL_INTERVAL_MS = 1000;

const ACCOUNT_TYPES_IMPORTED = new Set(["CHECKING", "SAVINGS", "UNDEFINED", undefined]);

function isoDaysAgo(days: number, from = new Date()): string {
  const d = new Date(from.getTime() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function last4(s: string | undefined): string | undefined {
  const digits = (s ?? "").replace(/\s+/g, "");
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

export function maskedNumberFor(account: tink.TinkAccount): string {
  const ids = account.identifiers ?? {};
  if (ids.pan?.masked) return ids.pan.masked;
  const tail = last4(ids.iban?.bban) ?? last4(ids.iban?.iban) ?? last4(ids.financialInstitution?.accountNumber);
  return tail ? `···· ${tail}` : "····";
}

export function toProviderAccount(account: tink.TinkAccount): ProviderAccount {
  const value = account.balances?.booked?.amount?.value;
  return {
    externalId: account.id,
    name: account.name?.trim() || "Företagskonto",
    maskedNumber: maskedNumberFor(account),
    balance: value ? tinkAmountToKronor(value) : 0,
    type: account.type,
    financialInstitutionId: account.financialInstitutionId,
  };
}

export function toProviderTransaction(tx: tink.TinkTransaction): ProviderTransaction {
  const amount = tinkAmountToKronor(tx.amount.value);
  const display = tx.descriptions?.display?.trim();
  const original = tx.descriptions?.original?.trim();
  const counterpartName = amount > 0 ? tx.counterparties?.payer?.name : tx.counterparties?.payee?.name;
  const date = tx.bookedDateTime ?? (tx.dates?.booked ? `${tx.dates.booked}T00:00:00.000Z` : new Date().toISOString());
  return {
    externalId: tx.id,
    accountExternalId: tx.accountId,
    date,
    amount,
    counterpart: counterpartName?.trim() || display || original || "Okänd",
    description: display || original || tx.descriptions?.detailed?.unstructured?.trim() || "Banktransaktion",
    reference: tx.reference?.trim() || undefined,
  };
}

export class LiveTinkProvider implements BankProvider {
  readonly name = "tink" as const;

  constructor(private readonly cfg: TinkConfig) {}

  private businessId(): string {
    return requireActor().businessId;
  }

  private assertNotDemo(): void {
    // Dubbel grind: selectBankProvider väljer aldrig live för demo, men en
    // felkopplad anropare får ändå aldrig skicka demo-data till Tink.
    if (isDemoBusiness()) throw new BankConnectionError("Demoföretaget kan inte kopplas till en riktig bank.");
  }

  /* --------------------------------- tokens --------------------------------- */

  private async userToken(row: BankConnection): Promise<string> {
    const externalUserId = row.externalUserId ?? this.businessId();
    const now = Date.now();
    if (row.accessToken && row.accessTokenExpiresAt && new Date(row.accessTokenExpiresAt).getTime() - 60_000 > now) {
      return row.accessToken;
    }
    const clientToken = await tink.clientAccessToken(this.cfg, "authorization:grant");
    const token = await tink.userAccessToken(this.cfg, clientToken, { externalUserId });
    upsertBankConnection({
      provider: "tink",
      accessToken: token.accessToken,
      accessTokenExpiresAt: new Date(now + token.expiresInSeconds * 1000).toISOString(),
    });
    return token.accessToken;
  }

  /* ------------------------------- startConnect ------------------------------ */

  async startConnect(): Promise<StartConnectResult> {
    this.assertNotDemo();
    const businessId = this.businessId();
    const existing = activeBankConnection();
    const state = newConnectState(businessId);
    try {
      const clientToken = await tink.clientAccessToken(this.cfg, "user:create,authorization:grant");
      let tinkUserId = existing?.tinkUserId;
      if (!tinkUserId) {
        const created = await tink.createUser(this.cfg, clientToken, { externalUserId: businessId });
        tinkUserId = created.userId ?? tinkUserId;
      }
      // Ett tidigare försök kan ha lyckats hos banken utan att callbacken nådde
      // oss (stängd flik, fel i Tink Link efteråt). Då finns medgivandet redan på
      // Tink-användaren och ett nytt Link-varv ger INVALID_STATE_DUPLICATE_CREDENTIALS.
      // Återanvänd det i stället för att skicka användaren till banken igen.
      if (existing?.provider === "tink" && !existing.credentialsId) {
        const adopted = await this.adoptExistingCredentials(existing);
        if (adopted) return { kind: "connected" };
      }
      const code = await tink.delegateAuthorizationCode(this.cfg, clientToken, {
        externalUserId: businessId,
        idHint: db().settings.name || "Driva",
      });
      const url = tink.buildTinkLinkUrl(this.cfg, { authorizationCode: code, state });
      upsertBankConnection({
        provider: "tink",
        status: "pending",
        externalUserId: businessId,
        tinkUserId,
        pendingState: state,
        pendingStateExpiresAt: new Date(Date.now() + BANK_STATE_TTL_MS).toISOString(),
        lastError: undefined,
      });
      return { kind: "redirect", url };
    } catch (err) {
      const message = userFacingBankError(err);
      upsertBankConnection({
        provider: "tink",
        status: "error",
        externalUserId: businessId,
        lastError: message,
        pendingState: undefined,
        pendingStateExpiresAt: undefined,
      });
      throw new BankConnectionError(message);
    }
  }

  /* ------------------------------- handleCallback ---------------------------- */

  async handleCallback(input: BankCallbackInput): Promise<BankCallbackOutcome> {
    this.assertNotDemo();
    const businessId = this.businessId();
    const row = activeBankConnection();
    if (!row || row.provider !== "tink") throw new BankConnectionError(BANK_ERROR_TEXT.stateMismatch);
    const stateOk = isValidConnectState({
      received: input.state,
      stored: row.pendingState,
      storedExpiresAt: row.pendingStateExpiresAt,
      businessId,
    });
    // State är engångs: rensa oavsett utfall.
    const clearPending = { pendingState: undefined, pendingStateExpiresAt: undefined } as const;
    if (!stateOk) {
      upsertBankConnection({ provider: "tink", status: "error", lastError: BANK_ERROR_TEXT.stateMismatch, ...clearPending });
      throw new BankConnectionError(BANK_ERROR_TEXT.stateMismatch);
    }
    if (input.error) {
      const message = tinkLinkErrorMessage(input.error, input.errorReason);
      if (!message) {
        // Användaren stängde flödet: tillbaka till läget före försöket.
        const previous = row.credentialsId ? "connected" : row.revokedAt ? "revoked" : "disconnected";
        upsertBankConnection({ provider: "tink", status: previous, ...clearPending });
        return "cancelled";
      }
      upsertBankConnection({ provider: "tink", status: "error", lastError: message, ...clearPending });
      return "error";
    }
    const credentialsId = input.credentialsId?.trim();
    if (!credentialsId) {
      upsertBankConnection({ provider: "tink", status: "error", lastError: BANK_ERROR_TEXT.declined, ...clearPending });
      return "error";
    }
    upsertBankConnection({ provider: "tink", credentialsId, ...clearPending });
    try {
      await this.finishConnect(credentialsId);
      return "connected";
    } catch (err) {
      const message = userFacingBankError(err);
      upsertBankConnection({ provider: "tink", status: "error", lastError: message });
      return "error";
    }
  }

  /** Medgivandet finns hos Tink: hämta konton + första transaktionerna och markera kopplad. */
  private async finishConnect(credentialsId: string): Promise<void> {
    const current = activeBankConnection()!;
    const token = await this.userToken(current);
    const bankName = await this.resolveBankName(token, credentialsId);
    const accounts = await this.syncAccounts(token);
    const imported = await this.syncTransactions(token, accounts, isoDaysAgo(INITIAL_LOOKBACK_DAYS));
    const primary = accounts[0];
    upsertBankConnection({
      provider: "tink",
      status: "connected",
      credentialsId,
      bankName,
      maskedAccount: primary?.maskedNumber,
      connectedAt: new Date().toISOString(),
      lastSyncAt: new Date().toISOString(),
      revokedAt: undefined,
      pendingState: undefined,
      pendingStateExpiresAt: undefined,
      lastError: undefined,
    });
    logActivity(`Banken ${bankName} kopplades via Tink och ${imported.imported} transaktioner hämtades.`);
  }

  /**
   * Finns ett fungerande bankmedgivande på Tink-användaren fast vi saknar
   * credentialsId? Adoptera det. Returnerar false (utan att kasta) när inget
   * finns eller när Tink inte går att nå – då kör vi Link-flödet som vanligt.
   */
  private async adoptExistingCredentials(row: BankConnection): Promise<boolean> {
    let candidates: tink.TinkCredentials[];
    try {
      const token = await this.userToken(row);
      candidates = await tink.listCredentials(this.cfg, token);
    } catch {
      return false;
    }
    const usable = candidates.find((c) => c.id && !tinkCredentialsStatusMessage(c.status));
    if (!usable) return false;
    try {
      await this.finishConnect(usable.id);
      return true;
    } catch {
      // Medgivandet är inte användbart – låt användaren koppla om via Link.
      return false;
    }
  }

  /* ---------------------------------- refresh -------------------------------- */

  async refresh(): Promise<{ imported: number; skipped: number }> {
    this.assertNotDemo();
    const row = activeBankConnection();
    if (!row || row.provider !== "tink" || row.status !== "connected" || !row.credentialsId) {
      throw new BankConnectionError(BANK_ERROR_TEXT.notConnected);
    }
    try {
      const token = await this.userToken(row);
      await this.requestBankRefresh(token, row.credentialsId);
      const accounts = await this.syncAccounts(token);
      const since = row.lastSyncAt
        ? isoDaysAgo(REFRESH_OVERLAP_DAYS, new Date(row.lastSyncAt))
        : isoDaysAgo(INITIAL_LOOKBACK_DAYS);
      const result = await this.syncTransactions(token, accounts, since);
      upsertBankConnection({ provider: "tink", lastSyncAt: new Date().toISOString(), lastError: undefined });
      return result;
    } catch (err) {
      const message = userFacingBankError(err);
      // Utgånget medgivande → error-läge så användaren kan koppla om; tillfälliga fel lämnar kopplingen orörd.
      if (err instanceof TinkApiError && (err.status === 401 || err.status === 403)) {
        upsertBankConnection({ provider: "tink", status: "error", lastError: message });
      }
      throw new BankConnectionError(message);
    }
  }

  /** Be banken om färsk data och vänta kort på att den landat. Fel här stoppar inte läsningen. */
  private async requestBankRefresh(token: string, credentialsId: string): Promise<void> {
    try {
      await tink.refreshCredentials(this.cfg, token, credentialsId);
    } catch (err) {
      // 429/409 = redan uppdaterad nyss / pågår – läs det som finns.
      if (!(err instanceof TinkApiError) || err.status === 401 || err.status === 403) throw err;
      return;
    }
    for (let i = 0; i < REFRESH_POLL_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, REFRESH_POLL_INTERVAL_MS));
      const creds = await tink.getCredentials(this.cfg, token, credentialsId).catch(() => null);
      const status = creds?.status?.toUpperCase();
      if (!status || status === "UPDATING" || status === "AUTHENTICATING" || status === "CREATED") continue;
      const problem = tinkCredentialsStatusMessage(status);
      if (problem) {
        upsertBankConnection({ provider: "tink", status: "error", lastError: problem });
        throw new BankConnectionError(problem);
      }
      return;
    }
  }

  /* --------------------------------- accounts -------------------------------- */

  async listAccounts(): Promise<ProviderAccount[]> {
    const row = activeBankConnection();
    if (!row || row.provider !== "tink") throw new BankConnectionError(BANK_ERROR_TEXT.notConnected);
    const token = await this.userToken(row);
    const accounts = await tink.listAccounts(this.cfg, token);
    return accounts.filter((a) => ACCOUNT_TYPES_IMPORTED.has(a.type)).map(toProviderAccount);
  }

  async listTransactions(input: { accountExternalIds: string[]; since?: string }): Promise<ProviderTransaction[]> {
    const row = activeBankConnection();
    if (!row || row.provider !== "tink") throw new BankConnectionError(BANK_ERROR_TEXT.notConnected);
    const token = await this.userToken(row);
    const txs = await tink.listTransactions(this.cfg, token, {
      accountIds: input.accountExternalIds,
      bookedDateGte: input.since,
    });
    return txs.map(toProviderTransaction);
  }

  /** Konton → bankAccounts (idempotent på externalId). Returnerar konton i importordning (CHECKING först). */
  private async syncAccounts(token: string): Promise<ProviderAccount[]> {
    const raw = await tink.listAccounts(this.cfg, token);
    const accounts = raw
      .filter((a) => ACCOUNT_TYPES_IMPORTED.has(a.type))
      .map(toProviderAccount)
      .sort((a, b) => Number(b.type === "CHECKING") - Number(a.type === "CHECKING"));
    if (accounts.length === 0) throw new BankConnectionError(BANK_ERROR_TEXT.declined);
    const data = db();
    const now = new Date().toISOString();
    for (const acc of accounts) {
      let row: BankAccount | undefined = data.bankAccounts.find((a) => a.externalId === acc.externalId);
      if (!row) {
        row = {
          id: `acc-${uid()}`,
          provider: "tink",
          name: acc.name,
          accountNumber: acc.maskedNumber,
          balance: acc.balance,
          connectedAt: now,
          externalId: acc.externalId,
        };
        data.bankAccounts.push(row);
      } else {
        row.name = acc.name;
        row.accountNumber = acc.maskedNumber;
        row.balance = acc.balance;
      }
    }
    // Huvudkontot först: UI:t och simuleringar läser bankAccounts[0].
    const primaryId = data.bankAccounts.find((a) => a.externalId === accounts[0].externalId)?.id;
    if (primaryId && data.bankAccounts[0]?.id !== primaryId) {
      const idx = data.bankAccounts.findIndex((a) => a.id === primaryId);
      const [primary] = data.bankAccounts.splice(idx, 1);
      data.bankAccounts.unshift(primary);
    }
    save();
    return accounts;
  }

  private async syncTransactions(
    token: string,
    accounts: ProviderAccount[],
    since: string
  ): Promise<{ imported: number; skipped: number }> {
    const raw = await tink.listTransactions(this.cfg, token, {
      accountIds: accounts.map((a) => a.externalId),
      bookedDateGte: since,
    });
    const byExternal = new Map(db().bankAccounts.map((a) => [a.externalId, a.id] as const));
    const incoming: BankTransaction[] = [];
    for (const tx of raw) {
      const mapped = toProviderTransaction(tx);
      const accountId = byExternal.get(mapped.accountExternalId);
      if (!accountId) continue;
      incoming.push({
        id: uid(),
        accountId,
        externalId: mapped.externalId,
        date: mapped.date,
        amount: mapped.amount,
        counterpart: mapped.counterpart,
        description: mapped.description,
        ...(mapped.reference ? { reference: mapped.reference } : {}),
        status: "ny",
      });
    }
    // Äldst först så att matchningen ser betalningar i kronologisk ordning.
    incoming.sort((a, b) => a.date.localeCompare(b.date));
    return registerBankTransactions(incoming);
  }

  private async resolveBankName(token: string, credentialsId: string): Promise<string> {
    try {
      const creds = await tink.getCredentials(this.cfg, token, credentialsId);
      const problem = tinkCredentialsStatusMessage(creds.status);
      if (problem) throw new BankConnectionError(problem);
      const providers = await tink.listProviders(this.cfg, token).catch(() => []);
      const hit = providers.find((p) => p.name === creds.providerName);
      const name = hit?.financialInstitutionName || hit?.displayName || prettifyProviderName(creds.providerName);
      return name || "Bank";
    } catch (err) {
      if (err instanceof BankConnectionError) throw err;
      return "Bank";
    }
  }

  /* --------------------------------- disconnect ------------------------------ */

  async disconnect(): Promise<void> {
    this.assertNotDemo();
    const row = activeBankConnection();
    if (!row || row.provider !== "tink") {
      upsertBankConnection({ provider: "tink", status: "revoked", revokedAt: new Date().toISOString() });
      return;
    }
    if (row.credentialsId) {
      try {
        const token = await this.userToken(row);
        await tink.deleteCredentials(this.cfg, token, row.credentialsId);
      } catch (err) {
        // Åtkomsten är inte återkallad – säg det, låt användaren försöka igen.
        throw new BankConnectionError(userFacingBankError(err));
      }
    }
    upsertBankConnection({
      provider: "tink",
      status: "revoked",
      revokedAt: new Date().toISOString(),
      credentialsId: undefined,
      accessToken: undefined,
      accessTokenExpiresAt: undefined,
      pendingState: undefined,
      pendingStateExpiresAt: undefined,
      lastError: undefined,
    });
    logActivity("Bankkopplingen kopplades från. Tidigare transaktioner och verifikationer finns kvar.");
  }
}

/** "se-demobank-password" → "Demobank" när Tink inte ger ett visningsnamn. */
export function prettifyProviderName(name: string | undefined): string {
  if (!name) return "";
  const parts = name.split("-").filter((p) => p && !/^(se|no|dk|fi|gb|de|password|bankid|ob|open|banking|business)$/i.test(p));
  const core = parts[0] ?? "";
  return core ? core.charAt(0).toUpperCase() + core.slice(1) : "";
}
