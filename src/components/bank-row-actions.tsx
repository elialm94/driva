"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, Check, ChevronDown, Link2, Search, Sparkles } from "lucide-react";
import { buttonClasses, cx } from "./ui";
import { ExpenseQuestionButtons, UploadReceiptButton } from "./money-widgets";
import { useToast } from "./toast";
import {
  bookBankTransactionAsAction,
  confirmPaymentMatchAction,
  confirmRotPayoutAction,
  confirmSupplierPaymentMatchAction,
  forgetBankCounterpartRuleAction,
  registerCreditRefundAction,
} from "@/app/bokforing-actions";
import { kr, datumKort } from "@/lib/format";
import { bankKindsFor, type BankKind, type BankKindKey } from "@/lib/banking/bank-kinds";
import type { BankKindPickerData, BankRowAction, OpenReceivableOption } from "@/lib/services/economy-list";

type ActionResult = { ok: true } | { ok: false; error: string };

// Stabila referenser så väljarens memo inte räknas om varje render.
const PURCHASE_ROW_EXCLUDES: BankKindKey[] = ["kortkop"];
const NO_EXCLUDES: BankKindKey[] = [];

/**
 * Åtgärderna för en obokad banktransaktion, direkt i bankvyn. Samma domän-
 * vägar som Hem-raderna: bekräfta motorns förslag, matcha mot en faktura för
 * hand, lägga till kvittot på kortköpet, svara på kategorifrågan – eller säga
 * vad transaktionen är (bankavgift, skattekonto, redan bokförd lön …) i
 * väljaren. Registret lämnar aldrig en rad utan ett sätt att slutföra den.
 */
export function BankRowActions({
  txId,
  amount,
  action,
  picker,
  receivables,
  defaultOpen = false,
}: {
  txId: string;
  amount: number;
  action: BankRowAction;
  picker?: BankKindPickerData;
  receivables: OpenReceivableOption[];
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(
    defaultOpen && (action.kind === "pick_invoice" || action.kind === "confirm_match")
  );
  const [kindOpen, setKindOpen] = useState(defaultOpen && action.kind === "categorize" && !action.href);
  const [remember, setRemember] = useState(true);

  function finish(title: string, text?: string) {
    setDone(title);
    // Raden lämnar listan över obokade när sidan laddats om – toasten står kvar.
    toast({ title, text: text ?? "Transaktionen är avstämd och borta från att-göra-listan.", tone: "ok" });
    router.refresh();
  }

  function run(label: string, fn: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (result.ok) finish(label);
        else setError(result.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Något gick fel. Försök igen.");
      }
    });
  }

  function bookAs(kind: BankKindKey, opts: { verificationId?: string; remember: boolean }) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await bookBankTransactionAsAction(txId, kind, opts);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        finish(
          result.summary,
          result.learned === "auto"
            ? `Nästa gång bokförs ${picker?.counterpart ?? "motparten"} automatiskt.`
            : result.learned === "suggest"
              ? `Nästa gång föreslår Driva samma sak för ${picker?.counterpart ?? "motparten"}.`
              : undefined
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Något gick fel. Försök igen.");
      }
    });
  }

  if (done) {
    return (
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-ok" data-bank-row-done>
        <Check className="size-4" /> {done}
      </p>
    );
  }

  const primary = (() => {
    switch (action.kind) {
      case "confirm_match":
        return (
          <button
            type="button"
            className={buttonClasses("primary", "sm")}
            disabled={pending}
            onClick={() => run("Betalningen är bokförd", () => confirmPaymentMatchAction(txId, action.invoiceId))}
            data-bank-confirm-match
          >
            {pending ? "Bokför …" : action.label}
          </button>
        );
      case "confirm_rot_payout":
        return (
          <button
            type="button"
            className={buttonClasses("primary", "sm")}
            disabled={pending}
            onClick={() => run("Utbetalningen är bokförd", () => confirmRotPayoutAction(txId))}
          >
            {pending ? "Bokför …" : action.label}
          </button>
        );
      case "confirm_refund":
        return (
          <button
            type="button"
            className={buttonClasses("primary", "sm")}
            disabled={pending}
            onClick={() => run("Återbetalningen är bokförd", () => registerCreditRefundAction(action.invoiceId, txId))}
          >
            {pending ? "Bokför …" : action.label}
          </button>
        );
      case "confirm_supplier_payment":
        return (
          <button
            type="button"
            className={buttonClasses("primary", "sm")}
            disabled={pending}
            onClick={() =>
              run(`${action.supplier} är betald och bokförd`, () =>
                confirmSupplierPaymentMatchAction(txId, action.supplierPaymentId)
              )
            }
            data-bank-confirm-supplier
          >
            {pending ? "Bokför …" : action.label}
          </button>
        );
      case "book_kind":
        return (
          <button
            type="button"
            className={buttonClasses("primary", "sm")}
            disabled={pending}
            onClick={() => bookAs(action.bankKind, { verificationId: action.verificationId, remember })}
            data-bank-book-kind={action.bankKind}
          >
            <Sparkles className="size-3.5" />
            {pending ? "Bokför …" : action.label}
          </button>
        );
      case "receipt":
        return <UploadReceiptButton expenseId={action.expenseId} label="Lägg till kvitto" />;
      case "question":
        return <ExpenseQuestionButtons expenseId={action.expenseId} options={action.options} />;
      case "categorize":
        return action.href ? (
          <Link href={action.href} className={buttonClasses("primary", "sm")}>
            {action.hrefLabel ?? "Öppna"} <ArrowUpRight className="size-3.5" />
          </Link>
        ) : picker ? (
          <button
            type="button"
            className={buttonClasses("primary", "sm")}
            onClick={() => setKindOpen((v) => !v)}
            aria-expanded={kindOpen}
            data-bank-pick-kind
          >
            Välj vad det är <ChevronDown className={cx("size-3.5 transition-transform", kindOpen && "rotate-180")} />
          </button>
        ) : null;
      default:
        return null;
    }
  })();

  const canPickInvoice = amount > 0 && (action.kind === "pick_invoice" || action.kind === "confirm_match");
  // Väljaren är alltid en utväg – knappens ord säger vad den är ett alternativ till.
  const kindAltLabel =
    action.kind === "receipt" || action.kind === "question"
      ? "Inte ett köp …"
      : action.kind === "pick_invoice" || action.kind === "confirm_match"
        ? "Inte en kundbetalning …"
        : "Annat …";
  const showKindAlt = Boolean(picker) && !(action.kind === "categorize" && !action.href);
  const rememberLabel =
    action.kind === "book_kind" && picker
      ? picker.rule && picker.rule.kind === action.bankKind
        ? `Gör det automatiskt för ${picker.counterpart} nästa gång`
        : `Kom ihåg för ${picker.counterpart}`
      : null;

  return (
    <div className="space-y-2" data-bank-row-actions data-bank-row-kind={action.kind}>
      <p className="text-[13px] text-soft">{action.kind === "question" ? action.text : action.reason}</p>
      <div className="flex flex-wrap items-center gap-2">
        {primary}
        {canPickInvoice ? (
          <button
            type="button"
            className={buttonClasses(action.kind === "pick_invoice" ? "primary" : "ghost", "sm")}
            onClick={() => {
              setInvoiceOpen((v) => !v);
              setKindOpen(false);
            }}
            aria-expanded={invoiceOpen}
            data-bank-pick-invoice
          >
            <Link2 className="size-3.5" />
            {action.kind === "pick_invoice" ? "Matcha mot faktura" : "Annan faktura …"}
          </button>
        ) : null}
        {showKindAlt ? (
          <button
            type="button"
            className={buttonClasses("ghost", "sm")}
            onClick={() => {
              setKindOpen((v) => !v);
              setInvoiceOpen(false);
            }}
            aria-expanded={kindOpen}
            data-bank-pick-kind
          >
            {kindAltLabel}
          </button>
        ) : null}
      </div>
      {rememberLabel && action.kind === "book_kind" && action.source !== "regel" ? (
        <label className="flex items-center gap-2 text-[13px] text-soft">
          <input
            type="checkbox"
            className="size-4 rounded border-line accent-accent"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            data-bank-remember
          />
          {rememberLabel}
        </label>
      ) : null}
      {error ? (
        <p className="text-[13px] font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {invoiceOpen && canPickInvoice ? (
        <InvoicePicker
          amount={amount}
          receivables={receivables}
          pending={pending}
          onPick={(invoiceId) => run("Betalningen är bokförd", () => confirmPaymentMatchAction(txId, invoiceId))}
        />
      ) : null}
      {kindOpen && picker ? (
        <BankKindPicker
          picker={picker}
          amount={amount}
          pending={pending}
          exclude={action.kind === "receipt" || action.kind === "question" ? PURCHASE_ROW_EXCLUDES : NO_EXCLUDES}
          onBook={(kind, opts) => bookAs(kind, opts)}
          onPickInvoice={
            amount > 0
              ? () => {
                  setKindOpen(false);
                  setInvoiceOpen(true);
                }
              : undefined
          }
          onForget={() =>
            run("Regeln är borttagen", () => forgetBankCounterpartRuleAction(picker.counterpart))
          }
        />
      ) : null}
    </div>
  );
}

/* --------------------------- Vad är transaktionen? --------------------------- */

/**
 * Väljaren för "vad är det här?": typerna för riktningen som radrader med
 * förklaring, redan bokförda belopp att koppla till, och valet att spara
 * motpartsregeln. Ett klick på Bokför – aldrig debet/kredit för hand.
 */
function BankKindPicker({
  picker,
  amount,
  pending,
  exclude = [],
  onBook,
  onPickInvoice,
  onForget,
}: {
  picker: BankKindPickerData;
  amount: number;
  pending: boolean;
  /** Typer som inte är ett alternativ här (t.ex. "kortkop" när raden redan är ett köp). */
  exclude?: BankKindKey[];
  onBook: (kind: BankKindKey, opts: { verificationId?: string; remember: boolean }) => void;
  onPickInvoice?: () => void;
  onForget: () => void;
}) {
  const kinds = useMemo(
    () => bankKindsFor(picker.direction).filter((k) => !exclude.includes(k.key)),
    [picker.direction, exclude]
  );
  const [selected, setSelected] = useState<BankKindKey | null>(null);
  const [verificationId, setVerificationId] = useState<string | null>(
    picker.alreadyBooked.length === 1 ? picker.alreadyBooked[0].verificationId : null
  );
  const [remember, setRemember] = useState(true);
  const current = kinds.find((k) => k.key === selected);
  const needsVerification = selected === "redan_bokford";
  const bookable =
    current && !current.href && current.key !== "kundbetalning" && (!needsVerification || Boolean(verificationId));

  function choose(kind: BankKind) {
    if (kind.key === "kundbetalning") {
      onPickInvoice?.();
      return;
    }
    setSelected(kind.key);
  }

  return (
    <div className="rounded-2xl border border-line/80 bg-card" data-bank-kind-picker>
      <div className="border-b border-line/70 px-3 py-2">
        <p className="text-[13px] font-medium text-ink">
          Vad är {picker.direction === "in" ? "inbetalningen från" : "utbetalningen till"} {picker.counterpart}?
        </p>
        {picker.rule ? (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted">
            <span>
              Regel: {picker.counterpart} bokförs som {picker.rule.label.toLowerCase()}
              {picker.rule.count > 1 ? ` (${picker.rule.count} gånger)` : ""}
            </span>
            <button type="button" className="font-medium text-accent hover:underline" onClick={onForget} disabled={pending}>
              Glöm regeln
            </button>
          </p>
        ) : null}
      </div>
      <ul className="max-h-80 divide-y divide-line/70 overflow-y-auto" role="radiogroup" aria-label="Typ av transaktion">
        {kinds.map((kind) => {
          const active = selected === kind.key;
          const disabledAlready = kind.key === "redan_bokford" && picker.alreadyBooked.length === 0;
          return (
            <li key={kind.key}>
              <KindRow
                kind={kind}
                active={active}
                disabled={pending}
                muted={disabledAlready}
                onSelect={() => choose(kind)}
                trailing={
                  kind.href ? (
                    <Link href={kind.href} className={cx(buttonClasses("secondary", "sm"), "shrink-0")}>
                      Öppna <ArrowUpRight className="size-3.5" />
                    </Link>
                  ) : kind.key === "kundbetalning" && onPickInvoice ? (
                    <span className="shrink-0 text-[12.5px] font-medium text-accent">Välj faktura</span>
                  ) : null
                }
              />
              {active && kind.key === "redan_bokford" ? (
                <div className="px-3 pb-3 pl-10">
                  {picker.alreadyBooked.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-line px-3 py-2 text-[12.5px] text-muted">
                      Ingen verifikation på {kr(Math.abs(amount))} inom tio dagar väntar på koppling. Är det lön? Kör lönen under
                      Bokföring › Lön först, så matchas utbetalningen.
                    </p>
                  ) : (
                    <ul className="space-y-1" aria-label="Verifikationer med samma belopp">
                      {picker.alreadyBooked.map((v) => (
                        <li key={v.verificationId}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-[13px] hover:bg-canvas">
                            <input
                              type="radio"
                              name={`verification-${picker.counterpart}`}
                              className="size-4 accent-accent"
                              checked={verificationId === v.verificationId}
                              onChange={() => setVerificationId(v.verificationId)}
                            />
                            <span className="font-medium text-ink">{v.label}</span>
                            <span className="min-w-0 truncate text-soft">{v.description}</span>
                            <span className="ml-auto shrink-0 text-muted">{datumKort(v.date)}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/70 px-3 py-2.5">
        {current?.learnable ? (
          <label className="flex items-center gap-2 text-[13px] text-soft">
            <input
              type="checkbox"
              className="size-4 rounded border-line accent-accent"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              data-bank-remember
            />
            Kom ihåg för {picker.counterpart}
          </label>
        ) : (
          <span className="text-[12.5px] text-muted">
            {current ? current.hint : "Välj en typ så bokförs transaktionen med rätt kontering."}
          </span>
        )}
        <button
          type="button"
          className={cx(buttonClasses("primary", "sm"), "shrink-0")}
          disabled={pending || !bookable}
          onClick={() => current && onBook(current.key, { verificationId: verificationId ?? undefined, remember })}
          data-bank-kind-book
        >
          {pending
            ? "Bokför …"
            : current?.key === "redan_bokford"
              ? "Koppla"
              : current?.key === "kortkop"
                ? "Vänta på kvitto"
                : "Bokför"}
        </button>
      </div>
    </div>
  );
}

function KindRow({
  kind,
  active,
  disabled,
  muted,
  onSelect,
  trailing,
}: {
  kind: BankKind;
  active: boolean;
  disabled: boolean;
  muted: boolean;
  onSelect: () => void;
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cx(
        "flex items-center gap-3 px-3 py-2.5 transition-colors",
        active ? "bg-accent-soft/60" : "hover:bg-canvas",
        muted && "opacity-70"
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={active}
        disabled={disabled}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        data-bank-kind={kind.key}
      >
        <span
          aria-hidden
          className={cx(
            "flex size-4 shrink-0 items-center justify-center rounded-full border",
            active ? "border-accent bg-accent" : "border-line bg-card"
          )}
        >
          {active ? <span className="size-1.5 rounded-full bg-white" /> : null}
        </span>
        <span className="min-w-0">
          <span className="block text-[14px] font-medium text-ink">{kind.label}</span>
          <span className="block truncate text-[12.5px] text-muted">{kind.hint}</span>
        </span>
      </button>
      {trailing}
    </div>
  );
}

/* ------------------------------- Fakturaväljare ------------------------------- */

function InvoicePicker({
  amount,
  receivables,
  pending,
  onPick,
}: {
  amount: number;
  receivables: OpenReceivableOption[];
  pending: boolean;
  onPick: (invoiceId: string) => void;
}) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? receivables.filter((r) => `${r.invoiceNumber ?? ""} ${r.customerName}`.toLowerCase().includes(needle))
      : receivables;
    // Samma belopp överst – det är nästan alltid rätt faktura.
    return [...list].sort((a, b) => {
      const da = Math.abs(a.outstanding - amount);
      const dbb = Math.abs(b.outstanding - amount);
      if ((da <= 1) !== (dbb <= 1)) return da <= 1 ? -1 : 1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  }, [q, receivables, amount]);

  if (receivables.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-3 py-2.5 text-[13px] text-muted">
        Det finns inga obetalda fakturor att matcha mot. Är det ingen kundbetalning? Välj &quot;Inte en kundbetalning …&quot; och
        säg vad det är i stället.
      </p>
    );
  }

  return (
    <div className="rounded-2xl border border-line/80 bg-card" data-bank-invoice-picker>
      {receivables.length > 5 ? (
        <div className="relative border-b border-line/70 p-2">
          <Search className="pointer-events-none absolute left-4.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            className="h-10 w-full rounded-xl border border-line bg-canvas pl-9 pr-3 text-[14px] focus:border-accent"
            placeholder="Sök fakturanummer eller kund"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Sök faktura att matcha mot"
          />
        </div>
      ) : null}
      <ul className="max-h-72 divide-y divide-line/70 overflow-y-auto" aria-label="Obetalda fakturor">
        {rows.length === 0 ? (
          <li className="px-3 py-3 text-[13px] text-muted">Ingen faktura matchade sökningen.</li>
        ) : (
          rows.map((r) => {
            const exact = Math.abs(r.outstanding - amount) <= 1;
            return (
              <li key={r.invoiceId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium text-ink">
                    {r.invoiceNumber != null ? `#${r.invoiceNumber}` : "Faktura"} · {r.customerName}
                  </p>
                  <p className="text-[12.5px] text-muted">
                    {kr(r.outstanding)} kvar · förfaller {datumKort(r.dueDate)}
                    {exact ? " · samma belopp" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className={cx(buttonClasses(exact ? "primary" : "secondary", "sm"), "shrink-0")}
                  disabled={pending}
                  onClick={() => onPick(r.invoiceId)}
                  aria-label={`Matcha mot faktura ${r.invoiceNumber ?? ""} ${r.customerName}`.trim()}
                >
                  Välj
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
