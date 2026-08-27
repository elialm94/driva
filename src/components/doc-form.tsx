"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { ChevronDown, Plus, Search, Trash2 } from "lucide-react";
import { buttonClasses, Card, cx } from "./ui";
import { docTotals } from "@/lib/calc";
import { kr } from "@/lib/format";
import type { DocLine, LineKind, PaymentPlanPart, RotRut, VatRate } from "@/lib/types";
import { createQuoteAction, updateQuoteAction, createInvoiceAction, updateInvoiceAction } from "@/app/actions";
import { useRouter } from "next/navigation";
import { NewCustomerModal, type CreatedCustomer } from "./new-customer-modal";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";

export interface CustomerOption {
  id: string;
  name: string;
  kind: "privat" | "foretag";
}

function QuoteCustomerSelect({
  customers,
  value,
  onChange,
  onCreateNew,
}: {
  customers: CustomerOption[];
  value: string;
  onChange: (id: string) => void;
  onCreateNew: () => void;
}) {
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const selected = customers.find((c) => c.id === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q));
  }, [customers, query]);

  const optionCount = filtered.length + 1;

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function openMenu() {
    const selectedIndex = customers.findIndex((c) => c.id === value);
    setHighlight(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function pick(id: string) {
    onChange(id);
    close();
  }

  function create() {
    close();
    onCreateNew();
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, optionCount - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlight >= filtered.length) create();
      else if (filtered[highlight]) pick(filtered[highlight].id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        className={cx(inputCls, "flex items-center justify-between gap-2 text-left")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        role="combobox"
      >
        <span className={selected ? "truncate" : "truncate text-muted"}>{selected?.name ?? "Välj kund"}</span>
        <ChevronDown className={cx("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="absolute inset-x-0 top-full z-20 mt-1.5 flex max-h-80 flex-col overflow-hidden rounded-xl border border-line bg-card shadow-pop animate-fade-in">
          <div className="relative border-b border-line">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Sök kund …"
              className="w-full bg-transparent py-2.5 pl-10 pr-3.5 text-[14px] text-ink placeholder:text-muted"
              autoComplete="off"
              aria-autocomplete="list"
            />
          </div>
          <ul id={listId} role="listbox" className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3.5 py-2.5 text-[13px] text-muted">
                {query.trim() ? `Ingen kund matchar ”${query.trim()}”` : "Inga kunder ännu"}
              </li>
            ) : (
              filtered.map((c, i) => (
                <li key={c.id} role="option" aria-selected={c.id === value}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(c.id)}
                    onMouseEnter={() => setHighlight(i)}
                    className={cx(
                      "flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-[14px] transition-colors",
                      i === highlight ? "bg-canvas" : "bg-card"
                    )}
                  >
                    <span className="min-w-0 truncate font-medium text-ink">{c.name}</span>
                    {c.kind === "foretag" ? <span className="shrink-0 text-[12px] text-muted">Företag</span> : null}
                  </button>
                </li>
              ))
            )}
          </ul>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={create}
            onMouseEnter={() => setHighlight(filtered.length)}
            className={cx(
              "flex w-full items-center gap-2 border-t border-line px-3.5 py-2.5 text-left text-[14px] font-medium text-accent transition-colors",
              highlight === filtered.length ? "bg-accent-soft" : "bg-canvas/60 hover:bg-accent-soft"
            )}
          >
            <Plus className="size-4" /> Skapa ny kund
          </button>
        </div>
      ) : null}
    </div>
  );
}

function newLine(kind: LineKind = "arbete"): DocLine {
  return {
    id: crypto.randomUUID(),
    kind,
    description: "",
    qty: 1,
    unit: kind === "arbete" ? "tim" : "st",
    unitPrice: 0,
    vatRate: 25,
  };
}

function LinesEditor({ lines, onChange }: { lines: DocLine[]; onChange: (lines: DocLine[]) => void }) {
  function update(id: string, patch: Partial<DocLine>) {
    onChange(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  return (
    <div className="space-y-2.5">
      <div className="hidden grid-cols-[110px_1fr_64px_64px_110px_84px_32px] gap-2 text-[12px] font-medium uppercase tracking-wide text-muted sm:grid">
        <span>Typ</span>
        <span>Beskrivning</span>
        <span>Antal</span>
        <span>Enhet</span>
        <span>À-pris exkl.</span>
        <span>Moms</span>
        <span />
      </div>
      {lines.map((line) => (
        <div key={line.id} className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-canvas/40 p-3 sm:grid-cols-[110px_1fr_64px_64px_110px_84px_32px] sm:border-0 sm:bg-transparent sm:p-0">
          <select
            value={line.kind}
            onChange={(e) => {
              const kind = e.target.value as LineKind;
              update(line.id, { kind, unit: kind === "arbete" ? "tim" : line.unit === "tim" ? "st" : line.unit });
            }}
            className={inputCls}
          >
            <option value="arbete">Arbete</option>
            <option value="material">Material</option>
            <option value="ovrigt">Övrigt</option>
          </select>
          <input
            value={line.description}
            onChange={(e) => update(line.id, { description: e.target.value })}
            placeholder="Vad ingår? (rabatt läggs som rad med minusbelopp)"
            className={cx(inputCls, "col-span-2 sm:col-span-1")}
          />
          <input
            type="number"
            value={line.qty}
            min={0}
            onChange={(e) => update(line.id, { qty: Number(e.target.value) })}
            className={inputCls}
          />
          <input value={line.unit} onChange={(e) => update(line.id, { unit: e.target.value })} className={inputCls} />
          <input
            type="number"
            value={line.unitPrice}
            onChange={(e) => update(line.id, { unitPrice: Number(e.target.value) })}
            className={inputCls}
          />
          <select
            value={line.vatRate}
            onChange={(e) => update(line.id, { vatRate: Number(e.target.value) as VatRate })}
            className={inputCls}
          >
            <option value={25}>25 %</option>
            <option value={12}>12 %</option>
            <option value={6}>6 %</option>
            <option value={0}>0 %</option>
          </select>
          <button
            type="button"
            onClick={() => onChange(lines.filter((l) => l.id !== line.id))}
            className="flex items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger-soft hover:text-danger"
            title="Ta bort rad"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => onChange([...lines, newLine("arbete")])}>
          <Plus className="size-3.5" /> Arbete
        </button>
        <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => onChange([...lines, newLine("material")])}>
          <Plus className="size-3.5" /> Material
        </button>
      </div>
    </div>
  );
}

function TotalsPanel({ lines, rot }: { lines: DocLine[]; rot: RotRut | null }) {
  const t = useMemo(() => docTotals(lines, rot), [lines, rot]);
  return (
    <div className="space-y-1.5 text-[14px]">
      <div className="flex justify-between text-soft">
        <span>Exkl. moms</span>
        <span className="tabular">{kr(t.subtotal)}</span>
      </div>
      <div className="flex justify-between text-soft">
        <span>Moms</span>
        <span className="tabular">{kr(t.vat)}</span>
      </div>
      <div className="flex justify-between font-medium">
        <span>Totalt</span>
        <span className="tabular">{kr(t.total)}</span>
      </div>
      {rot ? (
        <div className="flex justify-between text-accent-deep">
          <span>{rot.type === "rot" ? "ROT-avdrag" : "RUT-avdrag"}</span>
          <span className="tabular">−{kr(t.deduction)}</span>
        </div>
      ) : null}
      <div className="flex justify-between border-t border-line pt-2 text-[16px] font-semibold">
        <span>Att betala</span>
        <span className="tabular">{kr(t.toPay)}</span>
      </div>
    </div>
  );
}

const PLAN_PRESETS: { label: string; plan: PaymentPlanPart[] }[] = [
  { label: "Allt när jobbet är klart", plan: [{ label: "Betalning när arbetet är klart", percent: 100 }] },
  {
    label: "30 % vid start",
    plan: [
      { label: "Vid arbetets start", percent: 30 },
      { label: "När jobbet är klart och godkänt", percent: 70 },
    ],
  },
  {
    label: "50 / 50",
    plan: [
      { label: "Vid arbetets start", percent: 50 },
      { label: "När jobbet är klart och godkänt", percent: 50 },
    ],
  },
];

export interface QuoteFormInitial {
  title: string;
  intro: string;
  lines: DocLine[];
  rot: RotRut | null;
  paymentPlan: PaymentPlanPart[];
  paymentTermsDays: number;
  lateInterestRate?: number;
  validUntil: string;
  terms: string;
}

export function QuoteForm({
  customers,
  defaultCustomerId,
  requestId,
  quoteId,
  initial,
  defaults,
}: {
  customers: CustomerOption[];
  defaultCustomerId?: string;
  requestId?: string;
  /** Sätt vid redigering av befintlig offert. */
  quoteId?: string;
  initial?: QuoteFormInitial;
  defaults: { paymentTermsDays: number; lateInterestRate: number; validUntil: string; terms: string };
}) {
  const router = useRouter();
  const [customerOptions, setCustomerOptions] = useState(customers);
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? customers[0]?.id ?? "");
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [intro, setIntro] = useState(initial?.intro ?? "");
  const [lines, setLines] = useState<DocLine[]>(
    initial?.lines?.length ? initial.lines : [newLine("arbete"), newLine("material")]
  );
  const [rot, setRot] = useState<RotRut | null>(initial?.rot ?? null);
  const [plan, setPlan] = useState<PaymentPlanPart[]>(initial?.paymentPlan ?? PLAN_PRESETS[0].plan);
  const [termsDays, setTermsDays] = useState(initial?.paymentTermsDays ?? defaults.paymentTermsDays);
  const [lateInterest, setLateInterest] = useState(initial?.lateInterestRate ?? defaults.lateInterestRate);
  const [validUntil, setValidUntil] = useState((initial?.validUntil ?? defaults.validUntil).slice(0, 10));
  const [terms, setTerms] = useState(initial?.terms ?? defaults.terms);
  const [isPending, startTransition] = useTransition();

  const planTotal = plan.reduce((s, p) => s + p.percent, 0);
  const valid = customerId && title.trim() && lines.length > 0 && planTotal === 100;

  function submit() {
    if (!valid) return;
    const payload = {
      title: title.trim(),
      intro: intro.trim(),
      lines,
      rot,
      paymentPlan: plan,
      paymentTermsDays: termsDays,
      lateInterestRate: lateInterest,
      validUntil: new Date(validUntil + "T12:00:00").toISOString(),
      terms,
    };
    startTransition(async () => {
      if (quoteId) {
        await updateQuoteAction(quoteId, payload);
        router.push(`/pengar/offerter/${quoteId}`);
      } else {
        await createQuoteAction({ ...payload, customerId, requestId });
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_290px]">
      <div className="space-y-6">
        <Card className="space-y-5 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Kund</label>
              {quoteId ? (
                <select value={customerId} className={inputCls} disabled>
                  {customerOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <QuoteCustomerSelect
                    customers={customerOptions}
                    value={customerId}
                    onChange={setCustomerId}
                    onCreateNew={() => setCreateCustomerOpen(true)}
                  />
                  <NewCustomerModal
                    open={createCustomerOpen}
                    onClose={() => setCreateCustomerOpen(false)}
                    onCreated={(customer: CreatedCustomer) => {
                      setCustomerOptions((prev) => {
                        if (prev.some((c) => c.id === customer.id)) return prev;
                        return [...prev, customer].sort((a, b) => a.name.localeCompare(b.name, "sv"));
                      });
                      setCustomerId(customer.id);
                    }}
                  />
                </>
              )}
            </div>
            <div>
              <label className={labelCls}>Rubrik</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="T.ex. Köksrenovering" className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Beskrivning av jobbet</label>
            <textarea
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              rows={3}
              placeholder="Kort beskrivning som kunden ser överst i offerten …"
              className={inputCls}
            />
          </div>
        </Card>

        <Card className="p-6">
          <p className="mb-4 text-[15px] font-semibold">Prisrader</p>
          <LinesEditor lines={lines} onChange={setLines} />
        </Card>

        <Card className="space-y-5 p-6">
          <div>
            <label className={labelCls}>Skattereduktion</label>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  [null, "Ingen"],
                  ["rot", "ROT (30 % på arbete)"],
                  ["rut", "RUT (50 % på arbete)"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setRot(value ? { type: value } : null)}
                  className={cx(
                    "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
                    (rot?.type ?? null) === value ? "border-ink bg-ink text-white" : "border-line-strong text-soft hover:border-muted"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>Betalningsplan</label>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {PLAN_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setPlan(p.plan)}
                  className={cx(
                    "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
                    JSON.stringify(plan) === JSON.stringify(p.plan)
                      ? "border-ink bg-ink text-white"
                      : "border-line-strong text-soft hover:border-muted"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {plan.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={p.label}
                    onChange={(e) => setPlan(plan.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                    className={cx(inputCls, "flex-1")}
                  />
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={p.percent}
                      min={0}
                      max={100}
                      onChange={(e) => setPlan(plan.map((x, j) => (j === i ? { ...x, percent: Number(e.target.value) } : x)))}
                      className={cx(inputCls, "w-20 text-right")}
                    />
                    <span className="text-[13px] text-muted">%</span>
                  </div>
                </div>
              ))}
              {planTotal !== 100 ? <p className="text-[13px] font-medium text-danger">Delarna måste summera till 100 % (nu {planTotal} %).</p> : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={labelCls}>Giltig till</label>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Betalningsvillkor (dagar)</label>
              <input type="number" value={termsDays} min={1} onChange={(e) => setTermsDays(Number(e.target.value))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Dröjsmålsränta (% per år)</label>
              <input
                type="number"
                value={lateInterest}
                min={0}
                step={0.5}
                onChange={(e) => setLateInterest(Number(e.target.value))}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Villkor</label>
            <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} className={inputCls} />
          </div>
        </Card>
      </div>

      <div className="lg:sticky lg:top-8 lg:self-start">
        <Card className="p-5">
          <p className="mb-3 text-[15px] font-semibold">Summering</p>
          <TotalsPanel lines={lines} rot={rot} />
          <button className={cx(buttonClasses("primary"), "mt-5 w-full")} disabled={!valid || isPending} onClick={submit}>
            {isPending ? "Sparar …" : quoteId ? "Spara ändringar" : "Spara utkast"}
          </button>
          <p className="mt-3 text-center text-[12px] leading-relaxed text-muted">
            Inget skickas ännu – du granskar alltid exakt hur kunden ser offerten innan den går iväg.
          </p>
        </Card>
      </div>
    </div>
  );
}

export interface InvoiceFormInitial {
  lines: DocLine[];
  rot: RotRut | null;
  dueInDays: number;
  lateInterestRate?: number;
}

export function InvoiceForm({
  customers,
  defaultCustomerId,
  defaultLateInterestRate = 10,
  invoiceId,
  initial,
}: {
  customers: CustomerOption[];
  defaultCustomerId?: string;
  defaultLateInterestRate?: number;
  /** Sätt vid redigering av befintligt utkast. */
  invoiceId?: string;
  initial?: InvoiceFormInitial;
}) {
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? customers[0]?.id ?? "");
  const [lines, setLines] = useState<DocLine[]>(initial?.lines?.length ? initial.lines : [newLine("arbete")]);
  const [rot, setRot] = useState<RotRut | null>(initial?.rot ?? null);
  const [dueDays, setDueDays] = useState(initial?.dueInDays ?? 30);
  const [lateInterest, setLateInterest] = useState(initial?.lateInterestRate ?? defaultLateInterestRate);
  const [isPending, startTransition] = useTransition();

  const valid = customerId && lines.length > 0 && lines.every((l) => l.description.trim());

  function submit() {
    if (!valid) return;
    startTransition(async () => {
      if (invoiceId) {
        await updateInvoiceAction(invoiceId, {
          lines,
          rot,
          dueInDays: dueDays,
          lateInterestRate: lateInterest,
        });
      } else {
        await createInvoiceAction({
          customerId,
          type: "faktura",
          lines,
          rot,
          dueInDays: dueDays,
          lateInterestRate: lateInterest,
        });
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_290px]">
      <div className="space-y-6">
        <Card className="space-y-5 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Kund</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputCls} disabled={!!invoiceId}>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Förfaller om (dagar)</label>
                <input type="number" min={1} value={dueDays} onChange={(e) => setDueDays(Number(e.target.value))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Dröjsmålsränta (%)</label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={lateInterest}
                  onChange={(e) => setLateInterest(Number(e.target.value))}
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        </Card>
        <Card className="p-6">
          <p className="mb-4 text-[15px] font-semibold">Fakturarader</p>
          <LinesEditor lines={lines} onChange={setLines} />
          <div className="mt-5">
            <label className={labelCls}>Skattereduktion</label>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  [null, "Ingen"],
                  ["rot", "ROT"],
                  ["rut", "RUT"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setRot(value ? { type: value } : null)}
                  className={cx(
                    "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
                    (rot?.type ?? null) === value ? "border-ink bg-ink text-white" : "border-line-strong text-soft hover:border-muted"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>
      <div className="lg:sticky lg:top-8 lg:self-start">
        <Card className="p-5">
          <p className="mb-3 text-[15px] font-semibold">Summering</p>
          <TotalsPanel lines={lines} rot={rot} />
          <button className={cx(buttonClasses("primary"), "mt-5 w-full")} disabled={!valid || isPending} onClick={submit}>
            {isPending ? "Sparar …" : invoiceId ? "Spara ändringar" : "Spara utkast"}
          </button>
          <p className="mt-3 text-center text-[12px] leading-relaxed text-muted">
            {invoiceId
              ? "Nummer, OCR och koppling till offert är oförändrade. Kunden ser inget förrän du skickar."
              : "Du förhandsgranskar fakturan exakt som kunden ser den innan den skickas."}
          </p>
        </Card>
      </div>
    </div>
  );
}
