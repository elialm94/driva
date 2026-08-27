"use client";

import {
  Children,
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MoreHorizontal } from "lucide-react";
import { cx } from "./ui";

export type ActionAppearance = "button" | "menu";

const ActionMenuContext = createContext<{ close: () => void } | null>(null);

export function useActionMenu() {
  return useContext(ActionMenuContext);
}

export function actionMenuItemClassName(opts?: { danger?: boolean }) {
  return cx(
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors hover:bg-canvas",
    opts?.danger ? "text-danger hover:bg-danger-soft" : "text-ink"
  );
}

export function PageActions({ children }: { children: ReactNode }) {
  return <div className="flex max-w-full flex-wrap items-center justify-end gap-2">{children}</div>;
}

export function ActionMenu({ children, label = "Fler åtgärder" }: { children: ReactNode; label?: string }) {
  const visible = Children.toArray(children);
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
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
  }, [open]);

  if (visible.length === 0) return null;

  return (
    <ActionMenuContext.Provider value={{ close }}>
      <div ref={rootRef} className="relative shrink-0">
        <button
          type="button"
          className={cx(
            "inline-flex size-10 items-center justify-center rounded-xl border border-line-strong bg-card text-ink transition-all duration-150",
            "hover:bg-canvas hover:border-muted/60 active:scale-[0.98]",
            open && "bg-canvas"
          )}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={id}
          aria-label={label}
          onClick={() => setOpen((v) => !v)}
        >
          <MoreHorizontal className="size-5" />
        </button>
        <div
          id={id}
          role="menu"
          aria-hidden={!open}
          className={cx(
            "absolute right-0 top-full z-30 mt-1.5 min-w-[15.5rem] overflow-hidden rounded-xl border border-line bg-card p-1 shadow-pop",
            !open && "hidden"
          )}
        >
          {children}
        </div>
      </div>
    </ActionMenuContext.Provider>
  );
}
