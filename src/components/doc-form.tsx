"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { buttonClasses, Card, cx } from "./ui";
import { docTotals } from "@/lib/calc";
import { kr } from "@/lib/format";
import type { DocLine, PaymentPlanPart, RotRut, VatRate } from "@/lib/types";
import { createQuoteAction, updateQuoteAction, createInvoiceAction, updateInvoiceAction } from "@/app/actions";
import { useRouter } from "next/navigation";
import { DateField } from "./date-field";
import { addCustomerOption, CustomerPicker, type CustomerOption } from "./customer-picker";
import { useUnsavedLeave } from "./unsaved-changes";
import { hrefWithNav } from "@/lib/nav";
import { taxReductionDeductionLabel, taxReductionClampedMessage } from "@/lib/tax-reduction-terms";
import { TaxReductionFormPreview, TaxReductionEditorHint, TaxReductionCalcHint } from "./tax-reduction-terms";
import { EditorWorkspace } from "./editor-workspace";
import { LinesEditor, newLine } from "./lines-editor";
import {
  TaxReductionFields,
  TaxReductionAmountPanel,
  taxReductionDetailsFromForm,
  type InvoicePropertyOption,
  type TaxReductionFormValue,
} from "./tax-reduction-fields";
import { suggestedServiceDate } from "@/lib/tax-reduction-gaps";
import { autoSelectWorkLocationId, TaxReductionDocumentProperty } from "./tax-reduction-document-property";
import { maskPersonnummer } from "@/lib/personnummer";
import { AppLink } from "./app-link";
import { rotWithAmounts, syncRotWithLines } from "@/lib/tax-reduction-amount";
import {
  invoiceMissingRequirements,
  prunedLines,
  quoteMissingRequirements,
} from "@/lib/form-requirements";
import { FieldError, FormValidationSummary, focusField, invalidFieldCls } from "./form-validation";
import { StickyMobileActions } from "./sticky-actions";
import type { RichTextDoc } from "@/lib/richtext";

/**
 * TipTap är formulärets tyngsta klientberoende. Ladda det först när
 * editorpartiet faktiskt renderas – resten av formuläret blir interaktivt
 * snabbare och TipTap-chunken hamnar utanför sidans kritiska JS.
 */
const RichTextEditor = dynamic(
  () => import("./rich-text-editor").then((m) => m.RichTextEditor),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-[7.5rem] animate-pulse rounded-xl border border-line-strong bg-card" aria-hidden />
    ),
  }
);

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";

export type { CustomerOption };

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
  lines: DocLine[];
  rot: RotRut | null;
  workLocationId?: string;
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
  rotByCustomer,
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
  rotByCustomer?: Record<
    string,
    { personalIdentityNumber?: string; addressLine?: string; properties?: InvoicePropertyOption[] }
  >;
  initial?: QuoteFormInitial;
  defaults: {
    paymentTermsDays: number;
    lateInterestRate: number;
    validUntil: string;
    terms: string;
    defaultVatRate?: VatRate;
    defaultHourlyRate?: number;
  };
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
  const vat = defaults.defaultVatRate ?? 25;
  const hourly = defaults.defaultHourlyRate;
  const [lines, setLines] = useState<DocLine[]>(
    initial?.lines?.length ? initial.lines : [newLine("arbete", vat, "start-arbete"), newLine("material", vat, "start-material")]
  );
  const [rot, setRot] = useState<RotRut | null>(() =>
    initial?.rot ? rotForEditor(initial.rot.type, initial.lines?.length ? initial.lines : [], initial.rot, "offert") : null
  );
  const [propertiesByCustomer, setPropertiesByCustomer] = useState<Record<string, InvoicePropertyOption[]>>(() =>
    Object.fromEntries(Object.entries(rotByCustomer ?? {}).map(([id, row]) => [id, row.properties ?? []]))
  );
  const [workLocationId, setWorkLocationId] = useState(() => {
    const properties = rotByCustomer?.[defaultCustomerId ?? customers[0]?.id ?? ""]?.properties ?? [];
    return autoSelectWorkLocationId(properties, initial?.workLocationId);
  });
  const [clampNotice, setClampNotice] = useState<string | null>(null);
  const [plan, setPlan] = useState<PaymentPlanPart[]>(initial?.paymentPlan ?? PLAN_PRESETS[0].plan);
  const [termsDays, setTermsDays] = useState(initial?.paymentTermsDays ?? defaults.paymentTermsDays);
  const [lateInterest, setLateInterest] = useState(initial?.lateInterestRate ?? defaults.lateInterestRate);
  const [validUntil, setValidUntil] = useState((initial?.validUntil ?? defaults.validUntil).slice(0, 10));
  const [terms, setTerms] = useState(initial?.terms ?? defaults.terms);
  const [richText, setRichText] = useState<RichTextDoc | undefined>(initial?.richText);
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const snapshot = JSON.stringify({
    customerId,
    title,
    lines,
    rot,
    workLocationId,
    plan,
    termsDays,
    lateInterest,
    validUntil,
    terms,
    richText: richText ?? null,
  });
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
      lines: prunedLines(lines),
      rot,
      workLocationId: workLocationId || undefined,
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
    <EditorWorkspace
      summary={
        <>
          <Card className="p-5">
            <p className="mb-3 text-[15px] font-semibold">Summering</p>
            {/* "Offertvärde", inte "Att betala": inget betalas när offerten signeras. */}
            <TotalsPanel lines={lines} rot={rot} toPayLabel="Offertvärde" />
            {showErrors ? <FormValidationSummary id="offert-saknas" missing={missing} className="mt-4" /> : null}
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
        </>
      }
      footer={
        <DocStickyActions
          toPayLabel="Offertvärde"
          toPay={liveTotals.toPay}
          missingCount={showErrors ? missing.length : 0}
          summaryId="offert-saknas"
          pending={isPending}
          saveLabel={quoteId ? "Spara ändringar" : "Spara utkast"}
          onSave={submit}
          onCancel={() => confirmLeave(cancelHref)}
        />
      }
    >
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
                  onChange={(id) => {
                    setCustomerId(id);
                    const properties = propertiesByCustomer[id] ?? [];
                    setWorkLocationId(rot ? autoSelectWorkLocationId(properties) : "");
                  }}
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
            <label className={labelCls}>Beskrivning</label>
            <RichTextEditor value={initial?.richText} onChange={setRichText} aiEnabled={aiEnabled} ariaLabel="Beskrivning" />
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
              Allt du vill berätta om projektet – vad som ingår, förutsättningar och praktisk information.
              Rubriker och listor i texten ger strukturen. Visas på offerten före prisraderna.
            </p>
          </div>
        </Card>

        <Card className="p-6">
          <p className="mb-4 text-[15px] font-semibold">Prisrader</p>
          <LinesEditor
            lines={lines}
            onChange={changeQuoteLines}
            defaultVatRate={vat}
            defaultHourlyRate={hourly}
            showErrors={attempted}
            rotActive={Boolean(rot)}
          />
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
                    if (value) {
                      const properties = propertiesByCustomer[customerId] ?? [];
                      setWorkLocationId((current) => autoSelectWorkLocationId(properties, current));
                    }
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
                  toPayLabel="Offertvärde"
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
            {rot ? (
              <div id="offert-rot-rut" className="mt-3 space-y-3">
                <TaxReductionFormPreview type={rot.type} />
                {rotByCustomer?.[customerId]?.personalIdentityNumber ? (
                  <p className="text-[13px] text-soft">
                    Personnummer {maskPersonnummer(rotByCustomer[customerId].personalIdentityNumber!)}
                    <span className="ml-1 text-muted">Behövs för ROT/RUT</span>
                  </p>
                ) : (
                  <p className="text-[13px] text-soft">
                    Personnummer saknas.{" "}
                    <AppLink
                      href={`/kunder/${customerId}#kund-personnummer`}
                      className="font-medium text-ink underline-offset-2 hover:underline"
                    >
                      Lägg till personnummer
                    </AppLink>
                    <span className="ml-1 text-muted">Behövs för ROT/RUT</span>
                  </p>
                )}
                <TaxReductionDocumentProperty
                  customerId={customerId}
                  properties={propertiesByCustomer[customerId] ?? []}
                  value={workLocationId}
                  onChange={setWorkLocationId}
                  onPropertiesChange={(next) =>
                    setPropertiesByCustomer((prev) => ({ ...prev, [customerId]: next }))
                  }
                  fieldId="offert-fastighet"
                  documentKind="offert"
                />
              </div>
            ) : null}
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
            <label className={labelCls}>Villkor</label>
            <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} className={inputCls} />
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
              Egna villkor. ROT/RUT-villkor läggs till automatiskt när skattereduktion är vald och hamnar inte i det
              här fältet.
            </p>
          </div>
        </Card>
    </EditorWorkspace>
  );
}

export interface InvoiceFormInitial {
  lines: DocLine[];
  rot: RotRut | null;
  workLocationId?: string;
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
  defaultHourlyRate,
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
  defaultHourlyRate?: number;
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
  const [propertiesByCustomer, setPropertiesByCustomer] = useState<Record<string, InvoicePropertyOption[]>>(() =>
    Object.fromEntries(Object.entries(rotByCustomer ?? {}).map(([id, row]) => [id, row.properties ?? []]))
  );
  const [workLocationId, setWorkLocationId] = useState(() => {
    const properties = rotByCustomer?.[defaultCustomerId ?? customers[0]?.id ?? ""]?.properties ?? [];
    return autoSelectWorkLocationId(properties, initial?.workLocationId);
  });
  const [clampNotice, setClampNotice] = useState<string | null>(null);
  const [dueDays, setDueDays] = useState(initial?.dueInDays ?? defaultPaymentTermsDays);
  const [lateInterest, setLateInterest] = useState(initial?.lateInterestRate ?? defaultLateInterestRate);
  const [serviceDate, setServiceDate] = useState((initial?.serviceDate ?? "").slice(0, 10));
  const [taxFields, setTaxFields] = useState<TaxReductionFormValue>(initial?.taxReduction ?? emptyTaxFields());
  const [richText, setRichText] = useState<RichTextDoc | undefined>(initial?.richText);
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const snapshot = JSON.stringify({
    customerId,
    lines,
    rot,
    workLocationId,
    dueDays,
    lateInterest,
    serviceDate,
    taxFields,
    richText: richText ?? null,
  });
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
        setWorkLocationId(properties[0].id);
      } else if (applyHousing && properties.length !== 1) {
        setWorkLocationId((current) => (properties.some((property) => property.id === current) ? current : ""));
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
          workLocationId: workLocationId || undefined,
        }
      : { taxReductionDetails: null as null, personalIdentityNumber: undefined, workLocationId: workLocationId || undefined };
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
    <EditorWorkspace
      summary={
        <>
          <Card className="p-5">
            <p className="mb-3 text-[15px] font-semibold">Summering</p>
            <TotalsPanel lines={lines} rot={rot} toPayLabel="Att betala nu" />
            {showErrors ? <FormValidationSummary id="faktura-saknas" missing={missing} className="mt-4" /> : null}
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
        </>
      }
      footer={
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
      }
    >
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
          <LinesEditor
            lines={lines}
            onChange={changeInvoiceLines}
            defaultVatRate={defaultVatRate}
            defaultHourlyRate={defaultHourlyRate}
            showErrors={attempted}
            rotActive={Boolean(rot)}
          />
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
              <div id="faktura-rot-rut">
              <TaxReductionDocumentProperty
                customerId={customerId}
                properties={propertiesByCustomer[customerId] ?? []}
                value={workLocationId}
                onChange={(id) => {
                  setWorkLocationId(id);
                  const selected = (propertiesByCustomer[customerId] ?? []).find((property) => property.id === id);
                  if (selected?.designation) {
                    setTaxFieldsAndDates({
                      ...taxFields,
                      housing: { dwellingType: "smahus", propertyDesignation: selected.designation },
                    });
                  }
                }}
                onPropertiesChange={(next) =>
                  setPropertiesByCustomer((prev) => ({ ...prev, [customerId]: next }))
                }
                fieldId="faktura-fastighet"
                documentKind="faktura"
              />
              <TaxReductionFields
                key={rot.type}
                type={rot.type}
                value={taxFields}
                onChange={setTaxFieldsAndDates}
                properties={propertiesByCustomer[customerId]}
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
              </div>
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
    </EditorWorkspace>
  );
}
