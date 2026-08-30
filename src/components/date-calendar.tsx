"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "./ui";

export const WEEKDAYS_SHORT = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];

export function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (date.getFullYear() !== Number(m[1]) || date.getMonth() !== Number(m[2]) - 1 || date.getDate() !== Number(m[3])) {
    return null;
  }
  return date;
}

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatMonthTitle(year: number, month: number): string {
  return new Intl.DateTimeFormat("sv-SE", { month: "long", year: "numeric" }).format(new Date(year, month, 1));
}

type Cell = { date: Date; iso: string; outside: boolean };

export function monthCells(year: number, month: number): Cell[] {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { date, iso: toISODate(date), outside: date.getMonth() !== month };
  });
}

export type CalendarView = { year: number; month: number };

/** Samma månadsrutnät som datumfältet / snooze – en kalender, inte en till. */
export function CalendarPanel({
  view,
  onViewChange,
  selected,
  minDate,
  onPick,
}: {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  selected: Date | null;
  minDate: Date | null;
  onPick: (iso: string) => void;
}) {
  const cells = useMemo(() => monthCells(view.year, view.month), [view.year, view.month]);
  const today = startOfToday();

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-ink/5 hover:text-ink"
          aria-label="Föregående månad"
          onClick={() =>
            onViewChange(view.month === 0 ? { year: view.year - 1, month: 11 } : { year: view.year, month: view.month - 1 })
          }
        >
          <ChevronLeft className="size-4" />
        </button>
        <p className="text-[13px] font-semibold text-ink">{formatMonthTitle(view.year, view.month)}</p>
        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-ink/5 hover:text-ink"
          aria-label="Nästa månad"
          onClick={() =>
            onViewChange(view.month === 11 ? { year: view.year + 1, month: 0 } : { year: view.year, month: view.month + 1 })
          }
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="mb-1 grid grid-cols-7">
        {WEEKDAYS_SHORT.map((d) => (
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
              onClick={() => onPick(cell.iso)}
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
    </>
  );
}

type Pos = { top: number; left: number };

export function useFixedPopover(
  open: boolean,
  viewKey: string,
  anchorRef: RefObject<HTMLElement | null>
) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function place() {
      const trigger = anchorRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;
      const rect = trigger.getBoundingClientRect();
      const pop = popover.getBoundingClientRect();
      const gap = 6;
      const margin = 8;
      let left = rect.left;
      if (left + pop.width > window.innerWidth - margin) left = window.innerWidth - pop.width - margin;
      if (left < margin) left = margin;
      const below = rect.bottom + gap;
      const above = rect.top - gap - pop.height;
      const fitsBelow = below + pop.height <= window.innerHeight - margin;
      const top = fitsBelow || above < margin ? below : above;
      setPos({ top, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, viewKey, anchorRef]);

  return { popoverRef, pos };
}

export function CalendarPopoverShell({
  popoverRef,
  popoverId,
  label,
  pos,
  children,
}: {
  popoverRef: RefObject<HTMLDivElement | null>;
  popoverId: string;
  label: string;
  pos: Pos | null;
  children: ReactNode;
}) {
  return (
    <div
      ref={popoverRef}
      id={popoverId}
      role="dialog"
      aria-label={label}
      lang="sv"
      tabIndex={-1}
      data-datetime-picker=""
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed z-[80] w-[18.5rem] rounded-2xl border border-line bg-card p-3 shadow-pop animate-fade-in"
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos ? "visible" : "hidden",
        pointerEvents: pos ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
}
