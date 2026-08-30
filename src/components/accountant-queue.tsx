"use client";

import { useEffect, useRef } from "react";
import { AttentionSection } from "./attention-list";
import type { BusinessAction } from "@/lib/services/actions";

export type AccountantQueueItem = BusinessAction & { clientName?: string };

/**
 * Kö för redovisningskonsulten: samma åtgärdsrader som motorn, plus
 * tangentbord (J/K, Enter, Esc, 1–4 för val) och nästa undantag.
 */
export function AccountantQueue({
  title,
  items,
  initialVisible,
  empty,
}: {
  title: string;
  items: AccountantQueueItem[];
  initialVisible?: number;
  empty?: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);

  useEffect(() => {
    function rows(): HTMLElement[] {
      return [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-action-id]") ?? [])];
    }
    function focusAt(i: number) {
      const list = rows();
      if (list.length === 0) return;
      const next = ((i % list.length) + list.length) % list.length;
      indexRef.current = next;
      list[next]?.scrollIntoView({ block: "nearest" });
      list[next]?.focus();
    }
    function onKey(e: KeyboardEvent) {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        focusAt(indexRef.current + 1);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        focusAt(indexRef.current - 1);
      } else if (e.key === "Enter") {
        const row = rows()[indexRef.current];
        const btn = row?.querySelector<HTMLButtonElement>("button:not([disabled])");
        const link = row?.querySelector<HTMLAnchorElement>("a");
        if (btn) btn.click();
        else if (link) link.click();
      } else if (e.key === "Escape") {
        (document.activeElement as HTMLElement | null)?.blur();
      } else if (/^[1-4]$/.test(e.key)) {
        const row = rows()[indexRef.current] ?? document.activeElement?.closest("[data-action-id]");
        const choice = row?.querySelector<HTMLButtonElement>(`[data-choice-index="${e.key}"]`);
        if (choice && !choice.disabled) {
          e.preventDefault();
          choice.click();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length]);

  const remaining = items.length;
  const heading = remaining > 0 ? `${title} · ${remaining} ${remaining === 1 ? "sak kvar" : "saker kvar"}` : title;

  return (
    <div ref={rootRef}>
      <p className="mb-1.5 text-[11px] text-muted">J/K nästa · Enter · Esc · 1–4 väljer alternativ</p>
      <AttentionSection title={heading} items={items} initialVisible={initialVisible} surface="accountant" empty={empty} />
    </div>
  );
}
