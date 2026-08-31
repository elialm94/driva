"use client";

import { useEffect, useLayoutEffect, useRef, useState, type SelectHTMLAttributes } from "react";
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
import { lineFieldId, lineIsBlank, lineMissingParts, type LineEditorField } from "@/lib/form-requirements";
import {
  LINE_DELETED_TOAST,
  applyLineRedo,
  applyLineUndo,
  createFollowUpLine,
  insertLineAfter,
  lineUndoShortcut,
  nextLineField,
  pushLimited,
  removeLineAt,
  shouldHandleRowUndo,
  shouldRefocusRestoredLine,
  type LineDeleteEntry,
} from "@/lib/line-editor-nav";
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

function lineIdFromElement(el: Element | null): string | null {
  const node = el?.closest("[data-line-id]") ?? el;
  const fromAttr = node instanceof HTMLElement ? node.dataset.lineId : undefined;
  if (fromAttr) return fromAttr;
  const id = el instanceof HTMLElement ? el.id : "";
  const match = id.match(/^rad-(.+)-(typ|beskrivning|antal|enhet|pris|moms)$/);
  return match?.[1] ?? null;
}

function focusLineField(lineId: string, field: LineEditorField) {
  const el = document.getElementById(lineFieldId(lineId, field));
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return;
  el.focus();
  if (el instanceof HTMLInputElement) el.select();
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
  onEnterNavigate,
}: {
  value: number;
  onValueChange: (n: number) => void;
  className?: string;
  allowNegative?: boolean;
  "aria-label"?: string;
  id?: string;
  invalid?: boolean;
  onEnterNavigate?: () => void;
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
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
        e.preventDefault();
        onEnterNavigate?.();
      }}
      onBlur={() => {
        const next = clamp(parseDecimal(text));
        if (next !== value) onValueChange(next);
        setText(formatDecimal(next));
        setFocused(false);
      }}
    />
  );
}

/** Native select: öppen dropdown behåller Enter; stängd dropdown går vidare. */
function LineSelect({
  onEnter,
  onChange,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { onEnter: () => void }) {
  const open = useRef(false);
  return (
    <select
      {...props}
      onMouseDown={(e) => {
        open.current = true;
        props.onMouseDown?.(e);
      }}
      onBlur={(e) => {
        open.current = false;
        props.onBlur?.(e);
      }}
      onChange={(e) => {
        open.current = false;
        onChange?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "F4") {
          open.current = true;
        }
        if (e.key === "Escape") open.current = false;
        if (e.key !== "Enter") return;
        if (open.current) {
          open.current = false;
          return;
        }
        e.preventDefault();
        onEnter();
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
  const linesRef = useRef(lines);
  const onChangeRef = useRef(onChange);
  const undoRef = useRef<LineDeleteEntry[]>([]);
  const redoRef = useRef<LineDeleteEntry[]>([]);
  const typedSinceDeleteRef = useRef(true);
  const focusMovedRef = useRef(false);
  const lastDeletedIdRef = useRef<string | null>(null);
  const pendingFocusRef = useRef<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [toastOpen, setToastOpen] = useState(false);

  linesRef.current = lines;
  onChangeRef.current = onChange;

  function update(id: string, patch: Partial<DocLine>) {
    onChange(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function requestDescriptionFocus(lineId: string) {
    pendingFocusRef.current = lineId;
  }

  function goFrom(line: DocLine, field: LineEditorField) {
    const next = nextLineField(field);
    if (next.kind === "new-row") {
      const created = createFollowUpLine(line, { defaultVatRate, defaultHourlyRate });
      const index = lines.findIndex((row) => row.id === line.id);
      requestDescriptionFocus(created.id);
      onChange(insertLineAfter(lines, index < 0 ? lines.length - 1 : index, created));
      return;
    }
    focusLineField(line.id, next.field);
  }

  function addType(type: EconomicLineType) {
    const created = newLine(lineKindFromType(type), defaultVatRate, undefined, defaultHourlyRate);
    requestDescriptionFocus(created.id);
    onChange([...lines, created]);
  }

  function showToast() {
    setToastOpen(true);
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastOpen(false), 8000);
  }

  function deleteLine(id: string) {
    const { lines: next, removed } = removeLineAt(lines, id);
    if (!removed) return;
    undoRef.current = pushLimited(undoRef.current, removed);
    redoRef.current = [];
    typedSinceDeleteRef.current = false;
    focusMovedRef.current = false;
    lastDeletedIdRef.current = id;
    showToast();
    onChange(next);
  }

  function undoDelete() {
    const result = applyLineUndo(linesRef.current, undoRef.current, redoRef.current);
    if (!result.restored) return;
    undoRef.current = result.undo;
    redoRef.current = result.redo;
    onChangeRef.current(result.lines);
    if (result.undo.length === 0) setToastOpen(false);
    const activeId = lineIdFromElement(document.activeElement);
    if (
      shouldRefocusRestoredLine({
        activeLineId: activeId,
        restoredLineId: result.restored.line.id,
        focusMovedToOtherLine: focusMovedRef.current,
      })
    ) {
      requestDescriptionFocus(result.restored.line.id);
    }
  }

  function redoDelete() {
    const result = applyLineRedo(linesRef.current, undoRef.current, redoRef.current);
    if (!result.removed) return;
    undoRef.current = result.undo;
    redoRef.current = result.redo;
    lastDeletedIdRef.current = result.removed.line.id;
    typedSinceDeleteRef.current = false;
    focusMovedRef.current = false;
    showToast();
    onChangeRef.current(result.lines);
  }

  useLayoutEffect(() => {
    const id = pendingFocusRef.current;
    if (!id) return;
    if (!lines.some((line) => line.id === id)) return;
    pendingFocusRef.current = null;
    focusLineField(id, "beskrivning");
  }, [lines]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const shortcut = lineUndoShortcut(e);
      if (!shortcut) return;
      if (
        !shouldHandleRowUndo({
          shortcut,
          hasUndo: undoRef.current.length > 0,
          hasRedo: redoRef.current.length > 0,
          typedSinceDelete: typedSinceDeleteRef.current,
          target: e.target,
        })
      ) {
        return;
      }
      e.preventDefault();
      if (shortcut === "undo") undoDelete();
      else redoDelete();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const allBlank = showErrors && lines.every(lineIsBlank);
  return (
    <div
      id="prisrader"
      data-line-editor
      className="@container space-y-3.5 @min-[40rem]:space-y-2.5"
      onInput={() => {
        typedSinceDeleteRef.current = true;
      }}
      onFocusCapture={(e) => {
        const id = lineIdFromElement(e.target);
        if (id && lastDeletedIdRef.current && id !== lastDeletedIdRef.current) {
          focusMovedRef.current = true;
        }
      }}
    >
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
          <div key={line.id} data-line-id={line.id} className={LINE_GRID_ROW}>
            <div className="@min-[40rem]:contents">
              <label htmlFor={lineFieldId(line.id, "typ")} className={mobileLineLabelCls}>
                Typ
              </label>
              <LineSelect
                id={lineFieldId(line.id, "typ")}
                value={lineKindFromType(lineTypeOf(line))}
                onEnter={() => goFrom(line, "typ")}
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
              </LineSelect>
            </div>
            <div className="col-span-2 @min-[40rem]:contents">
              <label htmlFor={lineFieldId(line.id, "beskrivning")} className={mobileLineLabelCls}>
                Beskrivning
              </label>
              <LineDescriptionInput
                id={lineFieldId(line.id, "beskrivning")}
                value={line.description}
                onChange={(description) => update(line.id, { description })}
                onEnterNavigate={() => goFrom(line, "beskrivning")}
                placeholder="Vad ingår? (rabatt läggs som rad med minusbelopp)"
                aria-label="Beskrivning"
                aria-invalid={markDescription}
                kind={lineKindFromType(lineTypeOf(line))}
                className={cx(inputCls, markDescription && invalidFieldCls)}
              />
            </div>
            <div className="@min-[40rem]:contents">
              <label htmlFor={lineFieldId(line.id, "antal")} className={mobileLineLabelCls}>
                Antal
              </label>
              <DecimalInput
                id={lineFieldId(line.id, "antal")}
                value={line.qty}
                onValueChange={(qty) => update(line.id, { qty })}
                onEnterNavigate={() => goFrom(line, "antal")}
                className={inputCls}
                aria-label="Antal"
              />
            </div>
            <div className="@min-[40rem]:contents">
              <label htmlFor={lineFieldId(line.id, "enhet")} className={mobileLineLabelCls}>
                Enhet
              </label>
              <input
                id={lineFieldId(line.id, "enhet")}
                value={line.unit}
                onChange={(e) => update(line.id, { unit: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  goFrom(line, "enhet");
                }}
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
                  onEnterNavigate={() => goFrom(line, "pris")}
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
              <label htmlFor={lineFieldId(line.id, "moms")} className={mobileLineLabelCls}>
                Moms
              </label>
              <LineSelect
                id={lineFieldId(line.id, "moms")}
                value={line.vatRate}
                onEnter={() => goFrom(line, "moms")}
                onChange={(e) => update(line.id, { vatRate: Number(e.target.value) as VatRate })}
                aria-label="Moms"
                className={inputCls}
              >
                <option value={25}>25 %</option>
                <option value={12}>12 %</option>
                <option value={6}>6 %</option>
                <option value={0}>0 %</option>
              </LineSelect>
            </div>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => deleteLine(line.id)}
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
            onClick={() => addType(type)}
          >
            <Plus className="size-3.5" /> {lineTypeLabel(type)}
          </button>
        ))}
      </div>
      {toastOpen ? (
        <div
          role="status"
          data-line-delete-toast
          className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-ink px-4 py-2.5 text-[14px] font-medium text-white shadow-pop"
        >
          <span>{LINE_DELETED_TOAST}</span>
          <button
            type="button"
            className="rounded-lg bg-white/15 px-2.5 py-1 text-[13px] font-semibold hover:bg-white/25"
            onClick={undoDelete}
          >
            Ångra
          </button>
        </div>
      ) : null}
    </div>
  );
}
