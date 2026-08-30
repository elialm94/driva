"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Modal } from "./modal";
import { buttonClasses, cx } from "./ui";
import {
  confirmChangedSupplierDetailsAction,
  requestSupplierDetailsAction,
  useVerifiedSupplierDetailsAction,
  verifySupplierPaymentDetailsAction,
} from "@/app/actions";
import type { ActionConfirm, ActionCta, PaymentDetailsQueueItem } from "@/lib/services/actions";
import type { PaymentDetailsMethod } from "@/lib/types";

/**
 * Lösningsflödena för leverantörsfakturors betalningsuppgifter:
 *
 *   * Kontrollera/ange uppgifter (osäker läsning eller manuell komplettering)
 *     – fokuserad formulärdialog, godkännandet sätter proveniens.
 *   * Återanvänd tidigare verifierade uppgifter – bekräftelse med proveniens.
 *   * Godkänn ÄNDRAD destination – explicit bekräftelse, aldrig automatik.
 *   * Be leverantören via mejl – förhandsvisning + [Avbryt][Skicka] eftersom
 *     det är ett externt utskick.
 *   * Kön "N leverantörsfakturor behöver betalningsuppgifter" – stegar genom
 *     SAMMA underliggande åtgärder, ingen parallell modell.
 *
 * All domänlogik bor i server actions → services; här finns bara dialoger.
 */

const METHODS: { value: PaymentDetailsMethod; label: string; placeholder: string }[] = [
  { value: "bankgiro", label: "Bankgiro", placeholder: "123-4567" },
  { value: "plusgiro", label: "Plusgiro", placeholder: "12 34 56-7" },
  { value: "iban", label: "IBAN", placeholder: "SE12 3000 0000 0301 2345 6789" },
];

const inputCls =
  "mt-1 w-full rounded-xl border border-line bg-card px-3 py-2 text-[14px] text-ink outline-none focus:border-accent";

type Done = (doneText: string) => void;

/* ------------------------------ Formulärdialogen ------------------------------ */

/**
 * "Kontrollera betalningsuppgifter" / "Lägg till betalningsuppgifter":
 * betalsätt + nummer + OCR. Kandidat ur dokumentet förifylls (aldrig en
 * gissning som smygs in – människan ser och godkänner varje fält).
 */
export function PaymentDetailsFormDialog({
  open,
  onClose,
  supplierInvoiceId,
  title,
  candidateAccount,
  candidateOcr,
  note,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  supplierInvoiceId: string;
  title: string;
  candidateAccount?: string;
  candidateOcr?: string;
  note?: string;
  onDone: Done;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [method, setMethod] = useState<PaymentDetailsMethod>("bankgiro");
  const [account, setAccount] = useState(candidateAccount ?? "");
  const [ocr, setOcr] = useState(candidateOcr ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    startTransition(async () => {
      const result = await verifySupplierPaymentDetailsAction({
        supplierInvoiceId,
        method,
        account,
        ocr: ocr.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
      onDone("Uppgifterna godkända");
      router.refresh();
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={cx(buttonClasses("ghost", "sm"), "max-lg:min-h-11")} onClick={onClose}>
            Avbryt
          </button>
          <button
            type="button"
            className={cx(buttonClasses("primary", "sm"), "max-lg:min-h-11")}
            disabled={pending || !account.trim()}
            onClick={submit}
          >
            {pending ? "Sparar …" : "Godkänn"}
          </button>
        </div>
      }
    >
      <div className="space-y-3 px-6 py-4">
        {note ? <p className="text-[13px] leading-relaxed text-soft">{note}</p> : null}
        <label className="block text-[13px] font-medium text-muted">
          Betalsätt
          <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as PaymentDetailsMethod)}>
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[13px] font-medium text-muted">
          {METHODS.find((m) => m.value === method)!.label}
          <input
            className={inputCls}
            value={account}
            placeholder={METHODS.find((m) => m.value === method)!.placeholder}
            onChange={(e) => setAccount(e.target.value)}
          />
        </label>
        <label className="block text-[13px] font-medium text-muted">
          OCR/referens (valfritt)
          <input className={inputCls} value={ocr} onChange={(e) => setOcr(e.target.value)} />
        </label>
        {error ? <p className="text-[13px] font-medium text-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}

/* ------------------------------- Bekräftelsedialog ------------------------------ */

function ConfirmRowsDialog({
  open,
  onClose,
  confirm,
  note,
  pending,
  onConfirm,
  error,
}: {
  open: boolean;
  onClose: () => void;
  confirm: ActionConfirm;
  note?: string;
  pending: boolean;
  onConfirm: () => void;
  error: string | null;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={confirm.title}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={cx(buttonClasses("ghost", "sm"), "max-lg:min-h-11")} onClick={onClose}>
            Avbryt
          </button>
          <button
            type="button"
            className={cx(buttonClasses("primary", "sm"), "max-lg:min-h-11")}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "Skickar …" : confirm.confirmLabel}
          </button>
        </div>
      }
    >
      <div className="px-6 py-4">
        <dl className="space-y-2">
          {confirm.rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-4 text-[14px]">
              <dt className="shrink-0 text-muted">{row.label}</dt>
              <dd className="min-w-0 text-right font-medium text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
        {note ? <p className="mt-3 text-[13px] leading-relaxed text-soft">{note}</p> : null}
        {error ? <p className="mt-2 text-[13px] font-medium text-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}

/* ------------------------------ CTA:erna på en rad ------------------------------ */

export type PaymentDetailsCtaType = Extract<
  ActionCta,
  {
    type:
      | "verifyPaymentDetails"
      | "useVerifiedSupplierDetails"
      | "confirmChangedSupplierDetails"
      | "requestSupplierDetails"
      | "paymentDetailsQueue";
  }
>;

export function isPaymentDetailsCta(cta: ActionCta): cta is PaymentDetailsCtaType {
  return (
    cta.type === "verifyPaymentDetails" ||
    cta.type === "useVerifiedSupplierDetails" ||
    cta.type === "confirmChangedSupplierDetails" ||
    cta.type === "requestSupplierDetails" ||
    cta.type === "paymentDetailsQueue"
  );
}

/**
 * Primärknappen för en betalningsuppgifts-rad i uppmärksamhetslistan.
 * Bekräftelseinnehållet kommer från åtgärdsmotorn (action.confirm).
 */
export function PaymentDetailsCta({
  cta,
  title,
  confirm,
  surface,
  onDone,
}: {
  cta: PaymentDetailsCtaType;
  title: string;
  confirm?: ActionConfirm;
  surface: "owner" | "accountant";
  onDone: Done;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"none" | "form" | "confirm" | "queue">("none");
  const [error, setError] = useState<string | null>(null);

  function runConfirmed(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, doneText: string) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDialog("none");
      onDone(doneText);
      router.refresh();
    });
  }

  // Ändrad destination godkänns av den som får skicka pengar – inte konsulten.
  if (cta.type === "confirmChangedSupplierDetails" && surface === "accountant") {
    return <span className="text-[13px] text-soft">Ägaren godkänner nya uppgifter</span>;
  }

  const compact = surface === "accountant";
  const buttonCls = cx(buttonClasses(compact ? "secondary" : "primary", "sm"), "max-lg:min-h-11");

  if (cta.type === "paymentDetailsQueue") {
    return (
      <>
        <button type="button" className={buttonCls} aria-label={`${cta.label} – ${title}`} onClick={() => setDialog("queue")}>
          {cta.label}
        </button>
        <PaymentDetailsQueueDialog
          open={dialog === "queue"}
          onClose={() => setDialog("none")}
          items={cta.items}
          onAllDone={() => {
            setDialog("none");
            onDone("Hanterade");
          }}
        />
      </>
    );
  }

  if (cta.type === "verifyPaymentDetails") {
    return (
      <>
        <button type="button" className={buttonCls} aria-label={`${cta.label} – ${title}`} onClick={() => setDialog("form")}>
          {cta.label}
        </button>
        <PaymentDetailsFormDialog
          open={dialog === "form"}
          onClose={() => setDialog("none")}
          supplierInvoiceId={cta.supplierInvoiceId}
          title="Kontrollera betalningsuppgifter"
          candidateAccount={cta.candidateAccount}
          candidateOcr={cta.candidateOcr}
          note="Jämför med dokumentet innan du godkänner – uppgifterna styr vart pengarna skickas."
          onDone={onDone}
        />
      </>
    );
  }

  // useVerifiedSupplierDetails / confirmChangedSupplierDetails / requestSupplierDetails
  // bekräftas mot motorns confirm-innehåll.
  const fallbackConfirm: ActionConfirm = confirm ?? {
    title: "Bekräfta",
    rows: [],
    confirmLabel: "Bekräfta",
  };
  const note =
    cta.type === "confirmChangedSupplierDetails"
      ? "Kontrollera mot fakturan att de nya uppgifterna verkligen kommer från leverantören. Godkännandet gör fakturan betalbar."
      : cta.type === "requestSupplierDetails"
        ? "Mejlet skickas till leverantören. Fakturan markeras som Väntar på leverantören tills svar kommer."
        : "Uppgifterna hämtas från leverantörens tidigare verifierade betalning – aldrig från en osäker tolkning.";

  function execute() {
    if (cta.type === "useVerifiedSupplierDetails") {
      runConfirmed(() => useVerifiedSupplierDetailsAction(cta.supplierInvoiceId), "Uppgifterna återanvända");
    } else if (cta.type === "confirmChangedSupplierDetails") {
      runConfirmed(() => confirmChangedSupplierDetailsAction(cta.supplierInvoiceId), "Uppgifterna godkända");
    } else if (cta.type === "requestSupplierDetails") {
      runConfirmed(() => requestSupplierDetailsAction(cta.supplierInvoiceId), "Förfrågan skickad");
    }
  }

  return (
    <>
      <button
        type="button"
        className={buttonCls}
        disabled={pending}
        aria-label={`${cta.label} – ${title}`}
        onClick={() => {
          setError(null);
          setDialog("confirm");
        }}
      >
        {cta.label}
      </button>
      <ConfirmRowsDialog
        open={dialog === "confirm"}
        onClose={() => setDialog("none")}
        confirm={fallbackConfirm}
        note={note}
        pending={pending}
        onConfirm={execute}
        error={error}
      />
    </>
  );
}

/* ------------------------- Panel i Inbox/Ekonomi-detaljen ------------------------ */

export interface PaymentDetailsPanelProps {
  supplierInvoiceId: string;
  supplier: string;
  amountText: string;
  cause: "EXTRACTION_UNCERTAIN" | "MISSING" | "AWAITING_SUPPLIER" | "CHANGED";
  candidateAccount?: string;
  candidateOcr?: string;
  /** Kontot på den nya fakturan (CHANGED). */
  currentAccount?: string;
  /** Tidigare verifierat konto hos leverantören. */
  previousAccount?: string;
  previousVerifiedVia?: string;
  /** Skickad förfrågan (AWAITING_SUPPLIER). */
  requestTo?: string;
  requestSentAtText?: string;
  /** Kan Driva be leverantören via mejl? */
  requestPossible: boolean;
  requestMessageExcerpt?: string;
  /** Ärlig degradering – varför mejlknappen inte erbjuds. */
  requestUnavailableReason?: string;
}

/**
 * Lösningspanelen på dokument-/fakturadetaljen: visar ORSAKEN i klartext och
 * erbjuder de konkreta vägarna framåt. Källvyn har alltid alla vägar (även
 * manuell komplettering som inte är primär CTA på Hem).
 */
export function SupplierPaymentDetailsPanel(props: PaymentDetailsPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"none" | "form" | "reuse" | "changed" | "request">("none");
  const [doneText, setDoneText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const danger = props.cause === "CHANGED";

  if (doneText) {
    return (
      <div className="rounded-2xl border border-line bg-ok-soft/40 px-4 py-3">
        <p className="flex items-center gap-1.5 text-[14px] font-medium text-ok">
          <Check className="size-4" /> {doneText}
        </p>
      </div>
    );
  }

  const heading =
    props.cause === "CHANGED"
      ? "Nya betalningsuppgifter – kontrollera innan betalning"
      : props.cause === "EXTRACTION_UNCERTAIN"
        ? "Betalningsuppgifterna kunde inte läsas säkert"
        : props.cause === "AWAITING_SUPPLIER"
          ? "Väntar på betalningsuppgifter från leverantören"
          : "Betalningsuppgifter saknas på fakturan";

  const detail =
    props.cause === "CHANGED"
      ? `Tidigare verifierat: ${props.previousAccount ?? "—"} · På nya fakturan: ${props.currentAccount ?? "—"}. Fakturan kan inte betalas förrän du godkänt ändringen.`
      : props.cause === "EXTRACTION_UNCERTAIN"
        ? `Läst ur dokumentet: ${props.candidateAccount ?? "—"}${props.candidateOcr ? ` · OCR ${props.candidateOcr}` : ""}. Kontrollera mot dokumentet och godkänn.`
        : props.cause === "AWAITING_SUPPLIER"
          ? `Frågan skickades${props.requestSentAtText ? ` ${props.requestSentAtText}` : ""}${props.requestTo ? ` till ${props.requestTo}` : ""}. Du kan också lägga till uppgifterna själv.`
          : "Dokumentet innehåller inga betalningsuppgifter. Fakturan kan inte betalas förrän de finns.";

  function runConfirmed(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, text: string) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDialog("none");
      setDoneText(text);
      router.refresh();
    });
  }

  const secondaryBtn = cx(buttonClasses("secondary", "sm"), "max-lg:min-h-11");
  const primaryBtn = cx(buttonClasses("primary", "sm"), "max-lg:min-h-11");

  return (
    <div
      className={cx(
        "rounded-2xl border px-4 py-3.5",
        danger ? "border-danger/30 bg-danger-soft/40" : "border-warn/30 bg-warn-soft/40"
      )}
    >
      <p className={cx("text-[14px] font-semibold", danger ? "text-danger" : "text-ink")}>{heading}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-soft">{detail}</p>
      {!props.requestPossible && props.cause === "MISSING" && props.requestUnavailableReason ? (
        <p className="mt-1 text-[13px] text-muted">{props.requestUnavailableReason}</p>
      ) : null}
      {error ? <p className="mt-1.5 text-[13px] font-medium text-danger">{error}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {props.cause === "CHANGED" ? (
          <button type="button" className={primaryBtn} disabled={pending} onClick={() => setDialog("changed")}>
            Godkänn efter kontroll
          </button>
        ) : null}
        {props.previousAccount && (props.cause === "MISSING" || props.cause === "EXTRACTION_UNCERTAIN") ? (
          <button type="button" className={primaryBtn} disabled={pending} onClick={() => setDialog("reuse")}>
            Använd tidigare uppgifter
          </button>
        ) : null}
        {props.cause === "MISSING" && props.requestPossible ? (
          <button
            type="button"
            className={props.previousAccount ? secondaryBtn : primaryBtn}
            disabled={pending}
            onClick={() => setDialog("request")}
          >
            Be leverantören om betalningsuppgifter
          </button>
        ) : null}
        {props.cause !== "CHANGED" ? (
          // Manuell komplettering finns alltid – primär endast när Driva
          // saknar bättre väg (ingen kandidat/historik/mejlmöjlighet).
          <button
            type="button"
            className={
              !props.previousAccount && !(props.cause === "MISSING" && props.requestPossible)
                ? primaryBtn
                : secondaryBtn
            }
            disabled={pending}
            onClick={() => setDialog("form")}
          >
            {props.cause === "EXTRACTION_UNCERTAIN" ? "Kontrollera uppgifterna" : "Lägg till betalningsuppgifter"}
          </button>
        ) : null}
      </div>

      <PaymentDetailsFormDialog
        open={dialog === "form"}
        onClose={() => setDialog("none")}
        supplierInvoiceId={props.supplierInvoiceId}
        title={
          props.cause === "EXTRACTION_UNCERTAIN"
            ? `Kontrollera betalningsuppgifter – ${props.supplier}`
            : `Lägg till betalningsuppgifter – ${props.supplier}`
        }
        candidateAccount={props.candidateAccount}
        candidateOcr={props.candidateOcr}
        note="Jämför med dokumentet innan du godkänner – uppgifterna styr vart pengarna skickas."
        onDone={setDoneText}
      />
      <ConfirmRowsDialog
        open={dialog === "reuse"}
        onClose={() => setDialog("none")}
        confirm={{
          title: "Använd tidigare verifierade uppgifter?",
          rows: [
            { label: "Leverantör", value: props.supplier },
            { label: "Konto", value: props.previousAccount ?? "—" },
            ...(props.previousVerifiedVia ? [{ label: "Verifierat via", value: props.previousVerifiedVia }] : []),
            { label: "Belopp", value: props.amountText },
          ],
          confirmLabel: "Använd tidigare uppgifter",
        }}
        note="Uppgifterna hämtas från leverantörens tidigare verifierade betalning – aldrig från en osäker tolkning."
        pending={pending}
        error={error}
        onConfirm={() =>
          runConfirmed(() => useVerifiedSupplierDetailsAction(props.supplierInvoiceId), "Uppgifterna återanvända")
        }
      />
      <ConfirmRowsDialog
        open={dialog === "changed"}
        onClose={() => setDialog("none")}
        confirm={{
          title: "Godkänn nya betalningsuppgifter?",
          rows: [
            { label: "Leverantör", value: props.supplier },
            { label: "Tidigare verifierat", value: props.previousAccount ?? "—" },
            { label: "Ny faktura", value: props.currentAccount ?? "—" },
            { label: "Belopp", value: props.amountText },
          ],
          confirmLabel: "Uppgifterna stämmer – godkänn",
        }}
        note="Kontrollera mot fakturan att de nya uppgifterna verkligen kommer från leverantören. Godkännandet gör fakturan betalbar."
        pending={pending}
        error={error}
        onConfirm={() =>
          runConfirmed(() => confirmChangedSupplierDetailsAction(props.supplierInvoiceId), "Uppgifterna godkända")
        }
      />
      <ConfirmRowsDialog
        open={dialog === "request"}
        onClose={() => setDialog("none")}
        confirm={{
          title: "Be leverantören om betalningsuppgifter?",
          rows: [
            { label: "Till", value: props.requestTo ?? "—" },
            { label: "Leverantör", value: props.supplier },
            { label: "Belopp", value: props.amountText },
            ...(props.requestMessageExcerpt ? [{ label: "Meddelande", value: props.requestMessageExcerpt }] : []),
          ],
          confirmLabel: "Skicka",
        }}
        note="Mejlet skickas till leverantören. Fakturan markeras som Väntar på leverantören tills svar kommer."
        pending={pending}
        error={error}
        onConfirm={() =>
          runConfirmed(() => requestSupplierDetailsAction(props.supplierInvoiceId), "Förfrågan skickad till leverantören")
        }
      />
    </div>
  );
}

/* ------------------------------------- Kön ------------------------------------- */

/**
 * Fokuserad kö för gruppraden: samma åtgärd per faktura som de enskilda
 * raderna skulle haft – kontrollera, återanvänd eller fråga leverantören.
 */
export function PaymentDetailsQueueDialog({
  open,
  onClose,
  items,
  onAllDone,
}: {
  open: boolean;
  onClose: () => void;
  items: PaymentDetailsQueueItem[];
  onAllDone: () => void;
}) {
  const [doneIds, setDoneIds] = useState<readonly string[]>([]);
  const remaining = items.filter((i) => !doneIds.includes(i.supplierInvoiceId)).length;

  function markDone(id: string) {
    const next = [...doneIds, id];
    setDoneIds(next);
    if (items.every((i) => next.includes(i.supplierInvoiceId))) onAllDone();
  }

  return (
    <Modal open={open} onClose={onClose} title={`Betalningsuppgifter – ${remaining} kvar`} size="md">
      <div className="divide-y divide-line/70">
        {items.map((item) => (
          <QueueRow
            key={item.supplierInvoiceId}
            item={item}
            done={doneIds.includes(item.supplierInvoiceId)}
            onDone={() => markDone(item.supplierInvoiceId)}
          />
        ))}
      </div>
    </Modal>
  );
}

function QueueRow({ item, done, onDone }: { item: PaymentDetailsQueueItem; done: boolean; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"none" | "form" | "confirm">("none");
  const [error, setError] = useState<string | null>(null);

  const amountText = `${item.amount.toLocaleString("sv-SE")} kr`;
  const description =
    item.action.kind === "verify"
      ? item.action.candidateAccount
        ? `Läst ur dokumentet: ${item.action.candidateAccount} – kontrollera och godkänn`
        : "Betalningsuppgifterna kunde inte läsas – kontrollera mot dokumentet"
      : item.action.kind === "reuse"
        ? `Tidigare verifierat: ${item.action.account} (${item.action.verifiedVia})`
        : `Driva kan be leverantören komplettera (${item.action.to})`;

  function runConfirmed(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDialog("none");
      onDone();
      router.refresh();
    });
  }

  const action = item.action;
  const confirm: ActionConfirm | null =
    action.kind === "reuse"
      ? {
          title: "Använd tidigare verifierade uppgifter?",
          rows: [
            { label: "Leverantör", value: item.supplier },
            { label: "Konto", value: action.account },
            { label: "Verifierat via", value: action.verifiedVia },
            { label: "Belopp", value: amountText },
          ],
          confirmLabel: "Använd tidigare uppgifter",
        }
      : action.kind === "request"
        ? {
            title: "Be leverantören om betalningsuppgifter?",
            rows: [
              { label: "Till", value: action.to },
              { label: "Leverantör", value: item.supplier },
              { label: "Belopp", value: amountText },
              { label: "Meddelande", value: action.message.split("\n\n")[1] ?? action.subject },
            ],
            confirmLabel: "Skicka",
          }
        : null;

  return (
    <div className="flex flex-col gap-2 px-6 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-ink">
          {item.supplier} · {amountText}
        </p>
        <p className="mt-0.5 text-[13px] text-soft">{description}</p>
        {error ? <p className="mt-1 text-[13px] font-medium text-danger">{error}</p> : null}
      </div>
      <div className="shrink-0">
        {done ? (
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-ok">
            <Check className="size-4" /> Klar
          </span>
        ) : action.kind === "verify" ? (
          <>
            <button
              type="button"
              className={cx(buttonClasses("secondary", "sm"), "max-lg:min-h-11")}
              onClick={() => setDialog("form")}
            >
              Kontrollera
            </button>
            <PaymentDetailsFormDialog
              open={dialog === "form"}
              onClose={() => setDialog("none")}
              supplierInvoiceId={item.supplierInvoiceId}
              title={`Kontrollera betalningsuppgifter – ${item.supplier}`}
              candidateAccount={action.candidateAccount}
              candidateOcr={action.candidateOcr}
              note="Jämför med dokumentet innan du godkänner – uppgifterna styr vart pengarna skickas."
              onDone={() => onDone()}
            />
          </>
        ) : (
          <>
            <button
              type="button"
              className={cx(buttonClasses("secondary", "sm"), "max-lg:min-h-11")}
              disabled={pending}
              onClick={() => {
                setError(null);
                setDialog("confirm");
              }}
            >
              {action.kind === "reuse" ? "Använd tidigare uppgifter" : "Be leverantören"}
            </button>
            {confirm ? (
              <ConfirmRowsDialog
                open={dialog === "confirm"}
                onClose={() => setDialog("none")}
                confirm={confirm}
                pending={pending}
                error={error}
                onConfirm={() =>
                  runConfirmed(() =>
                    action.kind === "reuse"
                      ? useVerifiedSupplierDetailsAction(item.supplierInvoiceId)
                      : requestSupplierDetailsAction(item.supplierInvoiceId)
                  )
                }
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
