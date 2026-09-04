"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AppLink, useAppNavigate } from "./app-link";
import { ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ListFilter, Plus, Search, UserRound } from "lucide-react";
import { Avatar, Badge, buttonClasses, Card, EmptyState, cx } from "./ui";
import { actionMenuItemClassName, useActionMenu, type ActionAppearance } from "./action-menu";
import { NewCustomerModal } from "./new-customer-modal";
import { kr } from "@/lib/format";
import { LIST_BODY_ROW_CLASS, LIST_CARD_CLASS, LIST_HEAD_ROW_CLASS, LIST_ROW_LINK_CLASS, LIST_TABLE_CLASS } from "./table-classes";
import type {
  CustomerActivityFilter,
  CustomerKindFilter,
  CustomerPaymentFilter,
  CustomerSort,
  CustomerTableRow,
  PagedResult,
} from "@/lib/services/customers";

export function NewCustomerButton({
  full = false,
  variant = "primary",
  appearance = "button",
}: {
  full?: boolean;
  variant?: "primary" | "secondary";
  appearance?: ActionAppearance;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useAppNavigate();
  const menu = useActionMenu();
  const inMenu = appearance === "menu";

  return (
    <>
      <button
        type="button"
        role={inMenu ? "menuitem" : undefined}
        aria-label="Ny kund"
        className={inMenu ? actionMenuItemClassName() : buttonClasses(variant, full ? "md" : "md")}
        onClick={() => {
          menu?.close();
          setOpen(true);
        }}
      >
        <Plus className="size-4 shrink-0" /> Ny kund
      </button>
      <NewCustomerModal
        open={open}
        onClose={() => setOpen(false)}
        onCreated={({ id }) => navigate(`/kunder/${id}`)}
      />
    </>
  );
}

export interface CustomerRegisterQuery {
  q: string;
  kind: CustomerKindFilter;
  activity: CustomerActivityFilter;
  payment: CustomerPaymentFilter;
  sort: CustomerSort;
  page: number;
}

/** Registrets egna sök-/filter-/sid-URL:er. `/kunder` är bara kundregistret – ingen flik längre. */
export function kunderRegisterHref(query: Partial<CustomerRegisterQuery>): string {
  const sp = new URLSearchParams();
  if (query.q) sp.set("q", query.q);
  if (query.kind && query.kind !== "alla") sp.set("typ", query.kind);
  if (query.activity && query.activity !== "alla") sp.set("aktivitet", query.activity);
  if (query.payment && query.payment !== "alla") sp.set("betalning", query.payment);
  if (query.sort && query.sort !== "aktivitet") sp.set("sortering", query.sort);
  if (query.page && query.page > 1) sp.set("sida", String(query.page));
  const qs = sp.toString();
  return qs ? `/kunder?${qs}` : "/kunder";
}

export function CustomerRegister({
  result,
  query,
}: {
  result: PagedResult<CustomerTableRow>;
  query: CustomerRegisterQuery;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(query.q);

  useEffect(() => {
    setQ(query.q);
  }, [query.q]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (q === query.q) return;
      startTransition(() => router.replace(kunderRegisterHref({ ...query, q, page: 1 }), { scroll: false }));
    }, 200);
    return () => clearTimeout(handle);
  }, [q, query, router]);

  function go(patch: Partial<CustomerRegisterQuery>) {
    startTransition(() => router.replace(kunderRegisterHref({ ...query, ...patch }), { scroll: false }));
  }

  const filterCount = [query.kind !== "alla", query.activity !== "alla", query.payment !== "alla"].filter(Boolean).length;

  return (
    <div className={cx(pending && "opacity-70")}>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Sök kund, företag, e-post eller telefon..."
            className="w-full rounded-2xl border border-line bg-card py-2.5 pl-10 pr-4 text-[15px] shadow-card placeholder:text-muted focus:border-accent"
          />
        </div>
        <FilterMenu query={query} filterCount={filterCount} onChange={go} />
      </div>

      {result.total === 0 ? (
        <EmptyState
          icon={UserRound}
          title={query.q || filterCount ? "Inga kunder matchar" : "Inga kunder ännu"}
          text={
            query.q || filterCount
              ? "Prova ett annat sökord eller ta bort ett filter."
              : "Lägg till din första kund så håller Driva ordning på allt kring den."
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Card className={LIST_CARD_CLASS}>
              <table className={LIST_TABLE_CLASS}>
                <thead>
                  <tr className={LIST_HEAD_ROW_CLASS}>
                    <SortTh
                      label="Kund"
                      active={query.sort === "namn"}
                      direction="asc"
                      onClick={() => go({ sort: query.sort === "namn" ? "aktivitet" : "namn", page: 1 })}
                    />
                    <th className="px-3 py-2.5 font-medium">Kontakt</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Uppdrag</th>
                    <SortTh
                      label="Att betala"
                      active={query.sort === "attBetala"}
                      direction="desc"
                      align="right"
                      onClick={() => go({ sort: query.sort === "attBetala" ? "aktivitet" : "attBetala", page: 1 })}
                    />
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((c) => (
                    <tr key={c.id} className={LIST_BODY_ROW_CLASS}>
                      <td className="px-3 py-2.5">
                        <AppLink href={`/kunder/${c.id}`} className={LIST_ROW_LINK_CLASS} aria-label={c.name}>
                          <span className="sr-only">{c.name}</span>
                        </AppLink>
                        <div className="pointer-events-none flex items-center gap-3">
                          <Avatar name={c.name} size="sm" />
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              <span className="truncate font-medium text-ink">{c.name}</span>
                              {c.kind === "foretag" ? (
                                <Badge tone="neutral" className="px-1.5 py-0 text-[10px]">
                                  Företag
                                </Badge>
                              ) : null}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="pointer-events-none px-3 py-2.5">
                        <span className="block truncate text-soft">{c.email}</span>
                        {c.contactPerson ? (
                          <span className="block truncate text-[12px] text-muted">{c.contactPerson}</span>
                        ) : null}
                      </td>
                      <td className="pointer-events-none px-3 py-2.5 text-soft">{c.statusLabel}</td>
                      <td className="pointer-events-none px-3 py-2.5 text-soft">
                        {c.activeJobs === 0 ? "—" : c.activeJobs === 1 ? "1 aktivt" : `${c.activeJobs} aktiva`}
                      </td>
                      <td className={cx("pointer-events-none px-3 py-2.5 text-right tabular", c.overdue ? "text-danger" : "text-ink")}>
                        {c.outstanding > 0 ? kr(c.outstanding) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <div className="space-y-2 md:hidden">
            {result.rows.map((c) => (
              <AppLink
                key={c.id}
                href={`/kunder/${c.id}`}
                className="card flex items-start gap-3 px-4 py-3"
              >
                <Avatar name={c.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="truncate text-[15px] font-medium">{c.name}</p>
                    <p className={cx("shrink-0 text-[13px] tabular", c.overdue ? "text-danger" : "text-soft")}>
                      {c.outstanding > 0 ? kr(c.outstanding) : ""}
                    </p>
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-muted">{c.email}</p>
                  <p className="mt-1 text-[12px] text-soft">
                    {c.activeJobs === 1
                      ? "1 aktivt uppdrag"
                      : c.activeJobs > 1
                        ? `${c.activeJobs} aktiva uppdrag`
                        : c.statusLabel === "—"
                          ? "Inget pågående"
                          : c.statusLabel}
                  </p>
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

function SortTh({
  label,
  active,
  direction,
  align,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  align?: "right";
  onClick: () => void;
}) {
  const Icon = active ? (direction === "asc" ? ChevronUp : ChevronDown) : ArrowUpDown;
  return (
    <th
      className={cx("px-3 py-2.5", align === "right" && "text-right")}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={onClick}
        className={cx(
          "inline-flex cursor-pointer items-center gap-1 font-medium transition-colors hover:text-ink",
          active ? "text-ink" : "text-muted"
        )}
      >
        {label}
        <Icon className="size-3 shrink-0 text-muted" aria-hidden />
      </button>
    </th>
  );
}

function FilterMenu({
  query,
  filterCount,
  onChange,
}: {
  query: CustomerRegisterQuery;
  filterCount: number;
  onChange: (patch: Partial<CustomerRegisterQuery>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button type="button" className={buttonClasses("secondary", "md")} onClick={() => setOpen((v) => !v)}>
        <ListFilter className="size-4" />
        Filter
        {filterCount > 0 ? (
          <span className="rounded-full bg-ink/8 px-1.5 text-[11px] font-medium tabular text-soft">{filterCount}</span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-[min(100vw-2rem,18rem)] rounded-2xl border border-line bg-card p-4 shadow-pop">
          <FilterGroup
            label="Typ"
            value={query.kind}
            options={[
              ["alla", "Alla"],
              ["privat", "Privat"],
              ["foretag", "Företag"],
            ]}
            onChange={(kind) => onChange({ kind: kind as CustomerKindFilter, page: 1 })}
          />
          <FilterGroup
            label="Aktivitet"
            value={query.activity}
            options={[
              ["alla", "Alla"],
              ["uppdrag", "Aktivt uppdrag"],
              ["ingen", "Inget pågående"],
            ]}
            onChange={(activity) => onChange({ activity: activity as CustomerActivityFilter, page: 1 })}
          />
          <FilterGroup
            label="Betalning"
            value={query.payment}
            options={[
              ["alla", "Alla"],
              ["obetalt", "Att betala"],
              ["forsenad", "Förfallen faktura"],
            ]}
            onChange={(payment) => onChange({ payment: payment as CustomerPaymentFilter, page: 1 })}
          />
          <FilterGroup
            label="Sortering"
            value={query.sort}
            options={[
              ["aktivitet", "Senast aktivitet"],
              ["namn", "Kund"],
              ["attBetala", "Att betala"],
            ]}
            onChange={(sort) => onChange({ sort: sort as CustomerSort, page: 1 })}
          />
        </div>
      ) : null}
    </div>
  );
}

function FilterGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1.5 text-[12px] font-medium text-muted">{label}</p>
      <div className="flex flex-wrap gap-1">
        {options.map(([key, name]) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={cx(
              "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
              value === key ? "border-ink bg-ink text-white" : "border-line-strong text-soft hover:border-muted"
            )}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Pagination({
  result,
  onPage,
}: {
  result: PagedResult<unknown>;
  onPage: (page: number) => void;
}) {
  if (result.total <= result.pageSize) return null;
  const from = (result.page - 1) * result.pageSize + 1;
  const to = Math.min(result.page * result.pageSize, result.total);
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-[13px] text-muted">
      <p className="tabular">
        {from}–{to} av {result.total}
      </p>
      <div className="flex gap-1">
        <button
          type="button"
          className={buttonClasses("secondary", "sm")}
          disabled={result.page <= 1}
          onClick={() => onPage(result.page - 1)}
        >
          <ChevronLeft className="size-3.5" /> Föregående
        </button>
        <button
          type="button"
          className={buttonClasses("secondary", "sm")}
          disabled={result.page >= result.totalPages}
          onClick={() => onPage(result.page + 1)}
        >
          Nästa <ChevronRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
