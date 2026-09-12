import { Landmark } from "lucide-react";
import { Badge, Card, EmptyState, StatusDot } from "@/components/ui";
import {
  CancelPendingBankButton,
  ConnectBankButton,
  DisconnectBankButton,
  RefreshBankButton,
} from "@/components/bank-connection";
import { BankRegister } from "@/components/economy-register";
import { BankInboxStrip } from "@/components/bank-inbox-strip";
import { BankRulesCard } from "@/components/bank-rules-card";
import { bankConnectionView, type BankConnectionView } from "@/lib/banking/connection-state";
import { bankProviderKind } from "@/lib/banking/select";
import { BANK_CONNECTION_STATUS } from "@/lib/status-labels";
import { listBankCounterpartRules } from "@/lib/services/bank-booking";
import {
  BANK_STATUS_OPTIONS,
  bankInboxSummary,
  listBankForTable,
  openBankTransactionCount,
  openReceivablesForMatching,
  type BankStatusFilter,
} from "@/lib/services/economy-list";
import { parseEconomySort } from "@/lib/economy-sort";
import { highlightFromAtgard } from "@/lib/economy-atgard";
import { kr, datumTid } from "@/lib/format";

export const BANK_SECONDARY_LINE =
  "Du loggar in hos banken via Tink. Driva hämtar saldo och transaktioner för att matcha fakturor. Vi kan inte föra över pengar.";

function bankConnectionSubtitle(view: BankConnectionView): string {
  switch (view.status) {
    case "connected":
      if (view.lastSyncAt) return `Senast uppdaterad ${datumTid(view.lastSyncAt)}`;
      if (view.connectedAt) return `Kopplad ${datumTid(view.connectedAt)}`;
      return "Kopplad via Open Banking";
    case "pending":
      return "Slutför inloggningen hos banken. Kom tillbaka hit när du är klar.";
    case "error":
      return view.error ?? BANK_CONNECTION_STATUS.error.label;
    case "revoked":
      return "Driva hämtar inte längre något från banken. Tidigare transaktioner och verifikationer finns kvar.";
    case "disconnected":
      return "Koppla företagskontot så hämtas saldo och transaktioner hit.";
  }
}

export function BankConnectionCard({ view, demo }: { view: BankConnectionView; demo: boolean }) {
  const status = BANK_CONNECTION_STATUS[view.status];
  const identity = [view.bankName, view.maskedAccount].filter(Boolean).join(" · ") || "Företagskonto";

  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft">
          <Landmark className="size-5 text-accent" />
        </div>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
            <span className="truncate">{identity}</span>
            <Badge tone={status.tone}>
              <StatusDot tone={status.tone} />
              {status.label}
            </Badge>
            {demo && view.status === "connected" ? <Badge tone="warn">Demo-bank</Badge> : null}
          </p>
          <p className="text-[13px] text-muted">{bankConnectionSubtitle(view)}</p>
        </div>
      </div>

      {view.status === "connected" ? (
        <div className="flex flex-wrap items-center gap-4">
          {typeof view.balance === "number" ? (
            <div className="text-right">
              <p className="text-[12px] font-medium text-muted">Saldo</p>
              <p className="text-[22px] font-semibold tracking-tight tabular">{kr(view.balance)}</p>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <RefreshBankButton />
            <DisconnectBankButton bankName={view.bankName} />
          </div>
        </div>
      ) : null}

      {view.status === "pending" ? (
        <div className="flex flex-wrap items-center gap-2">
          <ConnectBankButton demo={demo} label="Fortsätt hos banken" variant="secondary" />
          <CancelPendingBankButton />
        </div>
      ) : null}

      {view.status === "error" || view.status === "revoked" || view.status === "disconnected" ? (
        <ConnectBankButton demo={demo} label={view.status === "error" ? "Försök igen" : "Koppla företagskonto"} />
      ) : null}
    </Card>
  );
}

function param(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function statusParam<S extends string>(value: unknown, options: readonly [S, string][]): S {
  const raw = param(value);
  return (options.some(([key]) => key === raw) ? raw : "alla") as S;
}

function pageParam(value: unknown): number {
  const n = Number(param(value));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export function BankWorkspace({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const q = param(searchParams.q);
  const page = pageParam(searchParams.sida);
  const sort = parseEconomySort(searchParams.sort, searchParams.direction);
  const highlightId = highlightFromAtgard(param(searchParams.atgard), "bank");
  const bank = bankConnectionView();
  const bankDemo = bankProviderKind() === "mock";
  const bankStatus: BankStatusFilter =
    param(searchParams.status) === "" && !q && !highlightId && openBankTransactionCount() > 0
      ? "atgard"
      : statusParam<BankStatusFilter>(searchParams.status, BANK_STATUS_OPTIONS);

  if (bank.status === "disconnected" && !bank.hasHistory) {
    return (
      <EmptyState
        icon={Landmark}
        title="Ingen bank kopplad ännu"
        text="När företagskontot kopplas via Open Banking dyker saldo och transaktioner upp här och matchas mot fakturor automatiskt."
        action={
          <div className="flex flex-col items-center gap-3">
            <ConnectBankButton demo={bankDemo} />
            <p className="max-w-md text-[13px] text-muted">{BANK_SECONDARY_LINE}</p>
          </div>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <BankConnectionCard view={bank} demo={bankDemo} />
      {bank.status !== "connected" ? <p className="text-[13px] text-muted">{BANK_SECONDARY_LINE}</p> : null}
      <BankInboxStrip summary={bankInboxSummary()} filterHref="/bokforing/bank?status=atgard" />
      <BankRegister
        result={listBankForTable({ q, status: bankStatus, page, sort })}
        query={{ q, status: bankStatus, page, sort }}
        options={BANK_STATUS_OPTIONS}
        receivables={openReceivablesForMatching()}
        highlightId={highlightId}
      />
      <BankRulesCard rules={listBankCounterpartRules()} />
    </div>
  );
}
