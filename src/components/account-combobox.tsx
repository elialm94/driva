"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cx } from "./ui";
import type { KontoOption } from "@/lib/services/verification-correction";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2.5 text-[14px] text-ink placeholder:text-muted focus:border-accent";

export function AccountCombobox({
  options,
  value,
  onChange,
  placeholder = "Sök konto eller namn…",
  emptyLabel = "Välj kostnadskonto",
}: {
  options: KontoOption[];
  value: string;
  onChange: (key: string) => void;
  placeholder?: string;
  /** Texten innan något valts. Kontoväljaren används både för kostnader och hela registret. */
  emptyLabel?: string;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const selected = options.find((o) => o.key === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.key.includes(q) ||
        String(o.account).includes(q)
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    function onPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={cx(inputCls, "flex items-center justify-between gap-2 text-left")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={selected ? "text-ink" : "text-muted"}>
          {selected ? selected.label : emptyLabel}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted" />
      </button>
      {open ? (
        <div className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-line bg-card shadow-pop">
          <div className="relative border-b border-line">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full bg-transparent py-2.5 pl-10 pr-3 text-[14px] outline-none"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlight((h) => Math.min(h + 1, filtered.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlight((h) => Math.max(h - 1, 0));
                } else if (e.key === "Enter" && filtered[highlight]) {
                  e.preventDefault();
                  onChange(filtered[highlight].key);
                  setOpen(false);
                  setQuery("");
                }
              }}
            />
          </div>
          <ul id={listId} role="listbox" className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-[13px] text-muted">Inget konto matchar.</li>
            ) : (
              filtered.map((o, i) => (
                <li key={o.key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.key === value}
                    className={cx(
                      "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-[14px]",
                      i === highlight ? "bg-canvas" : "hover:bg-canvas"
                    )}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => {
                      onChange(o.key);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <span className="font-medium">{o.label}</span>
                    {o.key === value ? <span className="text-[12px] text-muted">Vald</span> : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
