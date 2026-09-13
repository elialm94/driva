/**
 * Rena vymodeller för den gemensamma redovisningsarbetsytan.
 *
 * Funktionerna läser bara ur db() (tenantkontexten är redan laddad av
 * loadOwnerWorkspace/loadPortfolioWorkspace) och vet ingenting om vem som
 * tittar. Det är poängen: ägare och konsult får identiska siffror ur samma
 * tillstånd – behörigheten avgör bara vilka knappar som visas och vilka
 * server actions som släpps igenom (assertCan i tjänstelagret).
 */
import { fiscalYearAsOf, fiscalYears, resolveViewFiscalYear, vatPeriodicity } from "../accounting/fiscal";
import { balansrapport, huvudbok, resultatrapport, saldobalans } from "../accounting/ledger";
import { bankReconciliation } from "../accounting/reconciliation";
import { taxAccountLedger } from "../accounting/tax-account";
import { vatPeriodsFor, type VatPeriodSummary } from "../accounting/vat";
import { vatFlowFocus, vatPeriodFlow, type VatPeriodFlow } from "../accounting/vat-flow";
import { hasConnectedBank } from "../banking/connection-state";
import { listBankForTable } from "../services/economy-list";
import { listVerificationViews } from "../services/verification-correction";

export function momsStatusLabel(state: VatPeriodSummary["state"], blockers: number): string {
  if (state === "deklarerad") return "Granskad";
  if (state === "att_deklarera" && blockers === 0) return "Redo för granskning";
  if (state === "att_deklarera") return "Behöver hanteras";
  return "Pågår";
}

export function momsViewModel(params: { ar?: string; fokus?: string }) {
  const years = fiscalYears();
  const fy = resolveViewFiscalYear(params.ar);
  const periodicity = vatPeriodicity();
  const flows: VatPeriodFlow[] = vatPeriodsFor(fy).map((p) => vatPeriodFlow(p));
  const focusKey = flows.some((f) => f.summary.period.key === params.fokus) ? params.fokus : vatFlowFocus(flows);
  const currentFlow =
    flows.find((f) => f.summary.state === "att_deklarera") ?? flows.find((f) => f.summary.state === "pagaende");
  const current = currentFlow?.summary;
  const blockers = currentFlow?.blockers.length ?? 0;
  return {
    years,
    fy,
    periodicity,
    flows,
    focusKey,
    current,
    currentStatus: current ? momsStatusLabel(current.state, blockers) : null,
  };
}

export function bankSummaryViewModel() {
  return {
    recon: bankReconciliation(),
    unmatched: listBankForTable({ status: "atgard", pageSize: 40 }).rows,
    connected: hasConnectedBank(),
  };
}

export function verifikationerViewModel(params: { sida?: string }, pageSize: number) {
  const all = listVerificationViews();
  const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
  const page = Math.min(Math.max(1, Number(params.sida) || 1), totalPages);
  return { total: all.length, totalPages, page, views: all.slice((page - 1) * pageSize, page * pageSize) };
}

export function rapporterViewModel(params: { ar?: string }) {
  const fy = resolveViewFiscalYear(params.ar);
  const range = { from: fy.startDate, to: fy.endDate };
  return {
    fy,
    years: fiscalYears(),
    resultat: resultatrapport(range),
    balans: balansrapport(fiscalYearAsOf(fy)),
    saldo: saldobalans(range),
  };
}

export function huvudbokViewModel(params: { konto?: string; ar?: string }) {
  const fy = resolveViewFiscalYear(params.ar);
  const selected = params.konto ? Number(params.konto) : undefined;
  const accounts = huvudbok({ from: fy.startDate, to: fy.endDate });
  return {
    fy,
    years: fiscalYears(),
    selected,
    accounts,
    account: selected ? accounts.find((a) => a.account === selected) : undefined,
  };
}

export function skattekontoViewModel() {
  const ledger = taxAccountLedger();
  return { ledger, hasRows: ledger.rows.length > 0 || ledger.opening !== 0 };
}
