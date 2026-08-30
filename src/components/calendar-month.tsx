"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "./ui";
import {
  formatMonthTitle,
  monthCells,
  parseISODate,
  sameDay,
  startOfToday,
  WEEKDAYS_SHORT_SV,
} from "@/lib/dates/iso-date";

/**
 * Månadskalender som delas av DateField (bara datum) och DateTimePicker
 * (datum + tid). Väljer aldrig tid – det sköter anroparen.
 */
export function CalendarMonth({
  year,
  month,
  selectedIso,
  min,
  onSelect,
  onViewChange,
}: {
  year: number;
  month: number;
  selectedIso?: string;
  min?: string;
  onSelect: (iso: string) => void;
  onViewChange: (view: { year: number; month: number }) => void;
}) {
  const cells = useMemo(() => monthCells(year, month), [year, month]);
  const selected = selectedIso ? parseISODate(selectedIso) : null;
  const minDate = min ? parseISODate(min) : null;
  const today = startOfToday();

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-ink/5 hover:text-ink"
          aria-label="Föregående månad"
          onClick={() =>
            onViewChange(month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 })
          }
        >
          <ChevronLeft className="size-4" />
        </button>
        <p className="text-[13px] font-semibold capitalize text-ink">{formatMonthTitle(year, month)}</p>
        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-ink/5 hover:text-ink"
          aria-label="Nästa månad"
          onClick={() =>
            onViewChange(month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 })
          }
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="mb-1 grid grid-cols-7">
        {WEEKDAYS_SHORT_SV.map((d) => (
          <div key={d} className="py-1 text-center text-[11px] font-medium text-muted">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const isSelected = selected ? sameDay(cell.date, selected) : false;
          const isToday = sameDay(cell.date, today);
          const isDisabled = minDate ? cell.date < minDate : false;
          return (
            <button
              key={cell.iso}
              type="button"
              disabled={isDisabled}
              onClick={() => onSelect(cell.iso)}
              aria-pressed={isSelected}
              aria-current={isToday ? "date" : undefined}
              className={cx(
                "flex h-10 w-full items-center justify-center rounded-lg text-[13px] tabular transition-colors sm:h-9",
                cell.outside && "text-muted/70",
                isDisabled && "pointer-events-none opacity-40",
                !isDisabled && !isSelected && !cell.outside && "text-ink hover:bg-canvas",
                !isDisabled && !isSelected && cell.outside && "hover:bg-canvas",
                isToday && !isSelected && !isDisabled && "font-semibold text-accent",
                isSelected && "bg-accent font-semibold text-white hover:bg-accent-deep"
              )}
            >
              {cell.date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
