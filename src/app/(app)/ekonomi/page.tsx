import Link from "next/link";
import { Plus, Landmark } from "lucide-react";
import { db } from "@/lib/store";
import { kr, datumKort } from "@/lib/format";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { UploadReceiptButton } from "@/components/money-widgets";
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

export default async function MoneyPage(props: PageProps<"/ekonomi">) {
  await ensurePageBusiness();
  const searchParams = await props.searchParams;
  const tab = (["offerter", "fakturor", "utgifter", "bank"].includes(String(searchParams.flik))
    ? String(searchParams.flik)
    : "offerter") as EkonomiTab;

  const q = param(searchParams.q);
  const page = pageParam(searchParams.sida);
  const account = db().bankAccounts[0];

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Ekonomi"
        subtitle="Alla offerter, fakturor, utgifter och banktransaktioner – sök och hitta."
        actions={
          <>
            <ButtonLink href="/ekonomi/fakturor/ny" variant="secondary">
              <Plus className="size-4" /> Ny faktura
            </ButtonLink>
            <ButtonLink href="/ekonomi/offerter/ny">
              <Plus className="size-4" /> Ny offert
            </ButtonLink>
          </>
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
          })}
          query={{ q, status: statusParam<QuoteStatusFilter>(searchParams.status, QUOTE_STATUS_OPTIONS), page }}
          options={QUOTE_STATUS_OPTIONS}
        />
      ) : null}

      {tab === "fakturor" ? (
        <InvoiceRegister
          result={listInvoicesForTable({
            q,
            status: statusParam<InvoiceStatusFilter>(searchParams.status, INVOICE_STATUS_OPTIONS),
            page,
          })}
          query={{ q, status: statusParam<InvoiceStatusFilter>(searchParams.status, INVOICE_STATUS_OPTIONS), page }}
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
            })}
            query={{ q, status: statusParam<ExpenseStatusFilter>(searchParams.status, EXPENSE_STATUS_OPTIONS), page }}
            options={EXPENSE_STATUS_OPTIONS}
          />
        </div>
      ) : null}

      {tab === "bank" ? (
        !account ? (
          <EmptyState
            icon={Landmark}
            title="Ingen bank kopplad ännu"
            text="När företagskontot kopplas via Open Banking dyker saldo och transaktioner upp här och matchas mot fakturor automatiskt."
          />
        ) : (
          <div className="space-y-6">
            <Card className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
              <div className="flex items-center gap-4">
                <div className="flex size-11 items-center justify-center rounded-xl bg-accent-soft">
                  <Landmark className="size-5 text-accent" />
                </div>
                <div>
                  <p className="text-[15px] font-semibold">
                    {account.name} <span className="font-normal text-muted">· {account.accountNumber}</span>
                  </p>
                  <p className="text-[13px] text-muted">
                    Kopplad via Open Banking{" "}
                    <Badge tone="neutral" className="ml-1">
                      Demo – Tink/riktig bank kopplas senare
                    </Badge>
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[12px] font-medium text-muted">Saldo</p>
                <p className="text-[22px] font-semibold tracking-tight tabular">{kr(account.balance)}</p>
              </div>
            </Card>
            <BankRegister
              result={listBankForTable({
                q,
                status: statusParam<BankStatusFilter>(searchParams.status, BANK_STATUS_OPTIONS),
                page,
              })}
              query={{ q, status: statusParam<BankStatusFilter>(searchParams.status, BANK_STATUS_OPTIONS), page }}
              options={BANK_STATUS_OPTIONS}
            />
          </div>
        )
      ) : null}
    </div>
  );
}
