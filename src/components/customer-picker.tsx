"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus, Search } from "lucide-react";
import { cx } from "./ui";
import { NewCustomerModal, type CreatedCustomer } from "./new-customer-modal";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";

export interface CustomerOption {
  id: string;
  name: string;
  kind?: "privat" | "foretag";
}

export function addCustomerOption(list: CustomerOption[], customer: CustomerOption): CustomerOption[] {
  if (list.some((c) => c.id === customer.id)) return list;
  return [...list, customer].sort((a, b) => a.name.localeCompare(b.name, "sv"));
}

export function CustomerPicker({
  customers,
  value,
  onChange,
  allowCreateCustomer = true,
  disabled = false,
  name,
  onCreated,
  className,
}: {
  customers: CustomerOption[];
  value: string;
  onChange: (id: string) => void;
  allowCreateCustomer?: boolean;
  disabled?: boolean;
  /** Hidden input name so native forms still submit `customerId`. */
  name?: string;
  onCreated?: (customer: CreatedCustomer) => void;
  className?: string;
}) {
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [prefillName, setPrefillName] = useState("");

  const selected = customers.find((c) => c.id === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q));
  }, [customers, query]);

  const canCreate = allowCreateCustomer && !disabled;
  const optionCount = filtered.length + (canCreate ? 1 : 0);
  const createLabel = query.trim() ? `Skapa ”${query.trim()}” som ny kund` : "Skapa ny kund";
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
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
      setOpen(false);
      setQuery("");
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
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function openMenu() {
    if (disabled) return;
    const selectedIndex = customers.findIndex((c) => c.id === value);
    setHighlight(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function pick(id: string) {
    onChange(id);
    close();
  }

  function create() {
    if (!canCreate) return;
    const typed = query.trim();
    close();
    setPrefillName(typed);
    setCreateOpen(true);
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (disabled) return;
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
      if (canCreate && highlight >= filtered.length) create();
      else if (filtered[highlight]) pick(filtered[highlight].id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        className={cx(inputCls, "flex items-center justify-between gap-2 text-left disabled:opacity-60", className)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        role="combobox"
      >
        <span className={selected ? "truncate" : "truncate text-muted"}>{selected?.name ?? "Välj kund"}</span>
        <ChevronDown className={cx("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && menuPos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width, zIndex: 55 }}
              className="fixed flex max-h-80 flex-col overflow-hidden rounded-xl border border-line bg-card shadow-pop animate-fade-in"
            >
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
                  placeholder="Sök kund …"
                  className="w-full bg-transparent py-2.5 pl-10 pr-3.5 text-[14px] text-ink placeholder:text-muted"
                  autoComplete="off"
                  aria-autocomplete="list"
                />
              </div>
              <ul id={listId} role="listbox" className="max-h-52 overflow-y-auto py-1">
                {filtered.length === 0 ? (
                  <li className="px-3.5 py-2.5 text-[13px] text-muted">
                    {query.trim() ? `Ingen kund matchar ”${query.trim()}”` : "Inga kunder ännu"}
                  </li>
                ) : (
                  filtered.map((c, i) => (
                    <li key={c.id} role="option" aria-selected={c.id === value}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(c.id)}
                        onMouseEnter={() => setHighlight(i)}
                        className={cx(
                          "flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-[14px] transition-colors",
                          i === highlight ? "bg-canvas" : "bg-card"
                        )}
                      >
                        <span className="min-w-0 truncate font-medium text-ink">{c.name}</span>
                        {c.kind === "foretag" ? <span className="shrink-0 text-[12px] text-muted">Företag</span> : null}
                      </button>
                    </li>
                  ))
                )}
              </ul>
              {canCreate ? (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={create}
                  onMouseEnter={() => setHighlight(filtered.length)}
                  className={cx(
                    "flex w-full items-center gap-2 border-t border-line px-3.5 py-2.5 text-left text-[14px] font-medium text-accent transition-colors",
                    highlight === filtered.length ? "bg-accent-soft" : "bg-canvas/60 hover:bg-accent-soft"
                  )}
                >
                  <Plus className="size-4 shrink-0" /> {createLabel}
                </button>
              ) : null}
            </div>,
            document.body
          )
        : null}

      {canCreate ? (
        <NewCustomerModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          initialName={prefillName}
          onCreated={(customer) => {
            onCreated?.(customer);
            onChange(customer.id);
          }}
        />
      ) : null}
    </div>
  );
}
