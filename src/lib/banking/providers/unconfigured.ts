/**
 * Riktigt företag utan TINK_*-miljö: ärligt oconfigurerat läge. Ingen metod
 * låtsas lyckas – alla som kräver banken kastar BankNotConfiguredError
 * ("Bankkoppling är inte konfigurerad"). Undantag: disconnect markerar en
 * kvarvarande koppling som frånkopplad lokalt så att UI:t inte fastnar om
 * miljön togs bort efter att banken kopplats.
 */
import { activeBankConnection, upsertBankConnection } from "../connection-state";
import { BankNotConfiguredError } from "../errors";
import type {
  BankCallbackInput,
  BankCallbackOutcome,
  BankProvider,
  ProviderAccount,
  ProviderTransaction,
  StartConnectResult,
} from "../provider";

export class UnconfiguredBankProvider implements BankProvider {
  readonly name = "tink" as const;

  async startConnect(): Promise<StartConnectResult> {
    throw new BankNotConfiguredError();
  }

  async handleCallback(_input: BankCallbackInput): Promise<BankCallbackOutcome> {
    throw new BankNotConfiguredError();
  }

  async refresh(): Promise<{ imported: number; skipped: number }> {
    throw new BankNotConfiguredError();
  }

  async listAccounts(): Promise<ProviderAccount[]> {
    throw new BankNotConfiguredError();
  }

  async listTransactions(): Promise<ProviderTransaction[]> {
    throw new BankNotConfiguredError();
  }

  async disconnect(): Promise<void> {
    const row = activeBankConnection();
    if (!row) return;
    upsertBankConnection({
      provider: row.provider,
      status: "revoked",
      revokedAt: new Date().toISOString(),
      credentialsId: undefined,
      accessToken: undefined,
      accessTokenExpiresAt: undefined,
      pendingState: undefined,
      pendingStateExpiresAt: undefined,
    });
  }
}
