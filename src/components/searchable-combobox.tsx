"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";
import { cx } from "./ui";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";

export type ComboboxOption = {
  id: string;
  title: string;
  subtitle?: string;
};

const SEARCH_FROM_COUNT = 5;

/**
 * Samma krom som kundväljaren: knapp + portal-lista, sök när det finns
 * fler än några rader, valfri sista-rad-åtgärd.
 */
export function SearchableCombobox({
  id,
  options,
  value,
  onChange,
  emptyLabel,
  searchPlaceholder = "Sök …",
  footer,
  className,
}: {
  id?: string;
  options: ComboboxOption[];
  value: string;
  onChange: (id: string) => void;
  emptyLabel: string;
  searchPlaceholder?: string;
  footer?: { label: ReactNode; onSelect: () => void };
  className?: string;
}) {
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const selected = options.find((o) => o.id === value);
  const searchable = options.length >= SEARCH_FROM_COUNT;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.title.toLowerCase().includes(q) || (o.subtitle ?? "").toLowerCase().includes(q)
    );
  }, [options, query]);

  const footerIndex = footer ? filtered.length : -1;
  const optionCount = filtered.length + (footer ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      if (searchable) searchRef.current?.focus();
    });
    function syncPos() {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 6, left: r.left, width: r.width });
    }
    syncPos();
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (containerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", syncPos);
    document.addEventListener("scroll", syncPos, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", syncPos);
      document.removeEventListener("scroll", syncPos, true);
    };
  }, [open, searchable]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function openMenu() {
    const selectedIndex = options.findIndex((o) => o.id === value);
    setHighlight(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function pick(id: string) {
    onChange(id);
    close();
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(optionCount - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (footer && highlight === footerIndex) {
        close();
        footer.onSelect();
      } else if (filtered[highlight]) pick(filtered[highlight].id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        className={cx(inputCls, "flex items-center justify-between gap-2 text-left", className)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        role="combobox"
      >
        <span className={selected ? "min-w-0 truncate" : "truncate text-muted"}>
          {selected ? selected.title : emptyLabel}
        </span>
        <ChevronDown className={cx("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && menuPos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width, zIndex: 55 }}
              className="fixed flex max-h-80 flex-col overflow-hidden rounded-xl border border-line bg-card shadow-pop animate-fade-in"
            >
              {searchable ? (
                <div className="relative border-b border-line">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setHighlight(0);
                    }}
                    onKeyDown={onKeyDown}
                    placeholder={searchPlaceholder}
                    className="w-full bg-transparent py-2.5 pl-10 pr-3.5 text-[14px] text-ink placeholder:text-muted"
                    autoComplete="off"
                    aria-autocomplete="list"
                  />
                </div>
              ) : null}
              <ul id={listId} role="listbox" className="max-h-52 overflow-y-auto py-1">
                {filtered.length === 0 ? (
                  <li className="px-3.5 py-2.5 text-[13px] text-muted">
                    {query.trim() ? `Ingen träff på ”${query.trim()}”` : "Inga alternativ"}
                  </li>
                ) : (
                  filtered.map((option, i) => (
                    <li key={option.id} role="option" aria-selected={option.id === value}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(option.id)}
                        onMouseEnter={() => setHighlight(i)}
                        className={cx(
                          "flex w-full flex-col items-start gap-0.5 px-3.5 py-2.5 text-left text-[14px] transition-colors",
                          i === highlight ? "bg-canvas" : "bg-card"
                        )}
                      >
                        <span className="min-w-0 font-medium text-ink">{option.title}</span>
                        {option.subtitle ? <span className="text-[12px] text-muted">{option.subtitle}</span> : null}
                      </button>
                    </li>
                  ))
                )}
              </ul>
              {footer ? (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    close();
                    footer.onSelect();
                  }}
                  onMouseEnter={() => setHighlight(footerIndex)}
                  className={cx(
                    "flex w-full items-center gap-2 border-t border-line px-3.5 py-2.5 text-left text-[14px] font-medium text-accent transition-colors",
                    highlight === footerIndex ? "bg-accent-soft" : "bg-canvas/60 hover:bg-accent-soft"
                  )}
                >
                  {footer.label}
                </button>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
