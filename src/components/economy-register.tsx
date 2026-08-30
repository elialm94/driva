"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AppLink } from "./app-link";
import { FileText, Landmark, ReceiptText, Search, ShoppingBag } from "lucide-react";
import { Badge, Card, EmptyState, cx, type BadgeTone } from "./ui";
import { Pagination } from "./customer-list";
import { kr, datumKort } from "@/lib/format";
import type { EkonomiTab } from "@/lib/nav";
import type {
  BankStatusFilter,
  BankTableRow,
  ExpenseStatusFilter,
  ExpenseTableRow,
  InvoiceStatusFilter,
  InvoiceTableRow,
  QuoteStatusFilter,
  QuoteTableRow,
} from "@/lib/services/economy-list";
import type { PagedResult } from "@/lib/services/customers";

/**
 * Registerflikarna på Ekonomi: riktiga tabeller med sök, statusfilter och
 * serversidig paginering. Registret är för att HITTA dokument – åtgärds-
 * knapparna bor på Hem/Bokföring och på respektive detaljsida.
 */

export interface EconomyQuery<S extends string> {
  q: string;
  status: S;
  page: number;
}

export function ekonomiRegisterHref(tab: EkonomiTab, query: { q?: string; status?: string; page?: number }): string {
  const sp = new URLSearchParams();
  sp.set("flik", tab);
  if (query.q) sp.set("q", query.q);
  if (query.status && query.status !== "alla") sp.set("status", query.status);
  if (query.page && query.page > 1) sp.set("sida", String(query.page));
  return `/ekonomi?${sp.toString()}`;
}

function useRegisterNav<S extends string>(tab: EkonomiTab, query: EconomyQuery<S>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(query.q);

  useEffect(() => {
    setQ(query.q);
  }, [query.q]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (q === query.q) return;
      startTransition(() => router.replace(ekonomiRegisterHref(tab, { ...query, q, page: 1 }) as never, { scroll: false }));
    }, 200);
    return () => clearTimeout(handle);
  }, [q, query, router, tab]);

  function go(patch: Partial<EconomyQuery<S>>) {
    startTransition(() =>
      router.replace(ekonomiRegisterHref(tab, { ...query, ...patch }) as never, { scroll: false })
    );
  }

  return { q, setQ, go, pending };
}

function Toolbar<S extends string>({
  placeholder,
  q,
  setQ,
  status,
  options,
  onStatus,
}: {
  placeholder: string;
  q: string;
  setQ: (v: string) => void;
  status: S;
  options: readonly [S, string][];
  onStatus: (s: S) => void;
}) {
  return (
    <div className="mb-4 flex flex-col gap-2.5 lg:flex-row lg:items-center">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-2xl border border-line bg-card py-2.5 pl-10 pr-4 text-[15px] shadow-card placeholder:text-muted focus:border-accent"
        />
      </div>
      <div className="flex shrink-0 flex-wrap gap-1">
        {options.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onStatus(key)}
            className={cx(
              "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
              status === key ? "border-ink bg-ink text-white" : "border-line-strong text-soft hover:border-muted"
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NoMatches({
  icon,
  filtered,
  title,
  text,
  action,
}: {
  icon: typeof FileText;
  filtered: boolean;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <EmptyState
      icon={icon}
      title={filtered ? "Inget matchar" : title}
      text={filtered ? "Prova ett annat sökord eller ta bort ett filter." : text}
      action={filtered ? undefined : action}
    />
  );
}

const thCls = "px-3 py-2.5 font-medium";
const headRowCls = "border-b border-line/80 text-[12px] font-medium uppercase tracking-wide text-muted";
const bodyRowCls = "relative border-b border-line/60 last:border-0 hover:bg-canvas/70";

/* ---------------------------------- Offerter ---------------------------------- */

export function QuoteRegister({
  result,
  query,
  options,
}: {
  result: PagedResult<QuoteTableRow>;
  query: EconomyQuery<QuoteStatusFilter>;
  options: readonly [QuoteStatusFilter, string][];
}) {
  const { q, setQ, go, pending } = useRegisterNav("offerter", query);
  const filtered = Boolean(query.q) || query.status !== "alla";

  return (
    <div className={cx(pending && "opacity-70")}>
      <Toolbar
        placeholder="Sök offert, kund eller titel..."
        q={q}
        setQ={setQ}
        status={query.status}
        options={options}
        onStatus={(status) => go({ status, page: 1 })}
      />
      {result.total === 0 ? (
        <NoMatches
          icon={FileText}
          filtered={filtered}
          title="Inga offerter ännu"
          text="Skapa din första offert – kunden signerar den tryggt med BankID."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Card className="overflow-hidden">
              <table className="w-full text-left text-[14px]">
                <thead>
                  <tr className={headRowCls}>
                    <th className={thCls}>Offert</th>
                    <th className={thCls}>Kund</th>
                    <th className={thCls}>Datum</th>
                    <th className={cx(thCls, "text-right")}>Belopp</th>
                    <th className={thCls}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.id} className={bodyRowCls}>
                      <td className="px-3 py-2.5">
                        <AppLink href={`/ekonomi/offerter/${r.id}`} className="absolute inset-0 z-10">
                          <span className="sr-only">Offert #{r.number}</span>
                        </AppLink>
                        <span className="pointer-events-none block truncate font-medium text-ink">
                          #{r.number} · {r.title}
                        </span>
                      </td>
                      <td className="pointer-events-none max-w-44 truncate px-3 py-2.5 text-soft">{r.customerName}</td>
                      <td className="pointer-events-none px-3 py-2.5 text-soft">{datumKort(r.date)}</td>
                      <td className="pointer-events-none px-3 py-2.5 text-right tabular text-ink">{kr(r.amount)}</td>
                      <td className="pointer-events-none px-3 py-2.5">
                        <Badge tone={r.statusTone as BadgeTone}>{r.statusLabel}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
          <div className="space-y-2 md:hidden">
            {result.rows.map((r) => (
              <AppLink key={r.id} href={`/ekonomi/offerter/${r.id}`} className="card block px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-[15px] font-medium">
                    #{r.number} · {r.title}
                  </p>
                  <p className="shrink-0 text-[14px] font-semibold tabular">{kr(r.amount)}</p>
                </div>
                <p className="mt-0.5 truncate text-[13px] text-muted">
                  {r.customerName} · {datumKort(r.date)}
                </p>
                <div className="mt-1.5">
                  <Badge tone={r.statusTone as BadgeTone}>{r.statusLabel}</Badge>
                </div>
              </AppLink>
            ))}
          </div>
          <Pagination result={result} onPage={(page) => go({ page })} />
        </>
      )}
    </div>
  );
}

/* ---------------------------------- Fakturor ---------------------------------- */

export function InvoiceRegister({
  result,
  query,
  options,
}: {
  result: PagedResult<InvoiceTableRow>;
  query: EconomyQuery<InvoiceStatusFilter>;
  options: readonly [InvoiceStatusFilter, string][];
}) {
  const { q, setQ, go, pending } = useRegisterNav("fakturor", query);
  const filtered = Boolean(query.q) || query.status !== "alla";

  return (
    <div className={cx(pending && "opacity-70")}>
      <Toolbar
        placeholder="Sök faktura, kund eller OCR..."
        q={q}
        setQ={setQ}
        status={query.status}
        options={options}
        onStatus={(status) => go({ status, page: 1 })}
      />
      {result.total === 0 ? (
        <NoMatches
          icon={ReceiptText}
          filtered={filtered}
          title="Inga fakturor ännu"
          text="Fakturor skapas oftast direkt från ett klart uppdrag – eller manuellt här."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Card className="overflow-hidden">
              <table className="w-full text-left text-[14px]">
                <thead>
                  <tr className={headRowCls}>
                    <th className={thCls}>Faktura</th>
                    <th className={thCls}>Kund</th>
                    <th className={thCls}>Förfallodatum</th>
                    <th className={cx(thCls, "text-right")}>Belopp</th>
                    <th className={thCls}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.id} className={bodyRowCls}>
                      <td className="px-3 py-2.5">
                        <AppLink href={`/ekonomi/fakturor/${r.id}`} className="absolute inset-0 z-10">
                          <span className="sr-only">Faktura {r.label}</span>
                        </AppLink>
                        <span className="pointer-events-none font-medium text-ink">
                          {r.label}
                          {r.typeLabel ? <span className="ml-2 text-[12px] font-normal text-muted">{r.typeLabel}</span> : null}
                        </span>
                      </td>
                      <td className="pointer-events-none max-w-44 truncate px-3 py-2.5 text-soft">{r.customerName}</td>
                      <td className="pointer-events-none px-3 py-2.5 text-soft">{datumKort(r.dueDate)}</td>
                      <td className="pointer-events-none px-3 py-2.5 text-right tabular text-ink">{kr(r.amount)}</td>
                      <td className="pointer-events-none px-3 py-2.5">
                        <Badge tone={r.statusTone as BadgeTone}>{r.statusLabel}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
          <div className="space-y-2 md:hidden">
            {result.rows.map((r) => (
              <AppLink key={r.id} href={`/ekonomi/fakturor/${r.id}`} className="card block px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-[15px] font-medium">
                    {r.label}
                    {r.typeLabel ? <span className="ml-2 text-[12px] font-normal text-muted">{r.typeLabel}</span> : null}
                  </p>
                  <p className="shrink-0 text-[14px] font-semibold tabular">{kr(r.amount)}</p>
                </div>
                <p className="mt-0.5 truncate text-[13px] text-muted">
                  {r.customerName} · förfaller {datumKort(r.dueDate)}
                </p>
                <div className="mt-1.5">
                  <Badge tone={r.statusTone as BadgeTone}>{r.statusLabel}</Badge>
                </div>
              </AppLink>
            ))}
          </div>
          <Pagination result={result} onPage={(page) => go({ page })} />
        </>
      )}
    </div>
  );
}

/* ------------------------------ Utgifter & kvitton ---------------------------- */

export function ExpenseRegister({
  result,
  query,
  options,
}: {
  result: PagedResult<ExpenseTableRow>;
  query: EconomyQuery<ExpenseStatusFilter>;
  options: readonly [ExpenseStatusFilter, string][];
}) {
  const { q, setQ, go, pending } = useRegisterNav("utgifter", query);
  const filtered = Boolean(query.q) || query.status !== "alla";

  return (
    <div className={cx(pending && "opacity-70")}>
      <Toolbar
        placeholder="Sök leverantör, kategori eller beskrivning..."
        q={q}
        setQ={setQ}
        status={query.status}
        options={options}
        onStatus={(status) => go({ status, page: 1 })}
      />
      {result.total === 0 ? (
        <NoMatches
          icon={ShoppingBag}
          filtered={filtered}
          title="Inga utgifter ännu"
          text="Köp från banken dyker upp här automatiskt och matchas mot kvitton."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Card className="overflow-hidden">
              <table className="w-full text-left text-[14px]">
                <thead>
                  <tr className={headRowCls}>
                    <th className={thCls}>Datum</th>
                    <th className={thCls}>Leverantör</th>
                    <th className={thCls}>Kategori</th>
                    <th className={cx(thCls, "text-right")}>Belopp</th>
                    <th className={thCls}>Underlag / status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={`${r.kind}-${r.id}`} className={bodyRowCls}>
                      <td className="px-3 py-2.5 text-soft">{datumKort(r.date)}</td>
                      <td className="max-w-56 px-3 py-2.5">
                        <span className="block truncate font-medium text-ink">{r.supplier}</span>
                        {r.reference ? <span className="block truncate text-[12px] text-muted">{r.reference}</span> : null}
                      </td>
                      <td className="max-w-44 truncate px-3 py-2.5 text-soft">{r.categoryLabel}</td>
                      <td className="px-3 py-2.5 text-right tabular text-ink">{kr(r.amount)}</td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-2">
                          <Badge tone={r.statusTone as BadgeTone}>{r.statusLabel}</Badge>
                          {r.hasReceipt && r.kind === "utgift" ? (
                            <span className="text-[12px] text-muted">kvitto ✓</span>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
          <div className="space-y-2 md:hidden">
            {result.rows.map((r) => (
              <div key={`${r.kind}-${r.id}`} className="card px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-[15px] font-medium">{r.supplier}</p>
                  <p className="shrink-0 text-[14px] font-semibold tabular">{kr(r.amount)}</p>
                </div>
                <p className="mt-0.5 truncate text-[13px] text-muted">
                  {datumKort(r.date)} · {r.categoryLabel}
                  {r.reference ? ` · ${r.reference}` : ""}
                </p>
                <div className="mt-1.5">
                  <Badge tone={r.statusTone as BadgeTone}>{r.statusLabel}</Badge>
                </div>
              </div>
            ))}
          </div>
          <Pagination result={result} onPage={(page) => go({ page })} />
        </>
      )}
    </div>
  );
}

/* ---------------------------------- Bank -------------------------------------- */

export function BankRegister({
  result,
  query,
  options,
}: {
  result: PagedResult<BankTableRow>;
  query: EconomyQuery<BankStatusFilter>;
  options: readonly [BankStatusFilter, string][];
}) {
  const { q, setQ, go, pending } = useRegisterNav("bank", query);
  const filtered = Boolean(query.q) || query.status !== "alla";

  return (
    <div className={cx(pending && "opacity-70")}>
      <Toolbar
        placeholder="Sök motpart, beskrivning eller referens..."
        q={q}
        setQ={setQ}
        status={query.status}
        options={options}
        onStatus={(status) => go({ status, page: 1 })}
      />
      {result.total === 0 ? (
        <NoMatches
          icon={Landmark}
          filtered={filtered}
          title="Inga transaktioner ännu"
          text="När företagskontot är kopplat dyker transaktionerna upp här."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Card className="overflow-hidden">
              <table className="w-full text-left text-[14px]">
                <thead>
                  <tr className={headRowCls}>
                    <th className={thCls}>Datum</th>
                    <th className={thCls}>Motpart</th>
                    <th className={thCls}>Beskrivning</th>
                    <th className={cx(thCls, "text-right")}>Belopp</th>
                    <th className={thCls}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.id} className={bodyRowCls}>
                      <td className="px-3 py-2.5 text-soft">{datumKort(r.date)}</td>
                      <td className="max-w-44 truncate px-3 py-2.5 font-medium text-ink">{r.counterpart}</td>
                      <td className="max-w-64 truncate px-3 py-2.5 text-soft">
                        {r.description}
                        {r.reference ? <span className="text-muted"> · {r.reference}</span> : null}
                      </td>
                      <td
                        className={cx(
                          "px-3 py-2.5 text-right tabular",
                          r.amount > 0 ? "font-medium text-accent-deep" : "text-ink"
                        )}
                      >
                        {r.amount > 0 ? "+" : ""}
                        {kr(r.amount)}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={r.statusTone as BadgeTone}>{r.statusLabel}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
          <div className="space-y-2 md:hidden">
            {result.rows.map((r) => (
              <div key={r.id} className="card px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-[15px] font-medium">{r.counterpart}</p>
                  <p className={cx("shrink-0 text-[14px] font-semibold tabular", r.amount > 0 && "text-accent-deep")}>
                    {r.amount > 0 ? "+" : ""}
                    {kr(r.amount)}
                  </p>
                </div>
                <p className="mt-0.5 truncate text-[13px] text-muted">
                  {datumKort(r.date)} · {r.description}
                </p>
                <div className="mt-1.5">
                  <Badge tone={r.statusTone as BadgeTone}>{r.statusLabel}</Badge>
                </div>
              </div>
            ))}
          </div>
          <Pagination result={result} onPage={(page) => go({ page })} />
        </>
      )}
    </div>
  );
}
