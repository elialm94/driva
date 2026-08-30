"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarMonth } from "./calendar-month";
import { buttonClasses, cx } from "./ui";
import { parseClock, parseISODate, startOfToday, toISODate } from "@/lib/dates/iso-date";
import { defaultSnoozeClock, DEFAULT_TIMEZONE } from "@/lib/reminders/when";

export type DateTimePickerMode = "date" | "datetime";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

function ensureMinuteOption(time: string): string[] {
  const parsed = parseClock(time);
  if (!parsed) return [...MINUTES];
  const mm = String(parsed.minute).padStart(2, "0");
  return MINUTES.includes(mm) ? [...MINUTES] : [...MINUTES, mm].sort();
}

/**
 * Gemensam datum/tid-kontroll.
 *
 *  - mode="date": månadskalender, klick på dag väljer och anropar onDateChange.
 *    Används för förfallodatum, arbetsperiod, uppdrag – aldrig tid.
 *  - mode="datetime": samma kalender + klockslag i samma yta. Dagen väljs
 *    utan att stänga; bekräftelse sker via footer (t.ex. Snooza).
 */
export function DateTimePicker({
  mode = "date",
  date,
  time,
  min,
  onDateChange,
  onTimeChange,
  defaultTime = "policy",
  timezone = DEFAULT_TIMEZONE,
  now,
  footer,
  showClear,
  showToday,
  onClear,
  className,
}: {
  mode?: DateTimePickerMode;
  date?: string;
  time?: string;
  min?: string;
  onDateChange?: (iso: string) => void;
  onTimeChange?: (hhmm: string) => void;
  /** Vid ny dag i datetime-läge: snooze-policy (09:00 / nästa timme) eller behåll tiden. */
  defaultTime?: "policy" | "keep";
  timezone?: string;
  now?: Date;
  footer?: ReactNode;
  showClear?: boolean;
  showToday?: boolean;
  onClear?: () => void;
  className?: string;
}) {
  const selected = date ? parseISODate(date) : null;
  const [view, setView] = useState(() => {
    const base = selected ?? startOfToday();
    return { year: base.getFullYear(), month: base.getMonth() };
  });

  useEffect(() => {
    if (!selected) return;
    setView({ year: selected.getFullYear(), month: selected.getMonth() });
  }, [date]);

  const clock = time ?? "09:00";
  const parsedClock = parseClock(clock) ?? { hour: 9, minute: 0 };
  const minuteOptions = useMemo(() => ensureMinuteOption(clock), [clock]);
  const today = startOfToday();
  const todayIso = toISODate(today);
  const todayDisabled = min ? (parseISODate(min) ? today < parseISODate(min)! : false) : false;

  function pickDate(iso: string) {
    if (mode === "datetime" && defaultTime === "policy") {
      const nextTime = defaultSnoozeClock(iso, now ?? new Date(), timezone);
      onTimeChange?.(nextTime);
    }
    onDateChange?.(iso);
  }

  function setHour(hour: string) {
    onTimeChange?.(`${hour}:${String(parsedClock.minute).padStart(2, "0")}`);
  }

  function setMinute(minute: string) {
    onTimeChange?.(`${String(parsedClock.hour).padStart(2, "0")}:${minute}`);
  }

  return (
    <div className={cx("w-[18.5rem]", className)}>
      <CalendarMonth
        year={view.year}
        month={view.month}
        selectedIso={date}
        min={min}
        onSelect={pickDate}
        onViewChange={setView}
      />

      {mode === "datetime" ? (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
          <span className="text-[13px] font-medium text-muted">Tid</span>
          <div className="flex items-center gap-1">
            <select
              aria-label="Timme"
              value={String(parsedClock.hour).padStart(2, "0")}
              onChange={(e) => setHour(e.target.value)}
              className="h-10 min-w-[3.25rem] rounded-xl border border-line-strong bg-card px-2 text-center text-[15px] tabular text-ink focus:border-accent max-lg:min-h-11"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
            <span className="text-[15px] font-semibold text-muted">:</span>
            <select
              aria-label="Minut"
              value={String(parsedClock.minute).padStart(2, "0")}
              onChange={(e) => setMinute(e.target.value)}
              className="h-10 min-w-[3.25rem] rounded-xl border border-line-strong bg-card px-2 text-center text-[15px] tabular text-ink focus:border-accent max-lg:min-h-11"
            >
              {minuteOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {showClear || showToday ? (
        <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
          {showClear ? (
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-[13px] font-medium text-soft transition-colors hover:bg-ink/5 hover:text-ink"
              onClick={() => onClear?.()}
            >
              Rensa
            </button>
          ) : (
            <span />
          )}
          {showToday ? (
            <button
              type="button"
              disabled={todayDisabled}
              className="rounded-lg px-3 py-2 text-[13px] font-medium text-accent transition-colors hover:bg-accent-soft disabled:pointer-events-none disabled:opacity-40"
              onClick={() => {
                setView({ year: today.getFullYear(), month: today.getMonth() });
                pickDate(todayIso);
              }}
            >
              Idag
            </button>
          ) : null}
        </div>
      ) : null}

      {footer ? <div className="mt-3 flex items-center justify-end gap-2 border-t border-line pt-3">{footer}</div> : null}
    </div>
  );
}

export function DateTimePickerActions({
  cancelLabel = "Avbryt",
  confirmLabel,
  confirmDisabled,
  onCancel,
  onConfirm,
}: {
  cancelLabel?: string;
  confirmLabel: string;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <button type="button" className={cx(buttonClasses("ghost", "sm"), "max-lg:min-h-11")} onClick={onCancel}>
        {cancelLabel}
      </button>
      <button
        type="button"
        className={cx(buttonClasses("primary", "sm"), "max-lg:min-h-11")}
        disabled={confirmDisabled}
        onClick={onConfirm}
      >
        {confirmLabel}
      </button>
    </>
  );
}

export { DateTimePopover, type DateTimeValue } from "./date-time-popover";
