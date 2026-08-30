"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CalendarDays } from "lucide-react";
import { cx } from "./ui";
import { DateTimePicker } from "./date-time-picker";
import { formatDateDisplay, parseISODate } from "@/lib/dates/iso-date";

type Pos = { top: number; left: number };

/**
 * Datumfält (DATE ONLY) – återanvänder DateTimePicker i date-läge.
 * Aldrig klockslag: förfallodatum, arbetsperiod, uppdrag, offert.
 */
export function DateField({
  name,
  value,
  defaultValue = "",
  onChange,
  className,
  id,
  placeholder = "Välj datum",
  open: openProp,
  onOpenChange,
  min,
  anchorRef,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (iso: string) => void;
  className?: string;
  id?: string;
  placeholder?: string;
  /** Controlled calendar visibility. Omit for the default trigger-toggle. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** ISO date (YYYY-MM-DD). Days before this are disabled. */
  min?: string;
  /** External anchor for positioning; when set, the built-in trigger is omitted. */
  anchorRef?: RefObject<HTMLElement | null>;
}) {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const popoverId = `${triggerId}-kalender`;
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue);
  const iso = isControlled ? value : internal;
  const selected = iso ? parseISODate(iso) : null;

  const isOpenControlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isOpenControlled ? openProp : uncontrolledOpen;
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  function getAnchor(): HTMLElement | null {
    return anchorRef?.current ?? triggerRef.current;
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  function setIso(next: string) {
    if (!isControlled) setInternal(next);
    onChange?.(next);
  }

  function setOpenState(next: boolean) {
    if (!isOpenControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  function close() {
    setOpenState(false);
    setPos(null);
  }

  function openCalendar() {
    setOpenState(true);
  }

  function pick(next: string) {
    setIso(next);
    close();
  }

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const trigger = getAnchor();
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
  }, [open, iso]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (getAnchor()?.contains(target) || popoverRef.current?.contains(target)) return;
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
    popover.focus();
  }, [open, pos]);

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
            onPointerDown={(e) => e.stopPropagation()}
            className="fixed z-[80] rounded-2xl border border-line bg-card p-3 shadow-pop animate-fade-in"
            style={{
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              visibility: pos ? "visible" : "hidden",
              pointerEvents: pos ? "auto" : "none",
            }}
          >
            <DateTimePicker
              mode="date"
              date={iso || undefined}
              min={min}
              onDateChange={pick}
              showClear
              showToday
              onClear={() => setIso("")}
            />
          </div>,
          document.body
        )
      : null;

  const trigger = (
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
        {selected ? formatDateDisplay(selected) : placeholder}
      </span>
      <CalendarDays className="size-4 shrink-0 text-muted" />
    </button>
  );

  if (anchorRef) {
    return (
      <>
        {name ? <input type="hidden" name={name} value={iso} /> : null}
        {calendar}
      </>
    );
  }

  return (
    <div className="relative">
      {name ? <input type="hidden" name={name} value={iso} /> : null}
      {trigger}
      {calendar}
    </div>
  );
}
