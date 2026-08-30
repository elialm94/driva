"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";
import { switchClientAction, switchToAllClientsAction } from "@/app/collaboration-actions";
import { clientSwitchDestination, parseSelectedClientId } from "@/lib/collaboration/switch";
import { cx } from "./ui";

const SEARCH_AT = 8;

export function ClientSwitcher({
  clients,
  className,
}: {
  clients: { id: string; name: string }[];
  className?: string;
}) {
  const pathname = usePathname();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const selectedId = parseSelectedClientId(pathname);
  const selected = clients.find((c) => c.id === selectedId);
  const showSearch = clients.length >= SEARCH_AT;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(q));
  }, [clients, query]);

  const rows: { id: string | null; name: string }[] = [{ id: null, name: "Alla klienter" }, ...filtered];

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      if (showSearch) searchRef.current?.focus();
    });
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
  }, [open, showSearch]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  function choose(id: string | null) {
    setOpen(false);
    setQuery("");
    const dest = clientSwitchDestination(pathname, id);
    if (id) void switchClientAction(id, dest);
    else void switchToAllClientsAction(dest);
  }

  return (
    <div ref={rootRef} className={cx("relative", className)}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-card px-3 py-2 text-left text-[13px] font-medium text-ink"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate">{selected?.name ?? "Alla klienter"}</span>
        <ChevronDown className="size-4 shrink-0 text-muted" />
      </button>
      {open ? (
        <div className="absolute inset-x-0 top-full z-40 mt-1.5 overflow-hidden rounded-xl border border-line bg-card shadow-pop">
          {showSearch ? (
            <div className="relative border-b border-line">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Sök klient…"
                className="w-full bg-transparent py-2.5 pl-10 pr-3 text-[13px] outline-none"
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlight((h) => Math.min(h + 1, rows.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlight((h) => Math.max(h - 1, 0));
                  } else if (e.key === "Enter" && rows[highlight]) {
                    e.preventDefault();
                    choose(rows[highlight].id);
                  }
                }}
              />
            </div>
          ) : null}
          <ul id={listId} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {rows.map((row, i) => (
              <li key={row.id ?? "all"}>
                {i === 1 && !query ? <div className="my-1 border-t border-line" /> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={(row.id ?? "") === (selectedId ?? "")}
                  className={cx(
                    "flex w-full px-3 py-2 text-left text-[13px]",
                    i === highlight ? "bg-canvas" : "hover:bg-canvas",
                    (row.id ?? "") === (selectedId ?? "") ? "font-semibold" : "font-medium"
                  )}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => choose(row.id)}
                >
                  {row.name}
                </button>
              </li>
            ))}
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-[13px] text-muted">Ingen klient matchar.</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
