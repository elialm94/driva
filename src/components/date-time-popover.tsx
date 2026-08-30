"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CalendarDays } from "lucide-react";
import { cx } from "./ui";
import {
  CalendarPanel,
  CalendarPopoverShell,
  parseISODate,
  startOfToday,
  toISODate,
  useFixedPopover,
} from "./date-calendar";
import { padClock } from "@/lib/reminders/parse";

export interface DateTimeValue {
  date: string;
  time: string;
}

/**
 * Popover för command-barens redigerbara påminnelse-preview.
 * Snooze-menyn använder den inbäddade DateTimePicker-panelen i stället.
 */
export function DateTimePopover({
  date,
  time,
  onChange,
  open: openProp,
  onOpenChange,
  min,
  anchorRef,
  className,
  id,
  timeOptional = false,
  allowEmpty = false,
}: {
  date: string;
  time: string;
  onChange: (next: DateTimeValue) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  min?: string;
  anchorRef?: RefObject<HTMLElement | null>;
  className?: string;
  id?: string;
  /** Tillåt datum utan klockslag – tom tid betyder datum-only. */
  timeOptional?: boolean;
  /** Visa Rensa så användaren kan ta bort datum/tid helt. */
  allowEmpty?: boolean;
}) {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const popoverId = `${triggerId}-datumtid`;
  const selected = date ? parseISODate(date) : null;
  const minDate = min ? parseISODate(min) : null;
  const clock = time ? padClock(time) : "10:00";

  const isOpenControlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isOpenControlled ? openProp : uncontrolledOpen;
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState(() => {
    const base = selected ?? startOfToday();
    return { year: base.getFullYear(), month: base.getMonth() };
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resolvedAnchor = (anchorRef as RefObject<HTMLElement | null> | undefined) ?? triggerRef;
  const { popoverRef, pos } = useFixedPopover(open, `${view.year}-${view.month}-${clock}`, resolvedAnchor);

  useEffect(() => {
    setMounted(true);
  }, []);

  function setOpenState(next: boolean) {
    if (!isOpenControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  function close() {
    setOpenState(false);
  }

  function openPicker() {
    const base = selected ?? startOfToday();
    setView({ year: base.getFullYear(), month: base.getMonth() });
    setOpenState(true);
  }

  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const base = selected ?? startOfToday();
      setView({ year: base.getFullYear(), month: base.getMonth() });
    }
    wasOpen.current = open;
  }, [open, selected]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (resolvedAnchor.current?.contains(target) || popoverRef.current?.contains(target)) return;
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

  useLayoutEffect(() => {
    if (!open || !pos) return;
    const popover = popoverRef.current;
    if (!popover || popover.contains(document.activeElement)) return;
    const timeInput = popover.querySelector<HTMLInputElement>('input[type="time"]');
    (timeInput ?? popover).focus();
  }, [open, pos]);

  const today = startOfToday();
  const todayIso = toISODate(today);
  const todayDisabled = minDate ? today < minDate : false;

  const calendar =
    open && mounted
      ? createPortal(
          <CalendarPopoverShell popoverRef={popoverRef} popoverId={popoverId} label="Välj dag och tid" pos={pos}>
            <CalendarPanel
              view={view}
              onViewChange={setView}
              selected={selected}
              minDate={minDate}
              onPick={(iso) => onChange({ date: iso, time: timeOptional && !time ? "" : clock })}
            />
            <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
              <label className="min-w-0 flex-1 text-[12px] font-medium text-soft">
                Tid{timeOptional ? " (valfritt)" : ""}
                <input
                  type="time"
                  value={time ? clock : timeOptional ? "" : clock}
                  onChange={(e) => {
                    if (!e.target.value) {
                      if (timeOptional) onChange({ date: date || todayIso, time: "" });
                      return;
                    }
                    onChange({ date: date || todayIso, time: padClock(e.target.value) });
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-line bg-card px-2.5 text-[14px] tabular text-ink"
                />
              </label>
            </div>
            <div className="mt-2 flex items-center justify-between">
              {allowEmpty ? (
                <button
                  type="button"
                  className="rounded-lg px-3 py-2 text-[13px] font-medium text-soft transition-colors hover:bg-ink/5 hover:text-ink"
                  onClick={() => {
                    onChange({ date: "", time: "" });
                    close();
                  }}
                >
                  Ingen tid
                </button>
              ) : (
                <button
                  type="button"
                  disabled={todayDisabled}
                  className="rounded-lg px-3 py-2 text-[13px] font-medium text-accent transition-colors hover:bg-accent-soft disabled:pointer-events-none disabled:opacity-40"
                  onClick={() => {
                    setView({ year: today.getFullYear(), month: today.getMonth() });
                    onChange({ date: todayIso, time: timeOptional && !time ? "" : clock });
                  }}
                >
                  Idag
                </button>
              )}
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-ink/5"
                onClick={close}
              >
                Klar
              </button>
            </div>
          </CalendarPopoverShell>,
          document.body
        )
      : null;

  if (anchorRef) {
    return calendar;
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        onClick={() => (open ? close() : openPicker())}
        className={cx(className, "flex items-center justify-between gap-2 text-left")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
      >
        <span className={cx("min-w-0 truncate", !selected && "text-muted")}>
          {selected
            ? time
              ? `${formatDisplay(selected)} kl ${clock}`
              : formatDisplay(selected)
            : timeOptional
              ? "Ingen tid"
              : "Välj dag och tid"}
        </span>
        <CalendarDays className="size-4 shrink-0 text-muted" />
      </button>
      {calendar}
    </div>
  );
}

function formatDisplay(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { weekday: "short", day: "numeric", month: "short" })
    .format(d)
    .replace(/\./g, "");
}
