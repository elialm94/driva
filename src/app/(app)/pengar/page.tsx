import Link from "next/link";
import { Plus, Landmark, ReceiptText, FileText, ShoppingBag } from "lucide-react";
import { db } from "@/lib/store";
import { businessStats } from "@/lib/services/finance";
import { currentVersion, invoiceTotals, quoteTotals, requireCustomer } from "@/lib/services/data";
import { categoryByKey } from "@/lib/bas";
import { kr, relativ, datumKort } from "@/lib/format";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { InvoiceStatusBadge, QuoteStatusBadge, TxStatusBadge } from "@/components/status";
import {
  ExpenseQuestionButtons,
  PaySupplierButton,
  UploadReceiptButton,
} from "@/components/money-widgets";
import { PENGAR_TABS, type PengarTab } from "@/lib/nav";

export const metadata = { title: "Pengar" };

type Tab = PengarTab;

export default async function MoneyPage(props: PageProps<"/pengar">) {
  const searchParams = await props.searchParams;
  const tab = (["offerter", "fakturor", "utgifter", "bank"].includes(String(searchParams.flik))
    ? String(searchParams.flik)
    : "offerter") as Tab;

  const data = db();
  const stats = businessStats();

  const quotes = [...data.quotes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const invoices = [...data.invoices].sort((a, b) => {
    if (a.number == null && b.number == null) return b.createdAt.localeCompare(a.createdAt);
    if (a.number == null) return -1;
    if (b.number == null) return 1;
    return b.number - a.number;
  });
  const expenses = [...data.expenses].sort((a, b) => b.date.localeCompare(a.date));
  const supplierInvoices = [...data.supplierInvoices].sort((a, b) =>
    (a.status + a.dueDate).localeCompare(b.status + b.dueDate)
  );
  const transactions = [...data.bankTransactions].sort((a, b) => b.date.localeCompare(a.date));
  const account = data.bankAccounts[0];

  const rowCls =
    "flex items-center gap-4 px-5 py-4 transition-colors hover:bg-canvas/60 first:rounded-t-[calc(1.25rem-1px)] last:rounded-b-[calc(1.25rem-1px)]";

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Pengar"
        subtitle="Offerter, fakturor, betalningar och utgifter – ihopkopplat och bokfört automatiskt."
        actions={
          <>
            <ButtonLink href="/pengar/fakturor/ny" variant="secondary">
              <Plus className="size-4" /> Ny faktura
            </ButtonLink>
            <ButtonLink href="/pengar/offerter/ny">
              <Plus className="size-4" /> Ny offert
            </ButtonLink>
          </>
        }
      />

      <Card className="mb-7 grid grid-cols-2 gap-y-5 px-6 py-5 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Fakturerat i månaden", value: kr(stats.revenueMonth) },
          { label: "Fakturerat i år", value: kr(stats.revenueYear) },
          { label: "Kostnader i år", value: kr(stats.costsYear) },
          { label: "Uppskattad vinst", value: kr(stats.profitYear), ok: true },
          { label: "Väntar på betalning", value: kr(stats.unpaidSum), warn: stats.overdueSum > 0 },
          { label: "På väg in (godkända offerter)", value: kr(stats.upcomingIncome) },
        ].map((s) => (
          <div key={s.label}>
            <p className="text-[12px] font-medium text-muted">{s.label}</p>
            <p
              className={cx(
                "mt-0.5 text-[17px] font-semibold tracking-tight tabular",
                s.ok ? "text-accent-deep" : s.warn ? "text-danger" : "text-ink"
              )}
            >
              {s.value}
            </p>
          </div>
        ))}
      </Card>

      <div className="mb-5 flex gap-1 overflow-x-auto rounded-2xl bg-ink/4 p-1">
        {PENGAR_TABS.map((t) => (
          <Link
            key={t.key}
            href={`/pengar?flik=${t.key}` as never}
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
        quotes.length === 0 ? (
          <EmptyState icon={FileText} title="Inga offerter ännu" text="Skapa din första offert – kunden godkänner den tryggt med BankID." action={<ButtonLink href="/pengar/offerter/ny">Ny offert</ButtonLink>} />
        ) : (
          <Card className="divide-y divide-line/70">
            {quotes.map((q) => {
              const v = currentVersion(q);
              const customer = requireCustomer(q.customerId);
              return (
                <Link key={q.id} href={`/pengar/offerter/${q.id}` as never} className={rowCls}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium">
                      #{q.number} · {v.title}
                    </p>
                    <p className="text-[13px] text-muted">
                      {customer.name}
                      {q.sentAt ? ` · skickad ${relativ(q.sentAt)}` : ""}
                      {q.status === "skickad" && q.viewedAt ? " · öppnad av kunden" : ""}
                    </p>
                  </div>
                  <p className="text-[15px] font-semibold tabular">{kr(quoteTotals(q).toPay)}</p>
                  <QuoteStatusBadge quote={q} />
                </Link>
              );
            })}
          </Card>
        )
      ) : null}

      {tab === "fakturor" ? (
        invoices.length === 0 ? (
          <EmptyState icon={ReceiptText} title="Inga fakturor ännu" text="Fakturor skapas oftast direkt från ett klart uppdrag – eller manuellt här." action={<ButtonLink href="/pengar/fakturor/ny">Ny faktura</ButtonLink>} />
        ) : (
          <Card className="divide-y divide-line/70">
            {invoices.map((inv) => {
              const customer = requireCustomer(inv.customerId);
              return (
                <Link key={inv.id} href={`/pengar/fakturor/${inv.id}` as never} className={rowCls}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium">
                      {inv.number == null ? "Utkast" : `#${inv.number}`}
                      {inv.type !== "faktura" ? (
                        <span className="ml-2 text-[13px] font-normal text-muted">
                          {inv.type === "delbetalning" ? "Delbetalning" : inv.type === "slutfaktura" ? "Slutfaktura" : "Kredit"}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[13px] text-muted">
                      {customer.name} · förfaller {datumKort(inv.dueDate)}
                      {inv.reminders.length > 0 ? ` · ${inv.reminders.length} påminnelse${inv.reminders.length > 1 ? "r" : ""}` : ""}
                    </p>
                  </div>
                  <p className="text-[15px] font-semibold tabular">{kr(invoiceTotals(inv).toPay)}</p>
                  <InvoiceStatusBadge invoice={inv} />
                </Link>
              );
            })}
          </Card>
        )
      ) : null}

      {tab === "utgifter" ? (
        <div className="space-y-8">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Köp & kvitton</h2>
              <UploadReceiptButton label="Ladda upp kvitto" />
            </div>
            {expenses.length === 0 ? (
              <EmptyState icon={ShoppingBag} title="Inga utgifter ännu" text="Köp från banken dyker upp här automatiskt och matchas mot kvitton." />
            ) : (
              <Card className="divide-y divide-line/70">
                {expenses.map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium">{e.supplier}</p>
                      <p className="text-[13px] text-muted">
                        {datumKort(e.date)}
                        {e.status === "bokford" && e.category ? ` · ${categoryByKey(e.category).label}` : ""}
                        {e.receiptId ? " · kvitto ✓" : ""}
                        {e.bankTransactionId ? " · bank ✓" : ""}
                        {e.jobId ? ` · ${data.jobs.find((j) => j.id === e.jobId)?.title ?? ""}` : ""}
                      </p>
                    </div>
                    <p className="text-[15px] font-semibold tabular">{kr(e.amount)}</p>
                    {e.status === "bokford" ? <Badge tone="ok">Bokförd</Badge> : null}
                    {e.status === "saknar_kvitto" ? <UploadReceiptButton expenseId={e.id} /> : null}
                    {e.status === "behover_svar" && e.question ? (
                      <div className="w-full sm:w-auto">
                        <p className="mb-1.5 text-right text-[13px] font-medium text-soft sm:hidden">{e.question.text}</p>
                        <ExpenseQuestionButtons expenseId={e.id} options={e.question.options} />
                      </div>
                    ) : null}
                  </div>
                ))}
              </Card>
            )}
          </div>

          <div>
            <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Leverantörsfakturor</h2>
            <Card className="divide-y divide-line/70">
              {supplierInvoices.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium">
                      {s.supplier} <span className="text-[13px] font-normal text-muted">· {s.invoiceNumber}</span>
                    </p>
                    <p className="text-[13px] text-muted">
                      {s.description} · {s.status === "obetald" ? `förfaller ${relativ(s.dueDate)}` : "betald"}
                    </p>
                  </div>
                  <p className="text-[15px] font-semibold tabular">{kr(s.amount)}</p>
                  {s.status === "obetald" ? (
                    <>
                      <Badge tone="warn">Obetald</Badge>
                      <PaySupplierButton supplierInvoiceId={s.id} />
                    </>
                  ) : (
                    <Badge tone="ok">Betald & bokförd</Badge>
                  )}
                </div>
              ))}
            </Card>
            <p className="mt-2.5 text-[13px] text-muted">
              Leverantörsfakturor kan även mejlas till <span className="font-medium text-soft">faktura@sodermalmssnickeri.se</span> – de läses av och bokförs automatiskt.
            </p>
          </div>
        </div>
      ) : null}

      {tab === "bank" ? (
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
                  Kopplad via Open Banking <Badge tone="neutral" className="ml-1">Demo – Tink/riktig bank kopplas senare</Badge>
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[12px] font-medium text-muted">Saldo</p>
              <p className="text-[22px] font-semibold tracking-tight tabular">{kr(account.balance)}</p>
            </div>
          </Card>

          <Card className="divide-y divide-line/70">
            {transactions.slice(0, 25).map((tx) => (
              <div key={tx.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium">{tx.counterpart}</p>
                  <p className="text-[13px] text-muted">
                    {datumKort(tx.date)} · {tx.description}
                    {tx.reference ? ` · ${tx.reference}` : ""}
                  </p>
                </div>
                <p className={cx("text-[15px] font-semibold tabular", tx.amount > 0 ? "text-accent-deep" : "text-ink")}>
                  {tx.amount > 0 ? "+" : ""}
                  {kr(tx.amount)}
                </p>
                <TxStatusBadge status={tx.status} />
              </div>
            ))}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
