import Link from "next/link";
import { Plus, Landmark } from "lucide-react";
import { db } from "@/lib/store";
import { kr, datumKort, datumTid } from "@/lib/format";
import {
  Badge,
  ButtonLink,
  Card,
  CreateActionLabel,
  EmptyState,
  PageHeader,
  PageHeaderCreateActions,
  StatusDot,
  cx,
} from "@/components/ui";
import { UploadReceiptButton } from "@/components/money-widgets";
import {
  BankNoticeToast,
  CancelPendingBankButton,
  ConnectBankButton,
  DisconnectBankButton,
  RefreshBankButton,
} from "@/components/bank-connection";
import { bankConnectionView, type BankConnectionView } from "@/lib/banking/connection-state";
import { bankProviderKind } from "@/lib/banking/select";
import { BANK_CONNECTION_STATUS } from "@/lib/status-labels";
import { CreatePaymentFileButton } from "@/components/payment-file-actions";
import { payerAccountLabel } from "@/lib/services/payment-files";
import {
  BankRegister,
  ExpenseRegister,
  InvoiceRegister,
  QuoteRegister,
} from "@/components/economy-register";
import {
  BANK_STATUS_OPTIONS,
  EXPENSE_STATUS_OPTIONS,
  INVOICE_STATUS_OPTIONS,
  QUOTE_STATUS_OPTIONS,
  listBankForTable,
  listExpensesForTable,
  listInvoicesForTable,
  listQuotesForTable,
  readyToPayBatch,
  type BankStatusFilter,
  type ExpenseStatusFilter,
  type InvoiceStatusFilter,
  type QuoteStatusFilter,
} from "@/lib/services/economy-list";
import { EKONOMI_TABS, type EkonomiTab } from "@/lib/nav";
import { ensurePageBusiness } from "@/lib/auth/session";
import { parseEconomySort } from "@/lib/economy-sort";
import { Suspense } from "react";
import { DraftDiscardedToast } from "@/components/draft-discarded-toast";

export const metadata = { title: "Ekonomi" };

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

/**
 * Batchåtgärden på Utgifter & kvitton: alla fakturor som passerar bankfils-
 * vakterna kan betalas med EN pain.001-fil (multi-payment, krav 17).
 */
function ReadyToPayBanner() {
  const batch = readyToPayBatch();
  if (batch.count === 0) return null;
  const payer = payerAccountLabel();
  const confirmRows = [
    ...batch.rows.map((r) => ({
      label: `${r.supplier} · ${r.invoiceNumber}`,
      value: `${kr(r.amount)} · förfaller ${datumKort(r.dueDate)}`,
    })),
    ...(batch.count > 1 ? [{ label: "Totalt", value: kr(batch.total) }] : []),
    ...(payer ? [{ label: "Från", value: `${db().settings.name}, ${payer}` }] : []),
  ];
  return (
    <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div className="min-w-0">
        <p className="text-[14px] font-semibold text-ink">
          {batch.count === 1 ? "1 faktura är redo att betalas" : `${batch.count} fakturor är redo att betalas`}
          <span className="ml-2 font-normal text-muted">totalt {kr(batch.total)}</span>
        </p>
        <p className="mt-0.5 truncate text-[13px] text-muted">
          {batch.rows.map((r) => `${r.supplier} ${kr(r.amount)}`).join(" · ")}
        </p>
      </div>
      <CreatePaymentFileButton
        supplierInvoiceIds={batch.invoiceIds}
        title={batch.count === 1 ? `Betala ${batch.rows[0].supplier}?` : `Betala ${batch.count} fakturor?`}
        confirmRows={confirmRows}
      />
    </Card>
  );
}

const BANK_SECONDARY_LINE =
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

/**
 * Bankkopplingens kort ovanför transaktionslistan. Läser bara projektionen
 * (bankConnectionView) – aldrig tokens eller Tink-id:n. Status-etiketter
 * kommer från status-labels, aldrig råa enum-värden.
 */
function BankConnectionCard({ view, demo }: { view: BankConnectionView; demo: boolean }) {
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

export default async function MoneyPage(props: PageProps<"/ekonomi">) {
  await ensurePageBusiness();
  const searchParams = await props.searchParams;
  const tab = (["offerter", "fakturor", "utgifter", "bank"].includes(String(searchParams.flik))
    ? String(searchParams.flik)
    : "offerter") as EkonomiTab;

  const q = param(searchParams.q);
  const page = pageParam(searchParams.sida);
  const sort = parseEconomySort(searchParams.sort, searchParams.direction);
  const bank = tab === "bank" ? bankConnectionView() : null;
  const bankDemo = tab === "bank" ? bankProviderKind() === "mock" : false;

  return (
    <div className="animate-fade-up">
      <Suspense>
        <DraftDiscardedToast />
        {tab === "bank" ? <BankNoticeToast /> : null}
      </Suspense>
      <PageHeader
        title="Ekonomi"
        subtitle="Alla offerter, fakturor, utgifter och banktransaktioner – sök och hitta."
        stackActions
        actions={
          <PageHeaderCreateActions>
            <ButtonLink href="/ekonomi/fakturor/ny" variant="secondary" aria-label="Ny faktura">
              <Plus className="size-4 shrink-0" />
              <CreateActionLabel label="Ny faktura" shortLabel="Faktura" />
            </ButtonLink>
            <ButtonLink href="/ekonomi/offerter/ny" aria-label="Ny offert">
              <Plus className="size-4 shrink-0" />
              <CreateActionLabel label="Ny offert" shortLabel="Offert" />
            </ButtonLink>
          </PageHeaderCreateActions>
        }
      />

      <div className="mb-5 flex gap-1 overflow-x-auto rounded-2xl bg-ink/4 p-1">
        {EKONOMI_TABS.map((t) => (
          <Link
            key={t.key}
            href={`/ekonomi?flik=${t.key}` as never}
            className={cx(
              "flex-1 whitespace-nowrap rounded-xl px-4 py-2 text-center text-sm font-medium transition-all",
              tab === t.key ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "offerter" ? (
        <QuoteRegister
          result={listQuotesForTable({
            q,
            status: statusParam<QuoteStatusFilter>(searchParams.status, QUOTE_STATUS_OPTIONS),
            page,
            sort,
          })}
          query={{ q, status: statusParam<QuoteStatusFilter>(searchParams.status, QUOTE_STATUS_OPTIONS), page, sort }}
          options={QUOTE_STATUS_OPTIONS}
        />
      ) : null}

      {tab === "fakturor" ? (
        <InvoiceRegister
          result={listInvoicesForTable({
            q,
            status: statusParam<InvoiceStatusFilter>(searchParams.status, INVOICE_STATUS_OPTIONS),
            page,
            sort,
          })}
          query={{ q, status: statusParam<InvoiceStatusFilter>(searchParams.status, INVOICE_STATUS_OPTIONS), page, sort }}
          options={INVOICE_STATUS_OPTIONS}
        />
      ) : null}

      {tab === "utgifter" ? (
        <div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-[13px] text-muted">
              Kvitton och leverantörsfakturor. Åtgärder som behövs dyker upp på Hem och Bokföring.
            </p>
            <UploadReceiptButton label="Ladda upp kvitto" />
          </div>
          <ReadyToPayBanner />
          <ExpenseRegister
            result={listExpensesForTable({
              q,
              status: statusParam<ExpenseStatusFilter>(searchParams.status, EXPENSE_STATUS_OPTIONS),
              page,
              sort,
            })}
            query={{ q, status: statusParam<ExpenseStatusFilter>(searchParams.status, EXPENSE_STATUS_OPTIONS), page, sort }}
            options={EXPENSE_STATUS_OPTIONS}
          />
        </div>
      ) : null}

      {tab === "bank" && bank ? (
        bank.status === "disconnected" && !bank.hasHistory ? (
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
        ) : (
          <div className="space-y-6">
            <BankConnectionCard view={bank} demo={bankDemo} />
            {bank.status !== "connected" ? (
              <p className="text-[13px] text-muted">{BANK_SECONDARY_LINE}</p>
            ) : null}
            <BankRegister
              result={listBankForTable({
                q,
                status: statusParam<BankStatusFilter>(searchParams.status, BANK_STATUS_OPTIONS),
                page,
                sort,
              })}
              query={{ q, status: statusParam<BankStatusFilter>(searchParams.status, BANK_STATUS_OPTIONS), page, sort }}
              options={BANK_STATUS_OPTIONS}
            />
          </div>
        )
      ) : null}
    </div>
  );
}
