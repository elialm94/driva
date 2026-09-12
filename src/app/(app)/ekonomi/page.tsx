import { SupplierRegister } from "@/components/supplier-register";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BedDouble, Car, Coffee, Landmark, Plus, Wallet } from "lucide-react";
import { db } from "@/lib/store";
import { kr, datumKort } from "@/lib/format";
import {
  ButtonLink,
  Card,
  CreateActionLabel,
  PageHeader,
  PageHeaderCreateActions,
  cx,
} from "@/components/ui";
import { UploadReceiptButton } from "@/components/money-widgets";
import { hasConnectedBank } from "@/lib/banking/connection-state";
import { bankConnectionView } from "@/lib/banking/connection-state";
import { bankReconciliation } from "@/lib/accounting/reconciliation";
import { CreatePaymentFileButton } from "@/components/payment-file-actions";
import { payerAccountLabel } from "@/lib/services/payment-files";
import { ExpenseRegister, InvoiceRegister, QuoteRegister } from "@/components/economy-register";
import { ownerLiability } from "@/lib/services/manual-expense";
import {
  EXPENSE_STATUS_OPTIONS,
  INVOICE_STATUS_OPTIONS,
  QUOTE_STATUS_OPTIONS,
  listExpensesForTable,
  listInvoicesForTable,
  listQuotesForTable,
  readyToPayBatch,
  type ExpenseStatusFilter,
  type InvoiceStatusFilter,
  type QuoteStatusFilter,
} from "@/lib/services/economy-list";
import { EKONOMI_TABS, type EkonomiTab } from "@/lib/nav";
import { ensurePageBusiness } from "@/lib/auth/session";
import { parseEconomySort } from "@/lib/economy-sort";
import { highlightFromAtgard } from "@/lib/economy-atgard";

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

/** Det som inte kommer via kvitto eller bank: utlägg, mil, traktamente, representation. */
function ManualExpenseShortcuts() {
  const shortcuts: { typ: string; label: string; icon: typeof Plus }[] = [
    { typ: "utlagg", label: "Utlägg", icon: Wallet },
    { typ: "milersattning", label: "Milersättning", icon: Car },
    { typ: "traktamente", label: "Traktamente", icon: BedDouble },
    { typ: "representation", label: "Representation", icon: Coffee },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <span className="text-muted">Registrera för hand:</span>
      {shortcuts.map((s) => {
        const Icon = s.icon;
        return (
          <Link
            key={s.typ}
            href={`/ekonomi/utgifter/ny?typ=${s.typ}` as never}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1 font-medium text-soft transition-colors hover:border-line-strong hover:text-ink"
          >
            <Icon className="size-3.5 text-muted" />
            {s.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Bolagets skuld till ägaren för utlägg och ersättningar – med nästa steg. */
function OwnerLiabilityBanner() {
  const owed = ownerLiability();
  if (owed.balance <= 0) return null;
  return (
    <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div className="min-w-0">
        <p className="text-[14px] font-semibold text-ink">
          Bolaget är skyldigt dig {kr(owed.balance)}
          <span className="ml-2 font-normal text-muted">utlägg och ersättningar som inte förts över</span>
        </p>
        <p className="mt-0.5 text-[13px] text-muted">
          För över beloppet från företagskontot till ditt privata konto. När överföringen syns i banken känns den igen
          och bockar av skulden.
        </p>
      </div>
      <ButtonLink href="/bokforing/bank" variant="secondary">
        <Landmark className="size-4" /> Till banken
      </ButtonLink>
    </Card>
  );
}

function EconomyBankCard() {
  const bank = bankConnectionView();
  const recon = bankReconciliation();
  const saldo = typeof bank.balance === "number" ? bank.balance : null;
  return (
    <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div>
        <p className="text-[13px] text-muted">Företagskonto</p>
        <p className="text-[20px] font-semibold tabular tracking-tight">{saldo != null ? kr(saldo) : "Inget saldo"}</p>
        <p className="mt-0.5 text-[13px] text-soft">
          {recon.ok && recon.reconciledThrough
            ? `Avstämt till ${datumKort(recon.reconciledThrough)}`
            : "Bankhändelser hanteras under Bokföring"}
        </p>
      </div>
      <ButtonLink href="/bokforing/bank" variant="secondary" size="sm">
        <Landmark className="size-4" /> Hantera bankhändelser
      </ButtonLink>
    </Card>
  );
}

export default async function MoneyPage(props: PageProps<"/ekonomi">) {
  await ensurePageBusiness();
  const searchParams = await props.searchParams;
  if (String(searchParams.flik) === "bank") {
    const qs = new URLSearchParams();
    for (const key of ["q", "status", "sida", "atgard", "sort", "direction"] as const) {
      const value = searchParams[key];
      if (typeof value === "string" && value) qs.set(key, value);
    }
    const suffix = qs.toString();
    redirect(suffix ? `/bokforing/bank?${suffix}` : "/bokforing/bank");
  }
  const tab = (["offerter", "fakturor", "utgifter"].includes(String(searchParams.flik))
    ? String(searchParams.flik)
    : "offerter") as EkonomiTab;

  const q = param(searchParams.q);
  const page = pageParam(searchParams.sida);
  const sort = parseEconomySort(searchParams.sort, searchParams.direction);
  const highlightId = highlightFromAtgard(param(searchParams.atgard), tab);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Ekonomi"
        subtitle="Alla offerter, fakturor, utgifter och banktransaktioner – sök och hitta."
        stackActions
        actions={
          <PageHeaderCreateActions>
            <ButtonLink href="/ekonomi/utgifter/ny" variant="secondary" aria-label="Ny utgift">
              <Plus className="size-4 shrink-0" />
              <CreateActionLabel label="Ny utgift" shortLabel="Utgift" />
            </ButtonLink>
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

      <EconomyBankCard />

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
          <div className="mb-4 space-y-4">
            <p className="text-[13px] text-muted">
              Kvitton och leverantörsfakturor. Åtgärder som behövs dyker upp på Hem och Bokföring.
            </p>
            <UploadReceiptButton label="Släpp kvitton här" />
            <ManualExpenseShortcuts />
          </div>
          <OwnerLiabilityBanner />
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
            highlightId={highlightId}
            emptyAction={
              hasConnectedBank() ? undefined : (
                <ButtonLink href="/bokforing/bank" variant="secondary">
                  <Landmark className="size-4" /> Koppla företagskontot
                </ButtonLink>
              )
            }
          />
          <SupplierRegister suppliers={db().suppliers ?? []} />
        </div>
      ) : null}
    </div>
  );
}
