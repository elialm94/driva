"use client";

import { useEffect, useState, useTransition, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import {
  discardInvoiceAction,
  discardQuoteAction,
  restoreInvoiceDraftAction,
  restoreQuoteDraftAction,
} from "@/app/actions";
import type { DiscardedInvoiceSnapshot } from "@/lib/services/invoices";
import type { DiscardedQuoteSnapshot } from "@/lib/services/quotes";
import { AppLink } from "./app-link";
import { Modal } from "./modal";
import { buttonClasses, cx } from "./ui";

export type DraftDocumentKind = "quote" | "invoice";

type DraftSnapshot = DiscardedQuoteSnapshot | DiscardedInvoiceSnapshot;

export const DRAFT_COPY = {
  quote: {
    edit: "Redigera offert",
    discard: "Kasta utkast",
    discardAria: "Kasta offertutkast",
    confirmTitle: "Kasta offertutkast?",
    confirmBody: "Utkastet tas bort.",
    toast: "Offertutkast kastat",
    listHref: "/ekonomi?flik=offerter",
    editHref: (id: string) => `/ekonomi/offerter/${id}/redigera`,
  },
  invoice: {
    edit: "Redigera faktura",
    discard: "Kasta utkast",
    discardAria: "Kasta fakturautkast",
    confirmTitle: "Kasta fakturautkast?",
    confirmBody: "Utkastet tas bort.",
    toast: "Fakturautkast kastat",
    listHref: "/ekonomi?flik=fakturor",
    editHref: (id: string) => `/ekonomi/fakturor/${id}/redigera`,
  },
} as const;

const TOAST_KEY = "driva:draft-discard-toast";
const TOAST_TTL_MS = 60_000;

type StoredToast = {
  kind: DraftDocumentKind;
  snapshot: DraftSnapshot;
};

type ToastListener = (toast: StoredToast | null) => void;
const toastListeners = new Set<ToastListener>();

function writeToast(payload: StoredToast) {
  try {
    sessionStorage.setItem(TOAST_KEY, JSON.stringify({ ...payload, at: Date.now() }));
  } catch {
    /* privat läge / full lagring – toasten är extra, inte nödvändig */
  }
}

function readToast(): StoredToast | null {
  try {
    const raw = sessionStorage.getItem(TOAST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredToast & { at?: number };
    if (!parsed?.kind || !parsed.snapshot) return null;
    if (parsed.at && Date.now() - parsed.at > TOAST_TTL_MS) {
      sessionStorage.removeItem(TOAST_KEY);
      return null;
    }
    return { kind: parsed.kind, snapshot: parsed.snapshot };
  } catch {
    return null;
  }
}

function clearToast() {
  try {
    sessionStorage.removeItem(TOAST_KEY);
  } catch {
    /* ignore */
  }
}

function publishToast(payload: StoredToast | null) {
  if (payload) writeToast(payload);
  else clearToast();
  for (const listener of toastListeners) listener(payload);
}

function stopRowNav(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

async function discardDraft(kind: DraftDocumentKind, id: string) {
  return kind === "quote" ? discardQuoteAction(id) : discardInvoiceAction(id);
}

async function restoreDraft(kind: DraftDocumentKind, snapshot: DraftSnapshot) {
  return kind === "quote"
    ? restoreQuoteDraftAction(snapshot as DiscardedQuoteSnapshot)
    : restoreInvoiceDraftAction(snapshot as DiscardedInvoiceSnapshot);
}

function DiscardConfirmModal({
  kind,
  open,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  kind: DraftDocumentKind;
  open: boolean;
  pending: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const copy = DRAFT_COPY[kind];
  return (
    <Modal open={open} onClose={() => !pending && onClose()} size="sm" title={copy.confirmTitle}>
      <div className="px-6 py-5">
        <p className="text-[15px] leading-relaxed text-soft">{copy.confirmBody}</p>
        {error ? <p className="mt-3 text-[13px] font-medium text-danger">{error}</p> : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={buttonClasses("secondary")} disabled={pending} onClick={onClose}>
            Avbryt
          </button>
          <button type="button" className={buttonClasses("danger")} disabled={pending} onClick={onConfirm}>
            {pending ? "Kastar …" : copy.discard}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function useDiscardDraft(kind: DraftDocumentKind, id: string, after: "stay" | "list") {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await discardDraft(kind, id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      publishToast({ kind, snapshot: result.snapshot });
      setConfirming(false);
      if (after === "list") {
        router.push(DRAFT_COPY[kind].listHref as never);
      } else {
        router.refresh();
      }
    });
  }

  return { confirming, setConfirming, error, pending, confirm };
}

const iconBtn =
  "relative z-20 inline-flex size-9 items-center justify-center rounded-lg text-soft transition-colors hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:size-8";

export function DraftRowActions({
  kind,
  id,
}: {
  kind: DraftDocumentKind;
  id: string;
  /** Kvar för anropare; ikonerna är alltid synliga så de inte göms av hover/overflow. */
  alwaysVisible?: boolean;
}) {
  const copy = DRAFT_COPY[kind];
  const { confirming, setConfirming, error, pending, confirm } = useDiscardDraft(kind, id, "stay");

  return (
    <div
      className="relative z-20 flex shrink-0 items-center justify-end gap-0.5"
      onClick={stopRowNav}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <AppLink
        href={copy.editHref(id)}
        aria-label={copy.edit}
        title={copy.edit}
        className={iconBtn}
        onClick={(e) => e.stopPropagation()}
      >
        <Pencil className="size-4" />
      </AppLink>
      <button
        type="button"
        aria-label={copy.discardAria}
        title={copy.discardAria}
        className={cx(iconBtn, "hover:bg-danger-soft hover:text-danger")}
        onClick={(e) => {
          stopRowNav(e);
          setConfirming(true);
        }}
      >
        <Trash2 className="size-4" />
      </button>
      <DiscardConfirmModal
        kind={kind}
        open={confirming}
        pending={pending}
        error={error}
        onClose={() => !pending && setConfirming(false)}
        onConfirm={confirm}
      />
    </div>
  );
}

export function DiscardDraftButton({
  kind,
  id,
  after = "list",
}: {
  kind: DraftDocumentKind;
  id: string;
  after?: "stay" | "list";
}) {
  const copy = DRAFT_COPY[kind];
  const { confirming, setConfirming, error, pending, confirm } = useDiscardDraft(kind, id, after);

  return (
    <>
      <button type="button" className={buttonClasses("ghost")} onClick={() => setConfirming(true)}>
        {copy.discard}
      </button>
      <DiscardConfirmModal
        kind={kind}
        open={confirming}
        pending={pending}
        error={error}
        onClose={() => !pending && setConfirming(false)}
        onConfirm={confirm}
      />
    </>
  );
}

export function DraftDiscardToastHost({ kind }: { kind: DraftDocumentKind }) {
  const router = useRouter();
  const [toast, setToast] = useState<StoredToast | null>(null);
  const [undoing, startUndo] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = readToast();
    if (stored?.kind === kind) {
      clearToast();
      setToast(stored);
    }
    const onToast: ToastListener = (next) => {
      if (!next || next.kind === kind) setToast(next);
    };
    toastListeners.add(onToast);
    return () => {
      toastListeners.delete(onToast);
    };
  }, [kind]);

  useEffect(() => {
    if (!toast) return;
    const handle = window.setTimeout(() => setToast(null), 10_000);
    return () => window.clearTimeout(handle);
  }, [toast]);

  if (!toast) return null;
  const copy = DRAFT_COPY[toast.kind];

  function undo() {
    if (!toast) return;
    setError(null);
    startUndo(async () => {
      const result = await restoreDraft(toast.kind, toast.snapshot);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      publishToast(null);
      setToast(null);
      router.refresh();
    });
  }

  return (
    <div
      role="status"
      className="fixed bottom-20 left-1/2 z-50 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-line bg-ink px-4 py-3 text-[14px] text-white shadow-pop md:bottom-6"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 font-medium">
          {copy.toast}
          <span className="text-white/50"> · </span>
          <button
            type="button"
            className="font-semibold text-white underline decoration-white/40 underline-offset-2 hover:decoration-white disabled:opacity-60"
            disabled={undoing}
            onClick={undo}
          >
            {undoing ? "Ångrar …" : "Ångra"}
          </button>
        </p>
      </div>
      {error ? <p className="mt-1.5 text-[13px] text-danger-soft">{error}</p> : null}
    </div>
  );
}

