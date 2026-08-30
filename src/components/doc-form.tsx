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
import { taxReductionDeductionLabel, taxReductionClampedMessage } from "@/lib/tax-reduction-terms";
import { TaxReductionFormPreview, TaxReductionEditorHint, TaxReductionCalcHint } from "./tax-reduction-terms";
import {
  TaxReductionFields,
  TaxReductionAmountPanel,
  taxReductionDetailsFromForm,
  type InvoicePropertyOption,
  type TaxReductionFormValue,
} from "./tax-reduction-fields";
import { suggestedServiceDate } from "@/lib/tax-reduction-gaps";
import { rotWithAmounts, syncRotWithLines } from "@/lib/tax-reduction-amount";
import {
  invoiceMissingRequirements,
  lineFieldId,
  lineIsBlank,
  lineMissingParts,
  prunedLines,
  quoteMissingRequirements,
} from "@/lib/form-requirements";
import { FieldError, FormValidationSummary, focusField, invalidFieldCls } from "./form-validation";
import { StickyMobileActions } from "./sticky-actions";
import { RichTextEditor } from "./rich-text-editor";
import type { RichTextDoc } from "@/lib/richtext";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";
/** Etikett som bara syns i mobilens radkort – desktop har kolumnrubrikerna. */
const mobileLineLabelCls = "mb-1 block text-[12px] font-medium text-muted sm:hidden";

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
  id,
  invalid,
}: {
  value: number;
  onValueChange: (n: number) => void;
  className?: string;
  allowNegative?: boolean;
  "aria-label"?: string;
  id?: string;
  invalid?: boolean;
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
      id={id}
      aria-invalid={invalid || undefined}
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
        if (next !== value) onValueChange(next);
        setText(formatDecimal(next));
        setFocused(false);
      }}
    />
  );
}

export type { CustomerOption };

/**
 * `stableId` behövs för rader som skapas i useState-initialisatorn: den körs
 * både på servern och i klienten, och ett slumpat id ger olika DOM-id:n
 * (rad-…-beskrivning) → hydration mismatch som React inte lappar ihop.
 */
function newLine(kind: LineKind = "arbete", vatRate: VatRate = 25, stableId?: string): DocLine {
  return {
    id: stableId ?? crypto.randomUUID(),
    kind,
    description: "",
    qty: 1,
    unit: kind === "arbete" ? "tim" : "st",
    unitPrice: 0,
    vatRate,
  };
}

function finiteLines(lines: DocLine[]): DocLine[] {
  return lines.map((l) => ({
    ...l,
    qty: Number.isFinite(l.qty) ? l.qty : 0,
    unitPrice: Number.isFinite(l.unitPrice) ? l.unitPrice : 0,
  }));
}

function rotForEditor(
  type: "rot" | "rut",
  lines: DocLine[],
  current?: RotRut | null,
  kind: "faktura" | "offert" = "faktura"
): RotRut {
  const finite = finiteLines(lines);
  const resolved = rotWithAmounts(
    {
      type,
      appliedTaxReduction: current?.type === type ? current.appliedTaxReduction : undefined,
      taxReductionManuallyAdjusted: current?.type === type ? current.taxReductionManuallyAdjusted : false,
    },
    finite,
    { mode: "clamp", documentKind: kind }
  )!;
  // Tomma rader ger max 0 – behåll ärvt avdrag tills arbetskostnad finns, annars
  // nollställs t.ex. 30 000 kr från offerten och följer inte med till fakturan.
  if (
    resolved.calculatedEligibleTaxReduction === 0 &&
    current?.type === type &&
    current.appliedTaxReduction != null
  ) {
    return {
      type,
      calculatedEligibleTaxReduction: 0,
      appliedTaxReduction: current.appliedTaxReduction,
      taxReductionManuallyAdjusted: Boolean(current.taxReductionManuallyAdjusted),
    };
  }
  return resolved;
}

function LinesEditor({
  lines,
  onChange,
  defaultVatRate = 25,
  showErrors = false,
}: {
  lines: DocLine[];
  onChange: (lines: DocLine[]) => void;
  defaultVatRate?: VatRate;
  /** Efter ett sparförsök: markera ofullständiga rader tills de är ifyllda. */
  showErrors?: boolean;
}) {
  function update(id: string, patch: Partial<DocLine>) {
    onChange(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  // Ingen påbörjad rad alls: peka ut första raden. Påbörjade rader felmarkeras per fält.
  const allBlank = showErrors && lines.every(lineIsBlank);
  return (
    <div id="prisrader" className="space-y-3.5 sm:space-y-2.5">
      <div className="hidden grid-cols-[110px_1fr_64px_64px_110px_84px_32px] gap-2 text-[12px] font-medium uppercase tracking-wide text-muted sm:grid">
        <span>Typ</span>
        <span>Beskrivning</span>
        <span>Antal</span>
        <span>Enhet</span>
        <span>À-pris exkl.</span>
        <span>Moms</span>
        <span />
      </div>
      {lines.map((line, index) => {
        const parts = showErrors ? lineMissingParts(line) : { description: false, price: false };
        const markDescription = parts.description || (allBlank && index === 0);
        const markPrice = parts.price || (allBlank && index === 0);
        const lineTotal =
          (Number.isFinite(line.qty) ? line.qty : 0) * (Number.isFinite(line.unitPrice) ? line.unitPrice : 0);
        return (
        /*
         * Mobil: varje rad är ett tydligt avgränsat kort med synliga etiketter
         * (aldrig en naken nolla vars mening beror på en avlägsen kolumnrubrik).
         * Desktop (sm+): samma tabellgrid som förut – etiketter och kortskal
         * försvinner via sm:hidden/sm:contents så fälten blir grid-celler igen.
         */
        <div key={line.id} className="relative grid grid-cols-2 gap-x-2.5 gap-y-3 rounded-2xl border border-line bg-canvas/40 p-3.5 sm:static sm:grid-cols-[110px_1fr_64px_64px_110px_84px_32px] sm:gap-2 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0">
          <div className="sm:contents">
            <label htmlFor={`rad-${line.id}-typ`} className={mobileLineLabelCls}>
              Typ
            </label>
            <select
              id={`rad-${line.id}-typ`}
              value={line.kind}
              onChange={(e) => {
                const kind = e.target.value as LineKind;
                update(line.id, { kind, unit: kind === "arbete" ? "tim" : line.unit === "tim" ? "st" : line.unit });
              }}
              aria-label="Typ"
              className={inputCls}
            >
              <option value="arbete">Arbete</option>
              <option value="material">Material</option>
              <option value="ovrigt">Övrigt</option>
            </select>
          </div>
          <div className="col-span-2 sm:contents">
            <label htmlFor={lineFieldId(line.id, "beskrivning")} className={mobileLineLabelCls}>
              Beskrivning
            </label>
            <input
              id={lineFieldId(line.id, "beskrivning")}
              value={line.description}
              onChange={(e) => update(line.id, { description: e.target.value })}
              placeholder="Vad ingår? (rabatt läggs som rad med minusbelopp)"
              aria-label="Beskrivning"
              aria-invalid={markDescription || undefined}
              className={cx(inputCls, markDescription && invalidFieldCls)}
            />
          </div>
          <div className="sm:contents">
            <label htmlFor={`rad-${line.id}-antal`} className={mobileLineLabelCls}>
              Antal
            </label>
            <DecimalInput
              id={`rad-${line.id}-antal`}
              value={line.qty}
              onValueChange={(qty) => update(line.id, { qty })}
              className={inputCls}
              aria-label="Antal"
            />
          </div>
          <div className="sm:contents">
            <label htmlFor={`rad-${line.id}-enhet`} className={mobileLineLabelCls}>
              Enhet
            </label>
            <input
              id={`rad-${line.id}-enhet`}
              value={line.unit}
              onChange={(e) => update(line.id, { unit: e.target.value })}
              aria-label="Enhet"
              className={inputCls}
            />
          </div>
          <div className="sm:contents">
            <label htmlFor={lineFieldId(line.id, "pris")} className={mobileLineLabelCls}>
              À-pris exkl. moms
            </label>
            <div className="relative sm:contents">
              <DecimalInput
                id={lineFieldId(line.id, "pris")}
                value={line.unitPrice}
                onValueChange={(unitPrice) => update(line.id, { unitPrice })}
                className={cx(inputCls, "pr-8 sm:pr-3", markPrice && invalidFieldCls)}
                allowNegative
                aria-label="À-pris exkl. moms"
                invalid={markPrice}
              />
              <span
                aria-hidden
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-muted sm:hidden"
              >
                kr
              </span>
            </div>
          </div>
          <div className="sm:contents">
            <label htmlFor={`rad-${line.id}-moms`} className={mobileLineLabelCls}>
              Moms
            </label>
            <select
              id={`rad-${line.id}-moms`}
              value={line.vatRate}
              onChange={(e) => update(line.id, { vatRate: Number(e.target.value) as VatRate })}
              aria-label="Moms"
              className={inputCls}
            >
              <option value={25}>25 %</option>
              <option value={12}>12 %</option>
              <option value={6}>6 %</option>
              <option value={0}>0 %</option>
              {/* V1: endast 0/6/12/25. Omvänd skattskyldighet, EU och export stöds inte. */}
            </select>
          </div>
          <button
            type="button"
            onClick={() => onChange(lines.filter((l) => l.id !== line.id))}
            className="absolute right-1.5 top-1.5 flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger-soft hover:text-danger sm:static sm:size-auto"
            title="Ta bort rad"
            aria-label="Ta bort rad"
          >
            <Trash2 className="size-4" />
          </button>
          <div className="col-span-2 -mb-0.5 flex items-baseline justify-between gap-3 border-t border-line pt-2.5 sm:hidden">
            <span className="text-[13px] text-soft">Summa exkl. moms</span>
            <span className="text-[14px] font-semibold tabular text-ink">{kr(lineTotal)}</span>
          </div>
          {parts.description || parts.price ? (
            <FieldError className="col-span-2 -mt-0.5 sm:col-span-full sm:mt-0">
              {parts.description ? "Beskrivning saknas på raden." : "Pris saknas på raden."}
            </FieldError>
          ) : null}
        </div>
        );
      })}
      {allBlank ? <FieldError>Minst en rad med beskrivning och pris behövs.</FieldError> : null}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          className={buttonClasses("secondary", "sm", "max-sm:h-11 flex-1 sm:flex-none")}
          onClick={() => onChange([...lines, newLine("arbete", defaultVatRate)])}
        >
          <Plus className="size-3.5" /> Arbete
        </button>
        <button
          type="button"
          className={buttonClasses("secondary", "sm", "max-sm:h-11 flex-1 sm:flex-none")}
          onClick={() => onChange([...lines, newLine("material", defaultVatRate)])}
        >
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

/**
 * Mobil spar-rad: primär-CTA alltid inom räckhåll ovanför bottennavet, med
 * kompakt "Att betala" och ev. "N uppgifter saknas". Desktop (lg+) behåller
 * knapparna i sidosummeringen – raden är dold där.
 */
function DocStickyActions({
  toPayLabel,
  toPay,
  missingCount,
  summaryId,
  pending,
  saveLabel,
  onSave,
  onCancel,
}: {
  toPayLabel: string;
  toPay: number;
  missingCount: number;
  summaryId: string;
  pending: boolean;
  saveLabel: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <StickyMobileActions
      summary={
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-[13px] text-soft">{toPayLabel}</span>
          <span className="flex items-baseline gap-3">
            {missingCount > 0 ? (
              <button
                type="button"
                onClick={() => focusField(summaryId)}
                className="text-[12px] font-medium text-warn underline decoration-warn/60 underline-offset-2"
              >
                {missingCount === 1 ? "1 uppgift saknas" : `${missingCount} uppgifter saknas`}
              </button>
            ) : null}
            <span className="text-[15px] font-semibold tabular text-ink">{kr(toPay)}</span>
          </span>
        </div>
      }
    >
      <button
        type="button"
        className={buttonClasses("secondary", "lg", "flex-none px-5")}
        disabled={pending}
        onClick={onCancel}
      >
        Avbryt
      </button>
      <button className={buttonClasses("primary", "lg", "flex-1")} disabled={pending} onClick={onSave}>
        {pending ? "Sparar …" : saveLabel}
      </button>
    </StickyMobileActions>
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
  richText?: RichTextDoc;
}

export function QuoteForm({
  customers,
  defaultCustomerId,
  jobId,
  quoteId,
  lockCustomer,
  initial,
  defaults,
  cancelHref,
  returnTo,
  returnLabel,
  aiEnabled,
}: {
  customers: CustomerOption[];
  defaultCustomerId?: string;
  jobId?: string;
  /** Lås kundväljaren när offerten öppnas från en kund. */
  lockCustomer?: boolean;
  /** Sätt vid redigering av befintlig offert. */
  quoteId?: string;
  initial?: QuoteFormInitial;
  defaults: { paymentTermsDays: number; lateInterestRate: number; validUntil: string; terms: string; defaultVatRate?: VatRate };
  cancelHref: string;
  returnTo?: string;
  returnLabel?: string;
  /** isAiConfigured() från serversidan – styr "Förbättra med AI" i rik text-fältet. */
  aiEnabled?: boolean;
}) {
  const router = useRouter();
  const [customerOptions, setCustomerOptions] = useState(customers);
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? customers[0]?.id ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [intro, setIntro] = useState(initial?.intro ?? "");
  const vat = defaults.defaultVatRate ?? 25;
  const [lines, setLines] = useState<DocLine[]>(
    initial?.lines?.length ? initial.lines : [newLine("arbete", vat, "start-arbete"), newLine("material", vat, "start-material")]
  );
  const [rot, setRot] = useState<RotRut | null>(() =>
    initial?.rot ? rotForEditor(initial.rot.type, initial.lines?.length ? initial.lines : [], initial.rot, "offert") : null
  );
  const [clampNotice, setClampNotice] = useState<string | null>(null);
  const [plan, setPlan] = useState<PaymentPlanPart[]>(initial?.paymentPlan ?? PLAN_PRESETS[0].plan);
  const [termsDays, setTermsDays] = useState(initial?.paymentTermsDays ?? defaults.paymentTermsDays);
  const [lateInterest, setLateInterest] = useState(initial?.lateInterestRate ?? defaults.lateInterestRate);
  const [validUntil, setValidUntil] = useState((initial?.validUntil ?? defaults.validUntil).slice(0, 10));
  const [terms, setTerms] = useState(initial?.terms ?? defaults.terms);
  const [richText, setRichText] = useState<RichTextDoc | undefined>(initial?.richText);
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const snapshot = JSON.stringify({ customerId, title, intro, lines, rot, plan, termsDays, lateInterest, validUntil, terms, richText: richText ?? null });
  const initialSnapshot = useRef(snapshot);
  const dirty = snapshot !== initialSnapshot.current;
  const { confirmLeave, dialog } = useUnsavedLeave(dirty && !saving);

  const planTotal = plan.reduce((s, p) => s + p.percent, 0);
  const missing = useMemo(
    () =>
      quoteMissingRequirements({
        customerId,
        title,
        lines,
        planPercentTotal: planTotal,
        validUntil,
        paymentTermsDays: termsDays,
      }),
    [customerId, title, lines, planTotal, validUntil, termsDays]
  );
  const [attempted, setAttempted] = useState(false);
  const showErrors = attempted && missing.length > 0;
  const missingIds = useMemo(() => new Set(showErrors ? missing.map((m) => m.id) : []), [missing, showErrors]);
  const nav = { returnTo, returnLabel };
  const liveTotals = useMemo(() => docTotals(finiteLines(lines), rot), [lines, rot]);
  const quoteRotTotals = rot ? liveTotals : null;

  function changeQuoteLines(next: DocLine[]) {
    setLines(next);
    if (!rot) return;
    const synced = syncRotWithLines(rot, finiteLines(next));
    setRot(synced.rot);
    if (synced.clamped) {
      setClampNotice(taxReductionClampedMessage(rot.type, synced.appliedTaxReduction, "offert"));
    }
  }

  function submit() {
    if (missing.length > 0) {
      // Blockera, visa summeringen vid knappen och fokusera första fältet som saknas.
      setAttempted(true);
      focusField(missing[0].fieldId);
      return;
    }
    const payload = {
      title: title.trim(),
      intro: intro.trim(),
      lines: prunedLines(lines),
      rot,
      paymentPlan: plan,
      paymentTermsDays: termsDays,
      lateInterestRate: lateInterest,
      validUntil: new Date(validUntil + "T12:00:00").toISOString(),
      terms,
      richText,
    };
    setSaving(true);
    startTransition(async () => {
      if (quoteId) {
        await updateQuoteAction(quoteId, payload);
        router.push(hrefWithNav(`/ekonomi/offerter/${quoteId}`, nav) as never);
      } else {
        await createQuoteAction({ ...payload, customerId, jobId }, nav);
      }
    });
  }

  return (
    // Sidosummeringen kommer tillbaka först på xl – på 1024 (surfplatta liggande,
    // med sidonav) finns inte plats bredvid radeditorn utan horisontell scroll.
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_290px]">
      <div className="min-w-0 space-y-6">
        <Card className="space-y-5 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div id="offert-kund">
              <label className={labelCls}>Kund</label>
              {quoteId || jobId || lockCustomer ? (
                <p className="rounded-xl border border-line bg-canvas/50 px-3.5 py-2.5 text-[15px] text-ink">
                  {customerOptions.find((c) => c.id === customerId)?.name ?? "Kund"}
                </p>
              ) : (
                <CustomerPicker
                  customers={customerOptions}
                  value={customerId}
                  onChange={setCustomerId}
                  onCreated={(customer) => setCustomerOptions((prev) => addCustomerOption(prev, customer))}
                />
              )}
              {missingIds.has("kund") ? <FieldError>Välj kund.</FieldError> : null}
            </div>
            <div>
              <label className={labelCls} htmlFor="offert-rubrik">
                Rubrik
              </label>
              <input
                id="offert-rubrik"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="T.ex. Köksrenovering"
                aria-invalid={missingIds.has("rubrik") || undefined}
                aria-describedby={missingIds.has("rubrik") ? "offert-rubrik-fel" : undefined}
                className={cx(inputCls, missingIds.has("rubrik") && invalidFieldCls)}
              />
              {missingIds.has("rubrik") ? <FieldError id="offert-rubrik-fel">Rubrik krävs.</FieldError> : null}
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
          <LinesEditor lines={lines} onChange={changeQuoteLines} defaultVatRate={vat} showErrors={attempted} />
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
                  onClick={() => {
                    setClampNotice(null);
                    setRot(value ? rotForEditor(value, lines, null, "offert") : null);
                  }}
                  className={cx(
                    "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors max-lg:py-2",
                    (rot?.type ?? null) === value ? "border-ink bg-ink text-white" : "border-line-strong text-soft hover:border-muted"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {rot && quoteRotTotals ? (
              <div className="mt-3">
                <TaxReductionAmountPanel
                  type={rot.type}
                  documentKind="offert"
                  laborInclVat={quoteRotTotals.laborInclVat}
                  calculated={quoteRotTotals.calculatedEligibleTaxReduction}
                  applied={quoteRotTotals.deduction}
                  toPay={quoteRotTotals.toPay}
                  manuallyAdjusted={Boolean(rot.taxReductionManuallyAdjusted)}
                  clampNotice={clampNotice}
                  onApply={(amount) => {
                    setClampNotice(null);
                    setRot({
                      type: rot.type,
                      calculatedEligibleTaxReduction: quoteRotTotals.calculatedEligibleTaxReduction,
                      appliedTaxReduction: amount,
                      taxReductionManuallyAdjusted: true,
                    });
                  }}
                  onUseMax={() => {
                    setClampNotice(null);
                    setRot(rotForEditor(rot.type, lines, null, "offert"));
                  }}
                />
              </div>
            ) : null}
            {rot ? <TaxReductionFormPreview type={rot.type} /> : null}
          </div>

          <div id="offert-betalplan">
            <label className={labelCls}>Betalningsplan</label>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {PLAN_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setPlan(p.plan)}
                  className={cx(
                    "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors max-lg:py-2",
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
                    aria-label="Delbetalningens namn"
                    className={cx(inputCls, "min-w-0 flex-1")}
                  />
                  <div className="flex shrink-0 items-center gap-1">
                    <input
                      type="number"
                      value={p.percent}
                      min={0}
                      max={100}
                      inputMode="numeric"
                      aria-label="Andel i procent"
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
              <DateField
                id="offert-giltig-till"
                value={validUntil}
                onChange={setValidUntil}
                className={cx(inputCls, missingIds.has("giltig-till") && invalidFieldCls)}
              />
              {missingIds.has("giltig-till") ? <FieldError>Välj ett datum.</FieldError> : null}
            </div>
            <div>
              <label className={labelCls} htmlFor="offert-betalvillkor">
                Betalningsvillkor (dagar)
              </label>
              <input
                id="offert-betalvillkor"
                type="number"
                value={termsDays}
                min={1}
                onChange={(e) => setTermsDays(Number(e.target.value))}
                aria-invalid={missingIds.has("betalvillkor") || undefined}
                className={cx(inputCls, missingIds.has("betalvillkor") && invalidFieldCls)}
              />
              {missingIds.has("betalvillkor") ? <FieldError>Minst 1 dag.</FieldError> : null}
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
            <label className={labelCls}>Beskrivning</label>
            <RichTextEditor value={initial?.richText} onChange={setRichText} aiEnabled={aiEnabled} ariaLabel="Beskrivning" />
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
              Valfritt. Visas på offerten före prisraderna – t.ex. vad som ingår, förutsättningar eller
              praktisk information. Rubriker och listor i texten ger strukturen. Sparas med utkastet.
            </p>
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

      <div className="xl:sticky xl:top-8 xl:self-start">
        <Card className="p-5">
          <p className="mb-3 text-[15px] font-semibold">Summering</p>
          <TotalsPanel lines={lines} rot={rot} />
          {showErrors ? <FormValidationSummary id="offert-saknas" missing={missing} className="mt-4" /> : null}
          {/* Mobil: knapparna bor i den stickiga raden nedanför i stället. */}
          <div className="hidden lg:block">
            <button
              className={cx(buttonClasses("primary"), "mt-5 w-full")}
              disabled={isPending}
              aria-describedby={showErrors ? "offert-saknas" : undefined}
              onClick={submit}
            >
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
          </div>
          <p className="mt-3 text-center text-[12px] leading-relaxed text-muted">
            Inget skickas ännu. Utkastet visas som offerten, och du bekräftar när du skickar.
          </p>
        </Card>
        {dialog}
      </div>
      <DocStickyActions
        toPayLabel="Att betala"
        toPay={liveTotals.toPay}
        missingCount={showErrors ? missing.length : 0}
        summaryId="offert-saknas"
        pending={isPending}
        saveLabel={quoteId ? "Spara ändringar" : "Spara utkast"}
        onSave={submit}
        onCancel={() => confirmLeave(cancelHref)}
      />
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
  richText?: RichTextDoc;
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
  lockCustomer,
  rotByCustomer,
  initial,
  cancelHref,
  returnTo,
  returnLabel,
  aiEnabled,
}: {
  customers: CustomerOption[];
  defaultCustomerId?: string;
  defaultLateInterestRate?: number;
  defaultPaymentTermsDays?: number;
  defaultVatRate?: VatRate;
  invoiceId?: string;
  jobId?: string;
  quoteId?: string;
  /** Lås kundväljaren när fakturan öppnas från en kund. */
  lockCustomer?: boolean;
  rotByCustomer?: Record<
    string,
    { personalIdentityNumber?: string; addressLine?: string; properties?: InvoicePropertyOption[] }
  >;
  initial?: InvoiceFormInitial;
  cancelHref: string;
  returnTo?: string;
  returnLabel?: string;
  /** isAiConfigured() från serversidan – styr "Förbättra med AI" i rik text-fältet. */
  aiEnabled?: boolean;
}) {
  const [customerOptions, setCustomerOptions] = useState(customers);
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? customers[0]?.id ?? "");
  const [lines, setLines] = useState<DocLine[]>(
    initial?.lines?.length ? initial.lines : [newLine("arbete", defaultVatRate, "start-arbete")]
  );
  const [rot, setRot] = useState<RotRut | null>(() =>
    initial?.rot ? rotForEditor(initial.rot.type, initial.lines?.length ? initial.lines : [], initial.rot, "faktura") : null
  );
  const [clampNotice, setClampNotice] = useState<string | null>(null);
  const [dueDays, setDueDays] = useState(initial?.dueInDays ?? defaultPaymentTermsDays);
  const [lateInterest, setLateInterest] = useState(initial?.lateInterestRate ?? defaultLateInterestRate);
  const [serviceDate, setServiceDate] = useState((initial?.serviceDate ?? "").slice(0, 10));
  const [taxFields, setTaxFields] = useState<TaxReductionFormValue>(initial?.taxReduction ?? emptyTaxFields());
  const [richText, setRichText] = useState<RichTextDoc | undefined>(initial?.richText);
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const snapshot = JSON.stringify({ customerId, lines, rot, dueDays, lateInterest, serviceDate, taxFields, richText: richText ?? null });
  const initialSnapshot = useRef(snapshot);
  const dirty = snapshot !== initialSnapshot.current;
  const { confirmLeave, dialog } = useUnsavedLeave(dirty && !saving);

  const missing = useMemo(
    () => invoiceMissingRequirements({ customerId, lines, dueInDays: dueDays }),
    [customerId, lines, dueDays]
  );
  const [attempted, setAttempted] = useState(false);
  const showErrors = attempted && missing.length > 0;
  const missingIds = useMemo(() => new Set(showErrors ? missing.map((m) => m.id) : []), [missing, showErrors]);
  const nav = { returnTo, returnLabel };

  function applyCustomerRot(id: string, applyHousing = false) {
    const row = rotByCustomer?.[id];
    const properties = row?.properties ?? [];
    setTaxFields((prev) => {
      const next = {
        ...prev,
        personalIdentityNumber: row?.personalIdentityNumber ?? prev.personalIdentityNumber,
        workAddress: prev.workAddress || row?.addressLine || "",
      };
      if (applyHousing && properties.length === 1) {
        next.housing = { dwellingType: "smahus", propertyDesignation: properties[0].designation };
      }
      return next;
    });
  }

  function syncServiceFromPeriod(fields: TaxReductionFormValue) {
    const suggested = suggestedServiceDate(fields);
    if (suggested) setServiceDate(suggested);
  }

  function setTaxFieldsAndDates(next: TaxReductionFormValue) {
    setTaxFields(next);
    if (rot) syncServiceFromPeriod(next);
  }

  const liveTotals = useMemo(() => docTotals(finiteLines(lines), rot), [lines, rot]);
  const rotLiveTotals = rot ? liveTotals : null;

  function changeInvoiceLines(next: DocLine[]) {
    setLines(next);
    if (!rot) return;
    const synced = syncRotWithLines(rot, finiteLines(next));
    setRot(synced.rot);
    if (synced.clamped) {
      setClampNotice(taxReductionClampedMessage(rot.type, synced.appliedTaxReduction, "faktura"));
    }
  }

  function submit() {
    if (missing.length > 0) {
      // Blockera, visa summeringen vid knappen och fokusera första fältet som saknas.
      setAttempted(true);
      focusField(missing[0].fieldId);
      return;
    }
    setSaving(true);
    const payloadLines = prunedLines(lines);
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
            lines: payloadLines,
            rot,
            dueInDays: dueDays,
            lateInterestRate: lateInterest,
            serviceDate: serviceDate || null,
            richText,
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
            lines: payloadLines,
            rot,
            dueInDays: dueDays,
            lateInterestRate: lateInterest,
            serviceDate: serviceDate || undefined,
            richText,
            ...taxPayload,
          },
          nav
        );
      }
    });
  }

  return (
    // Samma xl-brytpunkt som offertformuläret – se kommentaren där.
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_290px]">
      <div className="min-w-0 space-y-6">
        <Card className="space-y-5 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div id="faktura-kund">
              <label className={labelCls}>Kund</label>
              {invoiceId || lockCustomer ? (
                <p className="rounded-xl border border-line bg-canvas/50 px-3.5 py-2.5 text-[15px] text-ink">
                  {customerOptions.find((c) => c.id === customerId)?.name ?? "Kund"}
                </p>
              ) : (
                <CustomerPicker
                  customers={customerOptions}
                  value={customerId}
                  onChange={(id) => {
                    setCustomerId(id);
                    if (!jobId) applyCustomerRot(id, Boolean(rot));
                  }}
                  onCreated={(customer) => setCustomerOptions((prev) => addCustomerOption(prev, customer))}
                />
              )}
              {missingIds.has("kund") ? <FieldError>Välj kund.</FieldError> : null}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls} htmlFor="faktura-betalvillkor">
                  Förfaller om (dagar)
                </label>
                <input
                  id="faktura-betalvillkor"
                  type="number"
                  min={1}
                  value={dueDays}
                  onChange={(e) => setDueDays(Number(e.target.value))}
                  aria-invalid={missingIds.has("betalvillkor") || undefined}
                  className={cx(inputCls, missingIds.has("betalvillkor") && invalidFieldCls)}
                />
                {missingIds.has("betalvillkor") ? <FieldError>Minst 1 dag.</FieldError> : null}
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
          <LinesEditor lines={lines} onChange={changeInvoiceLines} defaultVatRate={defaultVatRate} showErrors={attempted} />
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
                    const next = value ? rotForEditor(value, lines, rot, "faktura") : null;
                    setRot(next);
                    setClampNotice(null);
                    if (value && customerId) applyCustomerRot(customerId, true);
                    if (value) syncServiceFromPeriod(taxFields);
                  }}
                  className={cx(
                    "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors max-lg:py-2",
                    (rot?.type ?? null) === value ? "border-ink bg-ink text-white" : "border-line-strong text-soft hover:border-muted"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {rot ? (
              <TaxReductionFields
                key={rot.type}
                type={rot.type}
                value={taxFields}
                onChange={setTaxFieldsAndDates}
                properties={rotByCustomer?.[customerId]?.properties}
                amountSlot={
                  rotLiveTotals ? (
                    <>
                      <TaxReductionAmountPanel
                        type={rot.type}
                        documentKind="faktura"
                        laborInclVat={rotLiveTotals.laborInclVat}
                        calculated={rotLiveTotals.calculatedEligibleTaxReduction}
                        applied={rotLiveTotals.deduction}
                        toPay={rotLiveTotals.toPay}
                        toPayLabel="Att betala"
                        manuallyAdjusted={Boolean(rot.taxReductionManuallyAdjusted)}
                        clampNotice={clampNotice}
                        onApply={(amount) => {
                          setClampNotice(null);
                          setRot({
                            type: rot.type,
                            calculatedEligibleTaxReduction: rotLiveTotals.calculatedEligibleTaxReduction,
                            appliedTaxReduction: amount,
                            taxReductionManuallyAdjusted: true,
                          });
                        }}
                        onUseMax={() => {
                          setClampNotice(null);
                          setRot(rotForEditor(rot.type, lines, null, "faktura"));
                        }}
                      />
                      <TaxReductionEditorHint />
                    </>
                  ) : null
                }
              />
            ) : null}
          </div>
        </Card>
        <Card className="p-6">
          <label className={labelCls}>Beskrivning</label>
          <RichTextEditor value={initial?.richText} onChange={setRichText} aiEnabled={aiEnabled} ariaLabel="Beskrivning" />
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
            Valfritt. Visas på fakturan före raderna – t.ex. vad som ingår eller praktisk information.
            Rubriker och listor i texten ger strukturen. Sparas med utkastet och fryses när fakturan skickas.
          </p>
        </Card>
      </div>
      <div className="xl:sticky xl:top-8 xl:self-start">
        <Card className="p-5">
          <p className="mb-3 text-[15px] font-semibold">Summering</p>
          <TotalsPanel lines={lines} rot={rot} toPayLabel="Att betala nu" />
          {showErrors ? <FormValidationSummary id="faktura-saknas" missing={missing} className="mt-4" /> : null}
          {/* Mobil: knapparna bor i den stickiga raden nedanför i stället. */}
          <div className="hidden lg:block">
            <button
              className={cx(buttonClasses("primary"), "mt-5 w-full")}
              disabled={isPending}
              aria-describedby={showErrors ? "faktura-saknas" : undefined}
              onClick={submit}
            >
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
          </div>
          <p className="mt-3 text-center text-[12px] leading-relaxed text-muted">
            {invoiceId
              ? "Nummer tilldelas när du skickar. Koppling till offert är oförändrad."
              : "Utkastet får inget löpnummer förrän du skickar."}
          </p>
        </Card>
        {dialog}
      </div>
      <DocStickyActions
        toPayLabel="Att betala nu"
        toPay={liveTotals.toPay}
        missingCount={showErrors ? missing.length : 0}
        summaryId="faktura-saknas"
        pending={isPending}
        saveLabel={invoiceId ? "Spara ändringar" : "Spara utkast"}
        onSave={submit}
        onCancel={() => confirmLeave(cancelHref)}
      />
    </div>
  );
}
