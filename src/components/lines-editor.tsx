"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { buttonClasses, cx } from "./ui";
import { kr } from "@/lib/format";
import type { DocLine, LineKind, VatRate } from "@/lib/types";
import {
  ECONOMIC_LINE_TYPES,
  TRAVEL_RECLASSIFY_ACTION,
  TRAVEL_RECLASSIFY_PROMPT,
  defaultUnitForLineType,
  lineKindFromType,
  lineTypeHint,
  lineTypeLabel,
  lineTypeOf,
  shouldSuggestTravelType,
  type EconomicLineType,
} from "@/lib/economic-line-type";
import { applyArbeteLineDefaults, createDocLine } from "@/lib/line-defaults";
import { lineFieldId, lineIsBlank, lineMissingParts } from "@/lib/form-requirements";
import { FieldError, invalidFieldCls } from "./form-validation";
import { LineDescriptionInput } from "./line-description-input";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
/** Etikett som bara syns i mobilens radkort – desktop har kolumnrubrikerna. */
const mobileLineLabelCls = "mb-1 block text-[12px] font-medium text-muted @min-[40rem]:hidden";

/**
 * Desktop-tabell när den faktiska kolumnbredden räcker.
 * Beskrivning är 1fr; typ/antal/enhet/pris/moms/radera håller kompakt naturlig bredd.
 * Hela klassnamnet måste stå statiskt så Tailwind hittar det.
 */
const LINE_GRID_HEADER =
  "hidden gap-2 text-[12px] font-medium uppercase tracking-wide text-muted @min-[40rem]:grid @min-[40rem]:grid-cols-[7.5rem_minmax(0,1fr)_4.375rem_4.375rem_6.875rem_5.625rem_2rem]";
const LINE_GRID_ROW =
  "relative grid grid-cols-2 gap-x-2.5 gap-y-3 rounded-2xl border border-line bg-canvas/40 p-3.5 @min-[40rem]:static @min-[40rem]:grid-cols-[7.5rem_minmax(0,1fr)_4.375rem_4.375rem_6.875rem_5.625rem_2rem] @min-[40rem]:gap-2 @min-[40rem]:rounded-none @min-[40rem]:border-0 @min-[40rem]:bg-transparent @min-[40rem]:p-0";

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

/**
 * `stableId` behövs för rader som skapas i useState-initialisatorn: den körs
 * både på servern och i klienten, och ett slumpat id ger olika DOM-id:n
 * (rad-…-beskrivning) → hydration mismatch som React inte lappar ihop.
 */
export function newLine(
  kind: LineKind = "arbete",
  vatRate: VatRate = 25,
  stableId?: string,
  defaultHourlyRate?: number
): DocLine {
  return createDocLine(
    kind,
    { defaultVatRate: vatRate, defaultHourlyRate },
    { id: stableId, applyHourlyRate: !stableId }
  );
}

export function LinesEditor({
  lines,
  onChange,
  defaultVatRate = 25,
  defaultHourlyRate,
  showErrors = false,
  rotActive = false,
}: {
  lines: DocLine[];
  onChange: (lines: DocLine[]) => void;
  defaultVatRate?: VatRate;
  defaultHourlyRate?: number;
  /** Efter ett sparförsök: markera ofullständiga rader tills de är ifyllda. */
  showErrors?: boolean;
  rotActive?: boolean;
}) {
  function update(id: string, patch: Partial<DocLine>) {
    onChange(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  const allBlank = showErrors && lines.every(lineIsBlank);
  return (
    <div id="prisrader" className="@container space-y-3.5 @min-[40rem]:space-y-2.5">
      <div className={LINE_GRID_HEADER}>
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
        const markPrice = parts.price;
        const lineTotal =
          (Number.isFinite(line.qty) ? line.qty : 0) * (Number.isFinite(line.unitPrice) ? line.unitPrice : 0);
        return (
          <div key={line.id} className={LINE_GRID_ROW}>
            <div className="@min-[40rem]:contents">
              <label htmlFor={`rad-${line.id}-typ`} className={mobileLineLabelCls}>
                Typ
              </label>
              <select
                id={`rad-${line.id}-typ`}
                value={lineKindFromType(lineTypeOf(line))}
                onChange={(e) => {
                  const kind = e.target.value as LineKind;
                  const type = lineTypeOf({ kind });
                  const unit =
                    type === "LABOR" || type === "TRAVEL"
                      ? line.unit === "st"
                        ? defaultUnitForLineType(type)
                        : line.unit
                      : line.unit === "tim"
                        ? "st"
                        : line.unit;
                  const next = applyArbeteLineDefaults(
                    { ...line, kind, type, unit },
                    { defaultHourlyRate, defaultVatRate }
                  );
                  update(line.id, { kind, type, unit: next.unit, unitPrice: next.unitPrice });
                }}
                aria-label="Typ"
                title={lineTypeHint(lineTypeOf(line))}
                className={inputCls}
              >
                {ECONOMIC_LINE_TYPES.map((type) => (
                  <option key={type} value={lineKindFromType(type)}>
                    {lineTypeLabel(type)}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 @min-[40rem]:contents">
              <label htmlFor={lineFieldId(line.id, "beskrivning")} className={mobileLineLabelCls}>
                Beskrivning
              </label>
              <LineDescriptionInput
                id={lineFieldId(line.id, "beskrivning")}
                value={line.description}
                onChange={(description) => update(line.id, { description })}
                placeholder="Vad ingår? (rabatt läggs som rad med minusbelopp)"
                aria-label="Beskrivning"
                aria-invalid={markDescription}
                kind={lineKindFromType(lineTypeOf(line))}
                className={cx(inputCls, markDescription && invalidFieldCls)}
              />
            </div>
            <div className="@min-[40rem]:contents">
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
            <div className="@min-[40rem]:contents">
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
            <div className="@min-[40rem]:contents">
              <label htmlFor={lineFieldId(line.id, "pris")} className={mobileLineLabelCls}>
                À-pris exkl. moms
              </label>
              <div className="relative @min-[40rem]:contents">
                <DecimalInput
                  id={lineFieldId(line.id, "pris")}
                  value={line.unitPrice}
                  onValueChange={(unitPrice) => update(line.id, { unitPrice })}
                  className={cx(inputCls, "pr-8 @min-[40rem]:pr-3", markPrice && invalidFieldCls)}
                  allowNegative
                  aria-label="À-pris exkl. moms"
                  invalid={markPrice}
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-muted @min-[40rem]:hidden"
                >
                  kr
                </span>
              </div>
            </div>
            <div className="@min-[40rem]:contents">
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
              </select>
            </div>
            <button
              type="button"
              onClick={() => onChange(lines.filter((l) => l.id !== line.id))}
              className="absolute right-1.5 top-1.5 flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger-soft hover:text-danger @min-[40rem]:static @min-[40rem]:size-auto"
              title="Ta bort rad"
              aria-label="Ta bort rad"
            >
              <Trash2 className="size-4" />
            </button>
            <div className="col-span-2 -mb-0.5 flex items-baseline justify-between gap-3 border-t border-line pt-2.5 @min-[40rem]:hidden">
              <span className="text-[13px] text-soft">Summa exkl. moms</span>
              <span className="text-[14px] font-semibold tabular text-ink">{kr(lineTotal)}</span>
            </div>
            {parts.description || parts.price ? (
              <FieldError className="col-span-2 -mt-0.5 @min-[40rem]:col-span-full @min-[40rem]:mt-0">
                {parts.description ? "Beskrivning saknas på raden." : "À-priset är ogiltigt."}
              </FieldError>
            ) : null}
            {rotActive && shouldSuggestTravelType(line) ? (
              <p className="col-span-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-soft @min-[40rem]:col-span-full">
                <span>{TRAVEL_RECLASSIFY_PROMPT}</span>
                <button
                  type="button"
                  className="font-medium text-accent-deep underline-offset-2 hover:underline"
                  onClick={() =>
                    update(line.id, {
                      kind: "resor",
                      type: "TRAVEL",
                      unit: line.unit === "st" ? "tim" : line.unit,
                    })
                  }
                >
                  {TRAVEL_RECLASSIFY_ACTION}
                </button>
              </p>
            ) : null}
          </div>
        );
      })}
      {allBlank ? <FieldError>Beskrivning saknas på raden.</FieldError> : null}
      <div className="flex flex-wrap gap-2 pt-1">
        {(["LABOR", "MATERIAL", "TRAVEL", "OTHER"] as EconomicLineType[]).map((type) => (
          <button
            key={type}
            type="button"
            className={buttonClasses("secondary", "sm", "max-sm:h-11 flex-1 sm:flex-none")}
            title={lineTypeHint(type)}
            onClick={() =>
              onChange([...lines, newLine(lineKindFromType(type), defaultVatRate, undefined, defaultHourlyRate)])
            }
          >
            <Plus className="size-3.5" /> {lineTypeLabel(type)}
          </button>
        ))}
      </div>
    </div>
  );
}
