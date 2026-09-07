"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { AppLink } from "./app-link";
import { cx } from "./ui-classes";

/*
 * Ett gemensamt sätt att bekräfta det som just hände: "Raden borttagen – Ångra",
 * "Banken är kopplad", "Kundlänken är kopierad". Toasten ligger ovanför
 * bottennavet på mobil och centrerad över innehållsytan på desktop, läses upp
 * av skärmläsare (aria-live) och pausar nedräkningen när muspekaren vilar på
 * den. Formulärfel och sparstatus hör hemma inline vid fältet – inte här.
 */

export type ToastTone = "neutral" | "ok" | "danger";

export interface ToastAction {
  label: string;
  /** Knapp – t.ex. Ångra. */
  onClick?: () => void;
  /** Länk – t.ex. "Visa fakturan". Används om onClick saknas. */
  href?: string;
}

export interface ToastInput {
  /** Kort huvudbudskap i presens perfekt: "Fakturan skickades". */
  title: string;
  /** Rad två – mottagare, belopp eller vad som händer härnäst. */
  text?: string;
  tone?: ToastTone;
  action?: ToastAction;
  /** Visningstid i ms. 0 = tills användaren stänger. Standard 5 s, 8 s med åtgärd. */
  duration?: number;
  /** Samma id ersätter en synlig toast i stället för att stapla en ny (t.ex. upprepad radering). */
  id?: string;
}

interface ToastItem {
  id: string;
  title: string;
  text?: string;
  tone: ToastTone;
  action?: ToastAction;
  duration: number;
}

interface ToastApi {
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
}

export const TOAST_DEFAULT_MS = 5000;
export const TOAST_WITH_ACTION_MS = 8000;
/** Fler än så här och de äldsta försvinner – skärmen ska inte fyllas av bekräftelser. */
export const TOAST_MAX_VISIBLE = 3;

const noop: ToastApi = { toast: () => "", dismiss: () => {} };
const ToastContext = createContext<ToastApi>(noop);

/** Utanför appskalet (publika sidor) finns ingen provider – anropen är då tysta. */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setItems((list) => (list.some((t) => t.id === id) ? list.filter((t) => t.id !== id) : list));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = input.id ?? `toast-${++counter.current}`;
    const item: ToastItem = {
      id,
      title: input.title,
      text: input.text,
      tone: input.tone ?? "neutral",
      action: input.action,
      duration: input.duration ?? (input.action ? TOAST_WITH_ACTION_MS : TOAST_DEFAULT_MS),
    };
    setItems((list) => [...list.filter((t) => t.id !== id), item].slice(-TOAST_MAX_VISIBLE));
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      data-toast-viewport
      className={cx(
        "no-print pointer-events-none fixed inset-x-0 z-[100] flex flex-col items-center gap-2 px-4",
        // Ovanför bottennavet (+ safe area) på mobil; på desktop centrerad över innehållet bredvid sidomenyn.
        "bottom-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+0.75rem)] lg:bottom-6 lg:pl-60",
      )}
    >
      {items.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const [paused, setPaused] = useState(false);

  // `item` byts ut när en toast med samma id ersätts – nedräkningen börjar då om.
  useEffect(() => {
    if (paused || item.duration === 0) return;
    const timer = window.setTimeout(() => onDismiss(item.id), item.duration);
    return () => window.clearTimeout(timer);
  }, [item, paused, onDismiss]);

  const Icon = item.tone === "danger" ? AlertTriangle : item.tone === "ok" ? Check : null;
  const action = item.action;

  return (
    <div
      data-toast
      data-toast-tone={item.tone}
      className={cx(
        "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl px-4 py-3 text-[14px] text-white shadow-pop animate-fade-up",
        item.tone === "danger" ? "bg-danger" : "bg-ink",
      )}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      {Icon ? (
        <span
          className={cx(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
            item.tone === "danger" ? "bg-white/20" : "bg-ok",
          )}
        >
          <Icon className="size-3.5" strokeWidth={2.5} />
        </span>
      ) : null}
      <div className="min-w-0 flex-1 py-0.5">
        <p className="font-medium leading-snug">{item.title}</p>
        {item.text ? <p className="mt-0.5 text-[13px] leading-snug text-white/75">{item.text}</p> : null}
      </div>
      {action ? (
        action.onClick || !action.href ? (
          <button
            type="button"
            className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-[13px] font-semibold hover:bg-white/25"
            onClick={() => {
              action.onClick?.();
              onDismiss(item.id);
            }}
          >
            {action.label}
          </button>
        ) : (
          <AppLink
            href={action.href}
            className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-[13px] font-semibold hover:bg-white/25"
            onClick={() => onDismiss(item.id)}
          >
            {action.label}
          </AppLink>
        )
      ) : null}
      <button
        type="button"
        aria-label="Stäng"
        className="-mr-1 shrink-0 rounded-lg p-1 text-white/60 hover:bg-white/15 hover:text-white"
        onClick={() => onDismiss(item.id)}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
