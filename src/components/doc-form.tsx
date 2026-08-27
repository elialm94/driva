"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { buttonClasses, Card, cx } from "./ui";
import { docTotals } from "@/lib/calc";
import { kr } from "@/lib/format";
import type { DocLine, LineKind, PaymentPlanPart, RotRut, VatRate } from "@/lib/types";
import { createQuoteAction, updateQuoteAction, createInvoiceAction, updateInvoiceAction } from "@/app/actions";
import { useRouter } from "next/navigation";
import { DateField } from "./date-field";
import { addCustomerOption, CustomerPicker, type CustomerOption } from "./customer-picker";
import { useUnsavedLeave } from "./unsaved-changes";
import { hrefWithNav } from "@/lib/nav";
import { taxReductionDeductionLabel } from "@/lib/tax-reduction-terms";
import { TaxReductionFormPreview, TaxReductionEditorHint, TaxReductionCalcHint } from "./tax-reduction-terms";
import { TaxReductionFields, taxReductionDetailsFromForm, type TaxReductionFormValue } from "./tax-reduction-fields";
import { suggestedServiceDate } from "@/lib/tax-reduction-gaps";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";

const DECIMAL_PARTIAL = /^-?\d*[.,]?\d*$/;
const DECIMAL_PARTIAL_UNSIGNED = /^\d*[.,]?\d*$/;

function parseDecimal(raw: string): number {
  const normalized = raw.trim().replace(",", ".");
  if (normalized === "" || normalized === "-" || normalized === "." || normalized === "-.") return 0;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function formatDecimal(n: number): string {
  return Number.isFinite(n) ? String(n) : "0";
}

/** "02" → "2" when selection-replace failed; keep "0.5", "0,", "10". */
function collapseLeadingZeros(raw: string): string {
  return raw.replace(/^(-?)0+(\d)/, "$1$2");
}

/**
 * Local string draft is the display source of truth while focused.
 * Parent numeric 0 must not rewrite the input mid-edit (that produced "02").
 */
function DecimalInput({
  value,
  onValueChange,
  className,
  allowNegative = false,
  "aria-label": ariaLabel,
}: {
  value: number;
  onValueChange: (n: number) => void;
  className?: string;
  allowNegative?: boolean;
  "aria-label"?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() => formatDecimal(value));
  const selectOnMouseUp = useRef(false);
  const pattern = allowNegative ? DECIMAL_PARTIAL : DECIMAL_PARTIAL_UNSIGNED;

  useEffect(() => {
    if (!focused) setText(formatDecimal(value));
  }, [value, focused]);

  function clamp(n: number) {
    return allowNegative ? n : Math.max(0, n);
  }

  function commitText(raw: string) {
    const next = collapseLeadingZeros(raw);
    if (!pattern.test(next)) return;
    setText(next);
    onValueChange(clamp(parseDecimal(next)));
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      aria-label={ariaLabel}
      value={text}
      className={className}
      onFocus={(e) => {
        setFocused(true);
        selectOnMouseUp.current = true;
        e.currentTarget.select();
      }}
      onMouseUp={(e) => {
        if (!selectOnMouseUp.current) return;
        selectOnMouseUp.current = false;
        e.preventDefault();
        e.currentTarget.select();
      }}
      onChange={(e) => commitText(e.target.value)}
      onBlur={() => {
        const next = clamp(parseDecimal(text));
        onValueChange(next);
        setText(formatDecimal(next));
        setFocused(false);
      }}
    />
  );
}

export type { CustomerOption };

function newLine(kind: LineKind = "arbete", vatRate: VatRate = 25): DocLine {
  return {
    id: crypto.randomUUID(),
    kind,
    description: "",
    qty: 1,
    unit: kind === "arbete" ? "tim" : "st",
    unitPrice: 0,
    vatRate,
  };
}

function LinesEditor({
  lines,
  onChange,
  defaultVatRate = 25,
}: {
  lines: DocLine[];
  onChange: (lines: DocLine[]) => void;
  defaultVatRate?: VatRate;
}) {
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
          <DecimalInput
            value={line.qty}
            onValueChange={(qty) => update(line.id, { qty })}
            className={inputCls}
            aria-label="Antal"
          />
          <input value={line.unit} onChange={(e) => update(line.id, { unit: e.target.value })} className={inputCls} />
          <DecimalInput
            value={line.unitPrice}
            onValueChange={(unitPrice) => update(line.id, { unitPrice })}
            className={inputCls}
            allowNegative
            aria-label="À-pris exkl."
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
            {/* V1: endast 0/6/12/25. Omvänd skattskyldighet, EU och export stöds inte. */}
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
        <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => onChange([...lines, newLine("arbete", defaultVatRate)])}>
          <Plus className="size-3.5" /> Arbete
        </button>
        <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => onChange([...lines, newLine("material", defaultVatRate)])}>
          <Plus className="size-3.5" /> Material
        </button>
      </div>
    </div>
  );
}

function TotalsPanel({
  lines,
  rot,
  toPayLabel = "Att betala",
}: {
  lines: DocLine[];
  rot: RotRut | null;
  toPayLabel?: string;
}) {
  const t = useMemo(
    () =>
      docTotals(
        lines.map((l) => ({
          ...l,
          qty: Number.isFinite(l.qty) ? l.qty : 0,
          unitPrice: Number.isFinite(l.unitPrice) ? l.unitPrice : 0,
        })),
        rot
      ),
    [lines, rot]
  );
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
        <>
          <div className="flex justify-between text-soft">
            <span>Arbetskostnad inkl. moms</span>
            <span className="tabular">{kr(t.laborInclVat)}</span>
          </div>
          <div className="flex justify-between text-accent-deep">
            <span>{taxReductionDeductionLabel(rot.type)}</span>
            <span className="tabular">−{kr(t.deduction)}</span>
          </div>
        </>
      ) : null}
      <div className="flex justify-between border-t border-line pt-2 text-[16px] font-semibold">
        <span>{toPayLabel}</span>
        <span className="tabular">{kr(t.toPay)}</span>
      </div>
      {rot ? <TaxReductionCalcHint type={rot.type} laborInclVat={t.laborInclVat} /> : null}
    </div>
  );
}

const PLAN_PRESETS: { label: string; plan: PaymentPlanPart[] }[] = [
  { label: "Allt när arbetet är klart", plan: [{ label: "Betalning när arbetet är klart", percent: 100 }] },
  {
    label: "30 % vid start",
    plan: [
      { label: "Vid arbetets start", percent: 30 },
      { label: "När arbetet är klart och godkänt", percent: 70 },
    ],
  },
  {
    label: "50 / 50",
    plan: [
      { label: "Vid arbetets start", percent: 50 },
      { label: "När arbetet är klart och godkänt", percent: 50 },
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
  jobId,
  quoteId,
  initial,
  defaults,
  cancelHref,
  returnTo,
  returnLabel,
}: {
  customers: CustomerOption[];
  defaultCustomerId?: string;
  requestId?: string;
  jobId?: string;
  /** Sätt vid redigering av befintlig offert. */
  quoteId?: string;
  initial?: QuoteFormInitial;
  defaults: { paymentTermsDays: number; lateInterestRate: number; validUntil: string; terms: string; defaultVatRate?: VatRate };
  cancelHref: string;
  returnTo?: string;
  returnLabel?: string;
}) {
  const router = useRouter();
  const [customerOptions, setCustomerOptions] = useState(customers);
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? customers[0]?.id ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [intro, setIntro] = useState(initial?.intro ?? "");
  const vat = defaults.defaultVatRate ?? 25;
  const [lines, setLines] = useState<DocLine[]>(
    initial?.lines?.length ? initial.lines : [newLine("arbete", vat), newLine("material", vat)]
  );
  const [rot, setRot] = useState<RotRut | null>(initial?.rot ?? null);
  const [plan, setPlan] = useState<PaymentPlanPart[]>(initial?.paymentPlan ?? PLAN_PRESETS[0].plan);
  const [termsDays, setTermsDays] = useState(initial?.paymentTermsDays ?? defaults.paymentTermsDays);
  const [lateInterest, setLateInterest] = useState(initial?.lateInterestRate ?? defaults.lateInterestRate);
  const [validUntil, setValidUntil] = useState((initial?.validUntil ?? defaults.validUntil).slice(0, 10));
  const [terms, setTerms] = useState(initial?.terms ?? defaults.terms);
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const snapshot = JSON.stringify({ customerId, title, intro, lines, rot, plan, termsDays, lateInterest, validUntil, terms });
  const initialSnapshot = useRef(snapshot);
  const dirty = snapshot !== initialSnapshot.current;
  const { confirmLeave, dialog } = useUnsavedLeave(dirty && !saving);

  const planTotal = plan.reduce((s, p) => s + p.percent, 0);
  const valid = customerId && title.trim() && lines.length > 0 && planTotal === 100;
  const nav = { returnTo, returnLabel };

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
    setSaving(true);
    startTransition(async () => {
      if (quoteId) {
        await updateQuoteAction(quoteId, payload);
        router.push(hrefWithNav(`/ekonomi/offerter/${quoteId}`, nav) as never);
      } else {
        await createQuoteAction({ ...payload, customerId, requestId, jobId }, nav);
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
              {quoteId || jobId ? (
                <select value={customerId} className={inputCls} disabled>
                  {customerOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <CustomerPicker
                  customers={customerOptions}
                  value={customerId}
                  onChange={setCustomerId}
                  onCreated={(customer) => setCustomerOptions((prev) => addCustomerOption(prev, customer))}
                />
              )}
            </div>
            <div>
              <label className={labelCls}>Rubrik</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="T.ex. Köksrenovering" className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Beskrivning av arbetet</label>
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
          <LinesEditor lines={lines} onChange={setLines} defaultVatRate={vat} />
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
            {rot ? <TaxReductionFormPreview type={rot.type} /> : null}
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
              <DateField value={validUntil} onChange={setValidUntil} className={inputCls} />
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
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
              Egna villkor. ROT/RUT-villkor läggs till automatiskt när skattereduktion är vald och hamnar inte i det
              här fältet.
            </p>
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
          <button
            type="button"
            className={cx(buttonClasses("ghost"), "mt-2 w-full")}
            disabled={isPending}
            onClick={() => confirmLeave(cancelHref)}
          >
            Avbryt
          </button>
          <p className="mt-3 text-center text-[12px] leading-relaxed text-muted">
            Inget skickas ännu. Utkastet visas som offerten, och du bekräftar när du skickar.
          </p>
        </Card>
        {dialog}
      </div>
    </div>
  );
}

export interface InvoiceFormInitial {
  lines: DocLine[];
  rot: RotRut | null;
  dueInDays: number;
  lateInterestRate?: number;
  serviceDate?: string;
  taxReduction?: TaxReductionFormValue;
}

const emptyTaxFields = (): TaxReductionFormValue => ({
  personalIdentityNumber: "",
  workAddress: "",
  workPeriodStart: "",
  workPeriodEnd: "",
  housing: {},
});

export function InvoiceForm({
  customers,
  defaultCustomerId,
  defaultLateInterestRate = 10,
  defaultPaymentTermsDays = 30,
  defaultVatRate = 25,
  invoiceId,
  jobId,
  quoteId,
  rotByCustomer,
  initial,
  cancelHref,
  returnTo,
  returnLabel,
}: {
  customers: CustomerOption[];
  defaultCustomerId?: string;
  defaultLateInterestRate?: number;
  defaultPaymentTermsDays?: number;
  defaultVatRate?: VatRate;
  invoiceId?: string;
  jobId?: string;
  quoteId?: string;
  rotByCustomer?: Record<string, { personalIdentityNumber?: string; addressLine?: string }>;
  initial?: InvoiceFormInitial;
  cancelHref: string;
  returnTo?: string;
  returnLabel?: string;
}) {
  const [customerOptions, setCustomerOptions] = useState(customers);
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? customers[0]?.id ?? "");
  const [lines, setLines] = useState<DocLine[]>(
    initial?.lines?.length ? initial.lines : [newLine("arbete", defaultVatRate)]
  );
  const [rot, setRot] = useState<RotRut | null>(initial?.rot ?? null);
  const [dueDays, setDueDays] = useState(initial?.dueInDays ?? defaultPaymentTermsDays);
  const [lateInterest, setLateInterest] = useState(initial?.lateInterestRate ?? defaultLateInterestRate);
  const [serviceDate, setServiceDate] = useState((initial?.serviceDate ?? "").slice(0, 10));
  const [taxFields, setTaxFields] = useState<TaxReductionFormValue>(initial?.taxReduction ?? emptyTaxFields());
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const snapshot = JSON.stringify({ customerId, lines, rot, dueDays, lateInterest, serviceDate, taxFields });
  const initialSnapshot = useRef(snapshot);
  const dirty = snapshot !== initialSnapshot.current;
  const { confirmLeave, dialog } = useUnsavedLeave(dirty && !saving);

  const valid = customerId && lines.length > 0 && lines.every((l) => l.description.trim());
  const nav = { returnTo, returnLabel };

  function applyCustomerRot(id: string) {
    const row = rotByCustomer?.[id];
    setTaxFields((prev) => ({
      ...prev,
      personalIdentityNumber: row?.personalIdentityNumber ?? prev.personalIdentityNumber,
      workAddress: prev.workAddress || row?.addressLine || "",
    }));
  }

  function syncServiceFromPeriod(fields: TaxReductionFormValue) {
    const suggested = suggestedServiceDate(fields);
    if (suggested) setServiceDate(suggested);
  }

  function setTaxFieldsAndDates(next: TaxReductionFormValue) {
    setTaxFields(next);
    if (rot) syncServiceFromPeriod(next);
  }

  const rotLiveTotals = useMemo(
    () =>
      rot
        ? docTotals(
            lines.map((l) => ({
              ...l,
              qty: Number.isFinite(l.qty) ? l.qty : 0,
              unitPrice: Number.isFinite(l.unitPrice) ? l.unitPrice : 0,
            })),
            rot
          )
        : null,
    [lines, rot]
  );

  function submit() {
    if (!valid) return;
    setSaving(true);
    const taxPayload = rot
      ? {
          taxReductionDetails: taxReductionDetailsFromForm(taxFields),
          personalIdentityNumber: taxFields.personalIdentityNumber || undefined,
        }
      : { taxReductionDetails: null as null, personalIdentityNumber: undefined };
    startTransition(async () => {
      if (invoiceId) {
        await updateInvoiceAction(
          invoiceId,
          {
            lines,
            rot,
            dueInDays: dueDays,
            lateInterestRate: lateInterest,
            serviceDate: serviceDate || null,
            ...taxPayload,
          },
          nav
        );
      } else {
        await createInvoiceAction(
          {
            customerId,
            jobId,
            quoteId,
            type: "faktura",
            lines,
            rot,
            dueInDays: dueDays,
            lateInterestRate: lateInterest,
            serviceDate: serviceDate || undefined,
            ...taxPayload,
          },
          nav
        );
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
              {invoiceId ? (
                <select value={customerId} className={inputCls} disabled>
                  {customerOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <CustomerPicker
                  customers={customerOptions}
                  value={customerId}
                  onChange={(id) => {
                    setCustomerId(id);
                    if (!jobId) applyCustomerRot(id);
                  }}
                  onCreated={(customer) => setCustomerOptions((prev) => addCustomerOption(prev, customer))}
                />
              )}
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
            {rot ? null : (
              <div>
                <label className={labelCls}>Utförandedatum (valfritt)</label>
                <DateField value={serviceDate} onChange={setServiceDate} className={inputCls} />
                <p className="mt-1 text-[12px] text-muted">Visas på fakturan om det skiljer sig från fakturadatum.</p>
              </div>
            )}
          </div>
        </Card>
        <Card className="p-6">
          <p className="mb-4 text-[15px] font-semibold">Fakturarader</p>
          <LinesEditor lines={lines} onChange={setLines} defaultVatRate={defaultVatRate} />
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
                  onClick={() => {
                    const next = value ? { type: value } : null;
                    setRot(next);
                    if (value && customerId) applyCustomerRot(customerId);
                    if (value) syncServiceFromPeriod(taxFields);
                  }}
                  className={cx(
                    "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
                    (rot?.type ?? null) === value ? "border-ink bg-ink text-white" : "border-line-strong text-soft hover:border-muted"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {rot && rotLiveTotals ? (
              <div className="mt-3 space-y-1 text-[13px]">
                <div className="flex justify-between text-soft">
                  <span>Arbetskostnad</span>
                  <span className="tabular">{kr(rotLiveTotals.laborInclVat)}</span>
                </div>
                <div className="flex justify-between text-accent-deep">
                  <span>{taxReductionDeductionLabel(rot.type)}</span>
                  <span className="tabular">−{kr(rotLiveTotals.deduction)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Att betala</span>
                  <span className="tabular">{kr(rotLiveTotals.toPay)}</span>
                </div>
                <TaxReductionEditorHint />
              </div>
            ) : null}
            {rot ? (
              <TaxReductionFields key={rot.type} type={rot.type} value={taxFields} onChange={setTaxFieldsAndDates} />
            ) : null}
          </div>
        </Card>
      </div>
      <div className="lg:sticky lg:top-8 lg:self-start">
        <Card className="p-5">
          <p className="mb-3 text-[15px] font-semibold">Summering</p>
          <TotalsPanel lines={lines} rot={rot} toPayLabel="Att betala nu" />
          <button className={cx(buttonClasses("primary"), "mt-5 w-full")} disabled={!valid || isPending} onClick={submit}>
            {isPending ? "Sparar …" : invoiceId ? "Spara ändringar" : "Spara utkast"}
          </button>
          <button
            type="button"
            className={cx(buttonClasses("ghost"), "mt-2 w-full")}
            disabled={isPending}
            onClick={() => confirmLeave(cancelHref)}
          >
            Avbryt
          </button>
          <p className="mt-3 text-center text-[12px] leading-relaxed text-muted">
            {invoiceId
              ? "Nummer tilldelas när du skickar. Koppling till offert är oförändrad."
              : "Utkastet får inget löpnummer förrän du skickar."}
          </p>
        </Card>
        {dialog}
      </div>
    </div>
  );
}
