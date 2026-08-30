"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DateTimePicker, DateTimePickerActions } from "./date-time-picker";
import { Modal } from "./modal";
import { actionMenuItemClassName } from "./action-menu";
import { buttonClasses, cx } from "./ui";
import { toISODate, startOfToday } from "@/lib/dates/iso-date";
import { initialSnoozeDateTime, isFutureLocalDateTime } from "@/lib/reminders/when";

export type SnoozePreset<K extends string = string> = { key: K; label: string };

function isMobileSheet() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
}

/**
 * Snooze-meny från en Snooza-knapp: förankrad popover på desktop, bottensheet
 * på mobil. Snabbval körs direkt. "Välj datum & tid…" byter vy i SAMMA yta
 * till kalender + klockslag – inget "Välj dag"-steg, inga staplade sheets.
 */
export function SnoozeMenu<K extends string>({
  presets,
  disabled,
  onPreset,
  onCustom,
  triggerClassName,
  triggerLabel = "Snooza",
}: {
  presets: SnoozePreset<K>[];
  disabled?: boolean;
  onPreset: (key: K) => void;
  onCustom: (value: { date: string; time: string }) => void;
  triggerClassName?: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [view, setView] = useState<"menu" | "picker">("menu");
  const [{ date, time }, setWhen] = useState(() => initialSnoozeDateTime());
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  function close() {
    setOpen(false);
    setView("menu");
  }

  function openMenu() {
    setSheet(isMobileSheet());
    setView("menu");
    setWhen(initialSnoozeDateTime());
    setOpen(true);
  }

  useEffect(() => {
    if (!open || sheet) return;
    function onPointer(e: PointerEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, sheet]);

  function choosePreset(key: K) {
    close();
    onPreset(key);
  }

  function confirmCustom() {
    if (!date || !time) return;
    close();
    onCustom({ date, time });
  }

  const itemCls = sheet
    ? "flex w-full min-h-12 items-center gap-2.5 px-6 py-3 text-left text-[15px] font-medium text-ink transition-colors hover:bg-canvas"
    : actionMenuItemClassName();

  const menuBody = (
    <>
      {view === "menu" ? (
        <>
          {presets.map((preset) => (
            <button
              key={preset.key}
              type="button"
              role="menuitem"
              className={itemCls}
              disabled={disabled}
              onClick={() => choosePreset(preset.key)}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className={itemCls}
            onClick={() => {
              setWhen(initialSnoozeDateTime());
              setView("picker");
            }}
          >
            Välj datum & tid…
          </button>
        </>
      ) : (
        <div className={sheet ? "px-4 pb-4 pt-1" : "p-2"}>
          <DateTimePicker
            mode="datetime"
            className={sheet ? "w-full" : undefined}
            date={date}
            time={time}
            min={toISODate(startOfToday())}
            onDateChange={(next) => setWhen((prev) => ({ ...prev, date: next }))}
            onTimeChange={(next) => setWhen((prev) => ({ ...prev, time: next }))}
            footer={
              <DateTimePickerActions
                confirmLabel="Snooza"
                confirmDisabled={disabled || !date || !isFutureLocalDateTime(date, time)}
                onCancel={() => setView("menu")}
                onConfirm={confirmCustom}
              />
            }
          />
        </div>
      )}
    </>
  );

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className={triggerClassName ?? cx(buttonClasses("secondary", "sm"), "max-lg:min-h-11")}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
      >
        {triggerLabel}
      </button>

      {open && !sheet ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Snooza till"
          className={cx(
            "absolute right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-line bg-card shadow-pop",
            view === "menu" ? "min-w-[13.5rem] p-1" : "p-0"
          )}
        >
          {view === "menu" ? (
            <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Snooza till
            </p>
          ) : (
            <p className="px-3 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Välj datum & tid
            </p>
          )}
          {menuBody}
        </div>
      ) : null}

      {sheet ? (
        <Modal
          open={open}
          onClose={close}
          title={view === "picker" ? "Välj datum & tid" : "Snooza till"}
          size="sm"
        >
          <div className="py-2" role="menu" aria-label="Snooza till">
            {menuBody}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
