"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "./ui";

const WEEKDAYS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];

function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (date.getFullYear() !== Number(m[1]) || date.getMonth() !== Number(m[2]) - 1 || date.getDate() !== Number(m[3])) {
    return null;
  }
  return date;
}

function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDisplay(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function formatMonthTitle(year: number, month: number): string {
  return new Intl.DateTimeFormat("sv-SE", { month: "long", year: "numeric" }).format(new Date(year, month, 1));
}

type Cell = { date: Date; iso: string; outside: boolean };

function monthCells(year: number, month: number): Cell[] {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { date, iso: toISODate(date), outside: date.getMonth() !== month };
  });
}

type Pos = { top: number; left: number };

export function DateField({
  name,
  value,
  defaultValue = "",
  onChange,
  className,
  id,
  placeholder = "Välj datum",
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (iso: string) => void;
  className?: string;
  id?: string;
  placeholder?: string;
}) {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const popoverId = `${triggerId}-kalender`;
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue);
  const iso = isControlled ? value : internal;
  const selected = iso ? parseISODate(iso) : null;

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState(() => {
    const base = selected ?? startOfToday();
    return { year: base.getFullYear(), month: base.getMonth() };
  });
  const [pos, setPos] = useState<Pos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  function setIso(next: string) {
    if (!isControlled) setInternal(next);
    onChange?.(next);
  }

  function close() {
    setOpen(false);
    setPos(null);
  }

  function openCalendar() {
    const base = selected ?? startOfToday();
    setView({ year: base.getFullYear(), month: base.getMonth() });
    setOpen(true);
  }

  function pick(next: string) {
    setIso(next);
    close();
  }

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const trigger = triggerRef.current;
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
  }, [open, view]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const cells = useMemo(() => monthCells(view.year, view.month), [view.year, view.month]);
  const today = startOfToday();
  const todayIso = toISODate(today);

  const calendar =
    open && mounted
      ? createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            role="dialog"
            aria-label="Välj datum"
            lang="sv"
            tabIndex={-1}
            className="fixed z-[80] w-[18.5rem] rounded-2xl border border-line bg-card p-3 shadow-pop animate-fade-in"
            style={{
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              visibility: pos ? "visible" : "hidden",
              pointerEvents: pos ? "auto" : "none",
            }}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                className="flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-ink/5 hover:text-ink"
                aria-label="Föregående månad"
                onClick={() =>
                  setView((v) => (v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 }))
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
                  setView((v) => (v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 }))
                }
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
            <div className="mb-1 grid grid-cols-7">
              {WEEKDAYS.map((d) => (
                <div key={d} className="py-1 text-center text-[11px] font-medium text-muted">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((cell) => {
                const isSelected = selected ? sameDay(cell.date, selected) : false;
                const isToday = sameDay(cell.date, today);
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    onClick={() => pick(cell.iso)}
                    aria-pressed={isSelected}
                    aria-current={isToday ? "date" : undefined}
                    className={cx(
                      "flex h-10 w-full items-center justify-center rounded-lg text-[13px] tabular transition-colors sm:h-9",
                      cell.outside && "text-muted/70",
                      !isSelected && !cell.outside && "text-ink hover:bg-canvas",
                      !isSelected && cell.outside && "hover:bg-canvas",
                      isToday && !isSelected && "font-semibold text-accent",
                      isSelected && "bg-accent font-semibold text-white hover:bg-accent-deep"
                    )}
                  >
                    {cell.date.getDate()}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-[13px] font-medium text-soft transition-colors hover:bg-ink/5 hover:text-ink"
                onClick={() => setIso("")}
              >
                Rensa
              </button>
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-[13px] font-medium text-accent transition-colors hover:bg-accent-soft"
                onClick={() => {
                  setView({ year: today.getFullYear(), month: today.getMonth() });
                  pick(todayIso);
                }}
              >
                Idag
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="relative">
      {name ? <input type="hidden" name={name} value={iso} /> : null}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        onClick={() => (open ? close() : openCalendar())}
        className={cx(className, "flex items-center justify-between gap-2 text-left")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
      >
        <span className={cx("min-w-0 truncate", !selected && "text-muted")}>
          {selected ? formatDisplay(selected) : placeholder}
        </span>
        <CalendarDays className="size-4 shrink-0 text-muted" />
      </button>
      {calendar}
    </div>
  );
}
