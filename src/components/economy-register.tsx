"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AppLink } from "./app-link";
import { ArrowUpDown, ChevronDown, ChevronUp, FileText, Landmark, Pencil, Plus, ReceiptText, Search, ShoppingBag } from "lucide-react";
import { DiscardDraftButton } from "./discard-draft-button";
import { Badge, ButtonLink, Card, EmptyState, buttonClasses, cx, type BadgeTone } from "./ui";
import { Pagination } from "./customer-list";
import { BankRowActions } from "./bank-row-actions";
import { ExpenseQuestionButtons, UploadReceiptButton } from "./money-widgets";
import { UndoBookingButton } from "./bokforing-widgets";
import { ScrollToId } from "./scroll-to-id";
import { kr, datumKort } from "@/lib/format";
import type { EkonomiTab } from "@/lib/nav";
import {
  ekonomiRegisterHref,
  economyMobileSortOptions,
  economySortValue,
  nextEconomySort,
  parseEconomySortValue,
  type EconomySortKey,
  type EconomySortState,
} from "@/lib/economy-sort";
import type {
  BankStatusFilter,
  BankTableRow,
  ExpenseInlineAction,
  ExpenseStatusFilter,
  ExpenseTableRow,
  InvoiceStatusFilter,
  InvoiceTableRow,
  OpenReceivableOption,
  QuoteStatusFilter,
  QuoteTableRow,
} from "@/lib/services/economy-list";
import type { PagedResult } from "@/lib/services/customers";
import { LIST_BODY_ROW_CLASS, LIST_CARD_CLASS, LIST_HEAD_ROW_CLASS, LIST_ROW_LINK_CLASS, LIST_TABLE_CLASS } from "./table-classes";

export { ekonomiRegisterHref };

/**
 * Registerflikarna på Ekonomi: riktiga tabeller med sök, statusfilter och
 * serversidig paginering. Registret är för att HITTA dokument – åtgärds-
 * knapparna bor på Hem/Bokföring och på respektive detaljsida.
 */

export interface EconomyQuery<S extends string> {
  q: string;
  status: S;
  page: number;
  sort: EconomySortState | null;
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

  /** Tillbaka till hela registret: tom sökning, status "alla", första sidan. */
  function clear(allStatus: S) {
    setQ("");
    go({ q: "", status: allStatus, page: 1 });
  }

  return { q, setQ, go, clear, pending };
}

function Toolbar<S extends string>({
  placeholder,
  q,
  setQ,
  status,
  options,
  onStatus,
  sort,
  partyLabel,
  onSort,
}: {
  placeholder: string;
  q: string;
  setQ: (v: string) => void;
  status: S;
  options: readonly [S, string][];
  onStatus: (s: S) => void;
  sort: EconomySortState | null;
  partyLabel: string;
  onSort: (sort: EconomySortState | null) => void;
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
      <div className="flex shrink-0 flex-wrap items-center gap-1">
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
        <MobileSort sort={sort} partyLabel={partyLabel} onSort={onSort} />
      </div>
    </div>
  );
}

function MobileSort({
  sort,
  partyLabel,
  onSort,
}: {
  sort: EconomySortState | null;
  partyLabel: string;
  onSort: (sort: EconomySortState | null) => void;
}) {
  const options = economyMobileSortOptions(partyLabel);
  return (
    <label className="ml-auto flex items-center gap-1.5 text-[12px] font-medium text-muted md:hidden">
      Sortera
      <select
        value={economySortValue(sort)}
        onChange={(e) => onSort(parseEconomySortValue(e.target.value))}
        className="rounded-full border border-line-strong bg-card px-2.5 py-1 text-[12px] font-medium text-soft"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SortTh({
  label,
  sortKey,
  current,
  onSort,
  align,
}: {
  label: string;
  sortKey: EconomySortKey;
  current: EconomySortState | null;
  onSort: (sort: EconomySortState) => void;
  align?: "right";
}) {
  const active = current?.key === sortKey;
  const direction = active ? current.direction : undefined;
  const Icon = active ? (direction === "asc" ? ChevronUp : ChevronDown) : ArrowUpDown;
  return (
    <th
      className="p-0"
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(nextEconomySort(sortKey, current))}
        className={cx(
          "flex w-full cursor-pointer items-center gap-1 px-3 py-2.5 font-medium transition-colors hover:text-ink",
          align === "right" && "justify-end",
          active ? "text-ink" : "text-muted"
        )}
      >
        {label}
        <Icon className="size-3 shrink-0 opacity-60" aria-hidden />
      </button>
    </th>
  );
}

/**
 * Tomt register. Med filter aktivt: ett klick tar bort sök och status så att
 * användaren inte behöver leta efter vad som döljer raderna. Utan filter: den
 * naturliga första handlingen ("Ny offert"), inte bara en förklaring.
 */
function NoMatches({
  icon,
  filtered,
  title,
  text,
  action,
  onClear,
}: {
  icon: typeof FileText;
  filtered: boolean;
  title: string;
  text: string;
  action?: React.ReactNode;
  onClear?: () => void;
}) {
  return (
    <EmptyState
      icon={icon}
      title={filtered ? "Inget matchar" : title}
      text={filtered ? "Prova ett annat sökord eller ta bort ett filter." : text}
      action={
        filtered ? (
          onClear ? <ClearFiltersButton onClick={onClear} /> : undefined
        ) : (
          action
        )
      }
    />
  );
}

export function ClearFiltersButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={buttonClasses("secondary", "sm")} onClick={onClick} data-clear-filters>
      Rensa sök och filter
    </button>
  );
}

const thCls = "px-3 py-2.5 font-medium";
const headRowCls = LIST_HEAD_ROW_CLASS;
const bodyRowCls = LIST_BODY_ROW_CLASS;

function DraftRowActions({
  kind,
  id,
}: {
  kind: "quote" | "invoice";
  id: string;
}) {
  const editHref = kind === "quote" ? `/ekonomi/offerter/${id}/redigera` : `/ekonomi/fakturor/${id}/redigera`;
  return (
    <div className="relative z-20 flex items-center justify-end gap-0.5">
      <AppLink
        href={editHref}
        className="inline-flex size-8 items-center justify-center rounded-lg text-soft hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        aria-label="Redigera utkast"
      >
        <Pencil className="size-4" />
      </AppLink>
      <DiscardDraftButton kind={kind} documentId={id} appearance="icon" />
    </div>
  );
}

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
  const { q, setQ, go, clear, pending } = useRegisterNav("offerter", query);
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
        sort={query.sort}
        partyLabel="Kund"
        onSort={(sort) => go({ sort, page: 1 })}
      />
      {result.total === 0 ? (
        <NoMatches
          icon={FileText}
          filtered={filtered}
          title="Inga offerter ännu"
          text="Skapa din första offert – kunden godkänner den direkt i länken."
          onClear={() => clear("alla")}
          action={
            <ButtonLink href="/ekonomi/offerter/ny">
              <Plus className="size-4" /> Ny offert
            </ButtonLink>
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Card className={LIST_CARD_CLASS}>
              <table className={LIST_TABLE_CLASS}>
                <thead>
                  <tr className={headRowCls}>
                    <SortTh label="Offert" sortKey="document" current={query.sort} onSort={(sort) => go({ sort, page: 1 })} />
                    <SortTh label="Kund" sortKey="customer" current={query.sort} onSort={(sort) => go({ sort, page: 1 })} />
                    <SortTh label="Datum" sortKey="date" current={query.sort} onSort={(sort) => go({ sort, page: 1 })} />
                    <SortTh
                      label="Belopp"
                      sortKey="amount"
                      current={query.sort}
                      align="right"
                      onSort={(sort) => go({ sort, page: 1 })}
                    />
                    <th className={thCls}>Status</th>
                    <th className={`${thCls} w-px`}><span className="sr-only">Åtgärder</span></th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.id} className={bodyRowCls}>
                      <td className="px-3 py-2.5">
                        <AppLink href={`/ekonomi/offerter/${r.id}`} className={LIST_ROW_LINK_CLASS}>
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
                      <td className="px-2 py-2.5">
                        {r.isDraft ? <DraftRowActions kind="quote" id={r.id} /> : null}
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
  const { q, setQ, go, clear, pending } = useRegisterNav("fakturor", query);
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
        sort={query.sort}
        partyLabel="Kund"
        onSort={(sort) => go({ sort, page: 1 })}
      />
      {result.total === 0 ? (
        <NoMatches
          icon={ReceiptText}
          filtered={filtered}
          title="Inga fakturor ännu"
          text="Fakturor skapas oftast direkt från ett klart uppdrag – eller manuellt här."
          onClear={() => clear("alla")}
          action={
            <ButtonLink href="/ekonomi/fakturor/ny">
              <Plus className="size-4" /> Ny faktura
            </ButtonLink>
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Card className={LIST_CARD_CLASS}>
              <table className={LIST_TABLE_CLASS}>
                <thead>
                  <tr className={headRowCls}>
                    <SortTh label="Faktura" sortKey="document" current={query.sort} onSort={(sort) => go({ sort, page: 1 })} />
                    <SortTh label="Kund" sortKey="customer" current={query.sort} onSort={(sort) => go({ sort, page: 1 })} />
                    <SortTh
                      label="Förfallodatum"
                      sortKey="date"
                      current={query.sort}
                      onSort={(sort) => go({ sort, page: 1 })}
                    />
                    <SortTh
                      label="Belopp"
                      sortKey="amount"
                      current={query.sort}
                      align="right"
                      onSort={(sort) => go({ sort, page: 1 })}
                    />
                    <th className={thCls}>Status</th>
                    <th className={`${thCls} w-px`}><span className="sr-only">Åtgärder</span></th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.id} className={bodyRowCls}>
                      <td className="px-3 py-2.5">
                        <AppLink href={`/ekonomi/fakturor/${r.id}`} className={LIST_ROW_LINK_CLASS}>
                          <span className="sr-only">Faktura {r.label}</span>
                        </AppLink>
                        <span className="pointer-events-none block truncate font-medium text-ink" data-testid="invoice-list-title">
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
                      <td className="px-2 py-2.5">
                        {r.isDraft ? <DraftRowActions kind="invoice" id={r.id} /> : null}
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
                  <p className="min-w-0 truncate text-[15px] font-medium" data-testid="invoice-list-title">
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

/** Öppnar den sparade kvittofilen (bara när den faktiskt finns). */
function ReceiptFileLink({ receiptId }: { receiptId: string }) {
  return (
    <a
      href={`/api/kvitto/${receiptId}`}
      target="_blank"
      rel="noreferrer"
      className="text-[12px] font-medium text-soft underline-offset-2 hover:text-ink hover:underline"
    >
      Visa kvitto
    </a>
  );
}

/** Raden går att slutföra på plats – samma vägar som Hem (kvitto, kategorifråga). */
function ExpenseInlineActions({ action }: { action: ExpenseInlineAction }) {
  if (action.kind === "receipt") return <UploadReceiptButton expenseId={action.expenseId} label="Lägg till kvitto" />;
  return (
    <div className="space-y-1.5">
      <p className="text-[13px] text-soft">{action.text}</p>
      <ExpenseQuestionButtons expenseId={action.expenseId} options={action.options} />
    </div>
  );
}

/** Ring + ankare för raden en djuplänk (?atgard=…) pekar på. */
const HIGHLIGHT_ROW_CLASS = "ring-2 ring-accent/60 ring-inset bg-accent-soft/40";

export function ExpenseRegister({
  result,
  query,
  options,
  highlightId,
  emptyAction,
}: {
  result: PagedResult<ExpenseTableRow>;
  query: EconomyQuery<ExpenseStatusFilter>;
  options: readonly [ExpenseStatusFilter, string][];
  /** Utgift/leverantörsfaktura som djuplänken pekar på – markeras och scrollas fram. */
  highlightId?: string;
  /** Första steget när registret är tomt – t.ex. koppla banken om den inte är kopplad. */
  emptyAction?: React.ReactNode;
}) {
  const { q, setQ, go, clear, pending } = useRegisterNav("utgifter", query);
  const filtered = Boolean(query.q) || query.status !== "alla";
  const highlighted = highlightId && result.rows.some((r) => r.id === highlightId) ? highlightId : undefined;

  return (
    <div className={cx(pending && "opacity-70")}>
      {highlighted ? <ScrollToId id={`utgift-${highlighted}`} /> : null}
      <Toolbar
        placeholder="Sök leverantör, kategori eller beskrivning..."
        q={q}
        setQ={setQ}
        status={query.status}
        options={options}
        onStatus={(status) => go({ status, page: 1 })}
        sort={query.sort}
        partyLabel="Leverantör"
        onSort={(sort) => go({ sort, page: 1 })}
      />
      {result.total === 0 ? (
        <NoMatches
          icon={ShoppingBag}
          filtered={filtered}
          title="Inga utgifter ännu"
          text="Släpp ett kvitto i rutan ovan – eller koppla banken så dyker kortköpen upp här av sig själva."
          onClear={() => clear("alla")}
          action={emptyAction}
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Card className={LIST_CARD_CLASS}>
              <table className={LIST_TABLE_CLASS}>
                <thead>
                  <tr className={headRowCls}>
                    <SortTh label="Datum" sortKey="date" current={query.sort} onSort={(sort) => go({ sort, page: 1 })} />
                    <SortTh
                      label="Leverantör"
                      sortKey="customer"
                      current={query.sort}
                      onSort={(sort) => go({ sort, page: 1 })}
                    />
                    <th className={thCls}>Kategori</th>
                    <SortTh
                      label="Belopp"
                      sortKey="amount"
                      current={query.sort}
                      align="right"
                      onSort={(sort) => go({ sort, page: 1 })}
                    />
                    <th className={thCls}>Underlag / status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr
                      key={`${r.kind}-${r.id}`}
                      id={r.kind === "utgift" ? `utgift-${r.id}` : `leverantorsfaktura-${r.id}`}
                      className={cx(bodyRowCls, highlighted === r.id && HIGHLIGHT_ROW_CLASS)}
                      data-highlighted={highlighted === r.id ? "1" : undefined}
                    >
                      <td className="px-3 py-2.5 text-soft">{datumKort(r.date)}</td>
                      <td className="max-w-56 px-3 py-2.5">
                        <span className="block truncate font-medium text-ink">{r.supplier}</span>
                        {r.reference ? <span className="block truncate text-[12px] text-muted">{r.reference}</span> : null}
                      </td>
                      <td className="max-w-44 truncate px-3 py-2.5 text-soft">{r.categoryLabel}</td>
                      <td className="px-3 py-2.5 text-right tabular text-ink">{kr(r.amount)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={r.statusTone as BadgeTone}>{r.statusLabel}</Badge>
                          {r.receiptId ? <ReceiptFileLink receiptId={r.receiptId} /> : null}
                          {r.inlineAction ? <ExpenseInlineActions action={r.inlineAction} /> : null}
                          {r.undoable ? <UndoBookingButton expenseId={r.id} /> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
          <div className="space-y-2 md:hidden">
            {result.rows.map((r) => (
              <div
                key={`${r.kind}-${r.id}`}
                id={r.kind === "utgift" ? `utgift-${r.id}-m` : `leverantorsfaktura-${r.id}-m`}
                className={cx("card px-4 py-3", highlighted === r.id && HIGHLIGHT_ROW_CLASS)}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-[15px] font-medium">{r.supplier}</p>
                  <p className="shrink-0 text-[14px] font-semibold tabular">{kr(r.amount)}</p>
                </div>
                <p className="mt-0.5 truncate text-[13px] text-muted">
                  {datumKort(r.date)} · {r.categoryLabel}
                  {r.reference ? ` · ${r.reference}` : ""}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <Badge tone={r.statusTone as BadgeTone}>{r.statusLabel}</Badge>
                  {r.receiptId ? <ReceiptFileLink receiptId={r.receiptId} /> : null}
                  {r.undoable ? <UndoBookingButton expenseId={r.id} /> : null}
                </div>
                {r.inlineAction ? (
                  <div className="mt-2.5">
                    <ExpenseInlineActions action={r.inlineAction} />
                  </div>
                ) : null}
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
  receivables = [],
  highlightId,
}: {
  result: PagedResult<BankTableRow>;
  query: EconomyQuery<BankStatusFilter>;
  options: readonly [BankStatusFilter, string][];
  /** Obetalda fakturor för "Matcha mot faktura". */
  receivables?: OpenReceivableOption[];
  /** Transaktionen som djuplänken (?atgard=bank-<id>) pekar på. */
  highlightId?: string;
}) {
  const { q, setQ, go, clear, pending } = useRegisterNav("bank", query);
  const filtered = Boolean(query.q) || query.status !== "alla";
  const highlighted = highlightId && result.rows.some((r) => r.id === highlightId) ? highlightId : undefined;

  return (
    <div className={cx(pending && "opacity-70")}>
      {highlighted ? <ScrollToId id={`tx-${highlighted}`} /> : null}
      <Toolbar
        placeholder="Sök motpart, beskrivning eller referens..."
        q={q}
        setQ={setQ}
        status={query.status}
        options={options}
        onStatus={(status) => go({ status, page: 1 })}
        sort={query.sort}
        partyLabel="Motpart"
        onSort={(sort) => go({ sort, page: 1 })}
      />
      {result.total === 0 ? (
        <NoMatches
          icon={Landmark}
          filtered={filtered}
          title="Inga transaktioner ännu"
          text="Banken är kopplad – transaktionerna hämtas och visas här så fort de finns."
          onClear={() => clear("alla")}
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Card className={LIST_CARD_CLASS}>
              <table className={LIST_TABLE_CLASS}>
                <thead>
                  <tr className={headRowCls}>
                    <SortTh label="Datum" sortKey="date" current={query.sort} onSort={(sort) => go({ sort, page: 1 })} />
                    <SortTh label="Motpart" sortKey="customer" current={query.sort} onSort={(sort) => go({ sort, page: 1 })} />
                    <th className={thCls}>Beskrivning</th>
                    <SortTh
                      label="Belopp"
                      sortKey="amount"
                      current={query.sort}
                      align="right"
                      onSort={(sort) => go({ sort, page: 1 })}
                    />
                    <th className={thCls}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <BankTableRows
                      key={r.id}
                      row={r}
                      receivables={receivables}
                      highlighted={highlighted === r.id}
                    />
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
          <div className="space-y-2 md:hidden">
            {result.rows.map((r) => (
              <div
                key={r.id}
                id={`tx-${r.id}-m`}
                className={cx("card px-4 py-3", highlighted === r.id && HIGHLIGHT_ROW_CLASS)}
                data-bank-row={r.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-[15px] font-medium">{r.counterpart}</p>
                  <p className={cx("shrink-0 text-[14px] font-semibold tabular", r.amount > 0 && "text-accent-deep")}>
                    {r.amount > 0 ? "+" : ""}
                    {kr(r.amount)}
                  </p>
                </div>
                <p className="mt-0.5 truncate text-[13px] text-muted">
                  {[datumKort(r.date), r.secondary].filter(Boolean).join(" · ")}
                </p>
                <div className="mt-1.5">
                  <Badge tone={r.statusTone as BadgeTone}>{r.statusLabel}</Badge>
                </div>
                {r.action ? (
                  <div className="mt-3 border-t border-line/70 pt-3">
                    <BankRowActions
                      txId={r.id}
                      amount={r.amount}
                      action={r.action}
                      picker={r.picker}
                      receivables={receivables}
                      defaultOpen={highlighted === r.id}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <Pagination result={result} onPage={(page) => go({ page })} />
        </>
      )}
    </div>
  );
}

/**
 * En banktransaktion i tabellen: själva raden och, för obokade transaktioner,
 * en åtgärdsrad direkt under (förslag att bekräfta, matcha mot faktura, lägg
 * till kvitto, svara på kategorifrågan). Ingen rad lämnas utan utväg.
 */
function BankTableRows({
  row: r,
  receivables,
  highlighted,
}: {
  row: BankTableRow;
  receivables: OpenReceivableOption[];
  highlighted: boolean;
}) {
  return (
    <>
      <tr
        id={`tx-${r.id}`}
        className={cx(bodyRowCls, r.action && "border-b-0", highlighted && HIGHLIGHT_ROW_CLASS)}
        data-bank-row={r.id}
      >
        <td className="px-3 py-2.5 text-soft">{datumKort(r.date)}</td>
        <td className="max-w-44 truncate px-3 py-2.5 font-medium text-ink">{r.counterpart}</td>
        <td className="max-w-64 truncate px-3 py-2.5 text-soft">{r.secondary || "—"}</td>
        <td className={cx("px-3 py-2.5 text-right tabular", r.amount > 0 ? "font-medium text-accent-deep" : "text-ink")}>
          {r.amount > 0 ? "+" : ""}
          {kr(r.amount)}
        </td>
        <td className="px-3 py-2.5">
          <Badge tone={r.statusTone as BadgeTone}>{r.statusLabel}</Badge>
        </td>
      </tr>
      {r.action ? (
        <tr className={cx(bodyRowCls, highlighted && HIGHLIGHT_ROW_CLASS)}>
          <td colSpan={5} className="px-3 pb-3 pt-0">
            <div className="ml-[7.5rem] max-w-2xl rounded-2xl bg-canvas/70 px-4 py-3">
              <BankRowActions
                txId={r.id}
                amount={r.amount}
                action={r.action}
                picker={r.picker}
                receivables={receivables}
                defaultOpen={highlighted}
              />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
