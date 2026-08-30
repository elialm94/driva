"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, MoreHorizontal, ShieldCheck } from "lucide-react";
import { Badge, Card, EmptyState, buttonClasses, cx } from "./ui";
import { Modal } from "./modal";
import { ActionMenu, actionMenuItemClassName } from "./action-menu";
import { AccountCombobox } from "./account-combobox";
import { kr, datumKort, datumTid } from "@/lib/format";
import { correctVerificationAction } from "@/app/bokforing-actions";
import type { CorrectionIntent } from "@/lib/services/verification-correction";
import type { VerificationView } from "@/lib/services/verification-correction";
import { ReceiptText } from "lucide-react";

type Filter = "alla" | "auto" | "manuella" | "rattade";

function matchesFilter(v: VerificationView, filter: Filter): boolean {
  if (filter === "alla") return true;
  if (filter === "auto") return v.createdBy === "auto";
  if (filter === "manuella") return v.createdBy !== "auto";
  return Boolean(v.correctedById || v.correctsId || v.sourceType === "rattelse");
}

function Kontering({ entries, compact }: { entries: VerificationView["entries"]; compact?: boolean }) {
  if (compact) {
    return (
      <ul className="space-y-2">
        {entries.map((e, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0">
              <span className="font-mono text-[12px] text-muted">{e.account}</span>{" "}
              <span className="text-soft">{e.accountName}</span>
            </span>
            <span className="shrink-0 tabular">
              {e.debit ? `Debet ${kr(e.debit)}` : `Kredit ${kr(e.credit)}`}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
          <th className="pb-1.5 font-semibold">Konto</th>
          <th className="pb-1.5 text-right font-semibold">Debet</th>
          <th className="pb-1.5 text-right font-semibold">Kredit</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e, i) => (
          <tr key={i} className="border-t border-line/50">
            <td className="py-1.5 pr-3">
              <span className="font-mono text-[12px] text-muted">{e.account}</span>{" "}
              <span className="text-soft">{e.accountName}</span>
            </td>
            <td className="py-1.5 text-right tabular">{e.debit ? kr(e.debit) : ""}</td>
            <td className="py-1.5 text-right tabular">{e.credit ? kr(e.credit) : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Chain({
  chain,
  onOpen,
}: {
  chain: VerificationView["chain"];
  onOpen: (id: string) => void;
}) {
  if (chain.length < 2) return null;
  const role: Record<string, string> = { original: "auto", rattelse: "rättelse", ny: "ny bokning" };
  return (
    <p className="flex flex-wrap items-center gap-1 text-[12px] text-muted">
      {chain.map((c, i) => (
        <span key={c.id} className="inline-flex items-center gap-1">
          {i > 0 ? <span aria-hidden>→</span> : null}
          <button type="button" className="font-mono font-medium text-accent hover:underline" onClick={() => onOpen(c.id)}>
            {c.label}
          </button>
          <span>{c.role === "original" ? "" : role[c.role]}</span>
        </span>
      ))}
    </p>
  );
}

export function VerifikationerView({
  initial,
  page,
  totalPages,
  total,
  initialOpenId,
  allowCorrection = true,
}: {
  initial: VerificationView[];
  page: number;
  totalPages: number;
  total: number;
  initialOpenId?: string;
  allowCorrection?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<Filter>("alla");
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);

  useEffect(() => {
    setItems(initial);
  }, [initial]);
  const [correctId, setCorrectId] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const filtered = useMemo(() => items.filter((v) => matchesFilter(v, filter)), [items, filter]);
  const open = openId ? items.find((v) => v.id === openId) : undefined;

  function merge(next: VerificationView[]) {
    setItems(next);
  }

  function openDetail(id: string) {
    setOpenId(id);
    setCorrectId(null);
  }

  return (
    <>
      <div className="mb-3 flex gap-1 overflow-x-auto rounded-2xl bg-ink/4 p-1">
        {(
          [
            ["alla", "Alla"],
            ["auto", "Auto"],
            ["manuella", "Manuella"],
            ["rattade", "Rättade"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cx(
              "min-h-11 rounded-xl px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              filter === key ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {success ? (
        <p className="mb-3 flex items-center gap-1.5 rounded-xl bg-ok-soft px-4 py-2.5 text-[13px] font-medium text-ok">
          <Check className="size-4" /> {success}
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title={items.length === 0 ? "Inga verifikationer ännu" : "Inget i det här filtret"}
          text={
            items.length === 0
              ? "När du skickar fakturor eller får utgifter bokförs de automatiskt här."
              : "Prova Alla om du saknar något."
          }
        />
      ) : (
        <Card className="divide-y divide-line/70">
          {filtered.map((v) => (
            <div key={v.id} className="flex items-stretch">
              <button
                type="button"
                onClick={() => openDetail(v.id)}
                className="min-w-0 flex-1 px-5 py-3.5 text-left transition-colors hover:bg-canvas/60"
              >
                <span className="flex items-center gap-3 sm:gap-4">
                  <span className="hidden w-14 shrink-0 font-mono text-[12px] font-medium text-muted sm:block">
                    {v.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                    {v.description}
                    {v.correctedByLabel ? (
                      <span className="ml-2 text-[12px] font-normal text-warn">Rättad · {v.correctedByLabel}</span>
                    ) : null}
                    {v.correctsLabel ? (
                      <span className="ml-2 text-[12px] font-normal text-muted">Rättelse av {v.correctsLabel}</span>
                    ) : null}
                  </span>
                  <span className="hidden text-[13px] text-muted sm:block">{datumKort(v.date)}</span>
                  <span className="shrink-0 text-right text-[14px] font-medium tabular sm:w-24">{kr(v.total)}</span>
                  <Badge tone={v.badge.tone} className="hidden sm:inline-flex">
                    {v.badge.text}
                  </Badge>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted sm:hidden">
                  <span className="font-mono font-medium">{v.label}</span>
                  <span>· {datumKort(v.date)}</span>
                  <span>· {v.badge.text}</span>
                </span>
              </button>
              <div className="flex items-center pr-3" onClick={(e) => e.stopPropagation()}>
                <RowMenu
                  v={v}
                  allowCorrection={allowCorrection}
                  onOpen={() => openDetail(v.id)}
                  onCorrect={() => {
                    setOpenId(v.id);
                    setCorrectId(v.id);
                  }}
                />
              </div>
            </div>
          ))}
        </Card>
      )}

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-[13px] text-muted">
          <p className="tabular">
            Sida {page} av {totalPages} · {total} totalt
          </p>
          <div className="flex gap-1">
            {/* Link i stället för <a>: sidbyte är klientnavigering, inte omladdning. */}
            <Link
              href={`/bokforing/verifikationer?sida=${page - 1}`}
              aria-disabled={page <= 1}
              className={cx(
                "inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1.5 font-medium",
                page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-canvas"
              )}
            >
              <ChevronLeft className="size-3.5" /> Föregående
            </Link>
            <Link
              href={`/bokforing/verifikationer?sida=${page + 1}`}
              aria-disabled={page >= totalPages}
              className={cx(
                "inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1.5 font-medium",
                page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-canvas"
              )}
            >
              Nästa
            </Link>
          </div>
        </div>
      ) : null}

      <p className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-muted">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Bokförda verifikationer kan aldrig ändras eller tas bort. Om något blev fel skapas en rättelseverifikation som
          återför originalet – båda står kvar i historiken.{" "}
          <a href="/api/bokforing/export?typ=verifikationer" className="text-accent hover:underline">
            Exportera CSV
          </a>
        </span>
      </p>

      <Modal
        open={Boolean(open) && !correctId}
        onClose={() => setOpenId(null)}
        title={open ? open.label : undefined}
        size="lg"
      >
        {open ? (
          <VerificationDetail
            v={open}
            items={items}
            allowCorrection={allowCorrection}
            onOpen={openDetail}
            onCorrect={() => setCorrectId(open.id)}
          />
        ) : null}
      </Modal>

      <Modal
        open={Boolean(correctId)}
        onClose={() => setCorrectId(null)}
        title="Rätta bokföring"
        size="lg"
      >
        {correctId ? (
          <CorrectionSheet
            v={items.find((x) => x.id === correctId)!}
            onCancel={() => setCorrectId(null)}
            onDone={(msg, next) => {
              merge(next);
              setCorrectId(null);
              setSuccess(msg);
              router.refresh();
            }}
          />
        ) : null}
      </Modal>
    </>
  );
}

function RowMenu({
  v,
  onOpen,
  onCorrect,
  allowCorrection = true,
}: {
  v: VerificationView;
  onOpen: () => void;
  onCorrect: () => void;
  allowCorrection?: boolean;
}) {
  const canCorrect =
    allowCorrection &&
    (v.flow.kind === "konto" ||
      v.flow.kind === "avancerad" ||
      v.flow.kind === "omatcha" ||
      v.flow.kind === "kreditfaktura" ||
      v.flow.kind === "moms");
  return (
    <ActionMenu label="Åtgärder">
      <button type="button" role="menuitem" className={actionMenuItemClassName()} onClick={onOpen}>
        Visa detaljer
      </button>
      {canCorrect ? (
        <button type="button" role="menuitem" className={actionMenuItemClassName()} onClick={onCorrect}>
          {v.flow.kind === "kreditfaktura" ? "Fakturan är fel" : "Rätta bokföring"}
        </button>
      ) : null}
    </ActionMenu>
  );
}

function VerificationDetail({
  v,
  items,
  onOpen,
  onCorrect,
  allowCorrection = true,
}: {
  v: VerificationView;
  items: VerificationView[];
  onOpen: (id: string) => void;
  onCorrect: () => void;
  allowCorrection?: boolean;
}) {
  const canCorrect = allowCorrection && v.flow.kind !== "redan_rattad" && v.flow.kind !== "rattelse";
  return (
    <div className="px-6 py-5">
      <h3 className="text-[17px] font-semibold tracking-tight">{v.description}</h3>
      <p className="mt-1 text-[13px] text-soft">
        {v.creatorPhrase} {datumTid(v.postedAt)}.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone={v.badge.tone}>{v.badge.text}</Badge>
        <Badge tone="neutral">Underlag: {v.sourceLabel}</Badge>
        <Badge tone="neutral">Säkerhet: {v.confidenceLabel}</Badge>
      </div>
      {v.explanation ? (
        <p className="mt-4 rounded-xl bg-accent-soft/60 px-4 py-2.5 text-[13px] leading-relaxed text-ink">
          {v.explanation}
        </p>
      ) : null}
      {v.correctedByLabel ? (
        <p className="mt-3 text-[13px] text-warn">
          Rättad. Rättades genom{" "}
          <button type="button" className="font-medium text-accent hover:underline" onClick={() => v.correctedById && onOpen(v.correctedById)}>
            {v.correctedByLabel}
          </button>
          {v.replacementLabel ? (
            <>
              {" "}
              · ny bokning{" "}
              <button type="button" className="font-medium text-accent hover:underline" onClick={() => v.replacementId && onOpen(v.replacementId)}>
                {v.replacementLabel}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      {v.correctsLabel ? (
        <p className="mt-3 text-[13px] text-soft">
          Rättelse av{" "}
          <button type="button" className="font-medium text-accent hover:underline" onClick={() => v.correctsId && onOpen(v.correctsId)}>
            {v.correctsLabel}
          </button>
        </p>
      ) : null}
      <div className="mt-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Kontering</p>
        <div className="sm:hidden">
          <Kontering entries={v.entries} compact />
        </div>
        <div className="hidden sm:block">
          <Kontering entries={v.entries} />
        </div>
      </div>
      <div className="mt-4">
        <Chain
          chain={v.chain}
          onOpen={(id) => {
            const hit = items.find((x) => x.id === id);
            if (hit) onOpen(hit.id);
          }}
        />
      </div>
      {canCorrect ? (
        <div className="mt-6 flex justify-end">
          <button type="button" className={buttonClasses("secondary", "sm")} onClick={onCorrect}>
            <MoreHorizontal className="size-3.5" />
            {v.flow.kind === "kreditfaktura" ? "Fakturan är fel" : "Rätta bokföring"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CorrectionSheet({
  v,
  onCancel,
  onDone,
}: {
  v: VerificationView;
  onCancel: () => void;
  onDone: (msg: string, next: VerificationView[]) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState(v.flow.currentCategory ?? "");
  const [reason, setReason] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [step, setStep] = useState<"form" | "preview">("form");
  const [advLines, setAdvLines] = useState(
    v.entries.map((e) => ({ account: String(e.account), debit: e.debit ? String(e.debit) : "", credit: e.credit ? String(e.credit) : "" }))
  );

  const flow = v.flow;
  const selected = flow.accountOptions?.find((o) => o.key === category);

  function intent(): CorrectionIntent | null {
    if (flow.kind === "omatcha") return { kind: "omatcha", reason: reason.trim() || undefined };
    if (advanced && flow.allowAdvanced) {
      const entries = advLines
        .map((l) => ({
          account: Number(l.account),
          debit: l.debit ? Number(l.debit) : 0,
          credit: l.credit ? Number(l.credit) : 0,
        }))
        .filter((l) => Number.isInteger(l.account) && (l.debit > 0 || l.credit > 0));
      return { kind: "avancerad", entries, reason: reason.trim() || undefined };
    }
    if (flow.kind === "konto" && category) return { kind: "konto", category, reason: reason.trim() || undefined };
    return null;
  }

  function submit() {
    const next = intent();
    if (!next) {
      setError("Välj vad som ska ändras.");
      return;
    }
    startTransition(async () => {
      const res = await correctVerificationAction(v.id, next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone(
        `✓ ${res.originalLabel} rättades genom ${res.reversalLabel}${res.replacementLabel ? ` · ny bokning ${res.replacementLabel}` : ""}.`,
        res.views
      );
    });
  }

  if (flow.kind === "kreditfaktura" || flow.kind === "moms") {
    return (
      <div className="px-6 py-5">
        <p className="text-[15px] font-semibold">{flow.title}</p>
        <p className="mt-2 text-[14px] leading-relaxed text-soft">{flow.hint}</p>
        {flow.periodLockMessage ? <p className="mt-3 text-[13px] text-muted">{flow.periodLockMessage}</p> : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={buttonClasses("secondary")} onClick={onCancel}>
            Avbryt
          </button>
          {flow.href ? (
            <Link href={flow.href as never} className={buttonClasses("primary")}>
              {flow.hrefLabel ?? "Fortsätt"}
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  if (flow.kind === "redan_rattad" || flow.kind === "rattelse") {
    return (
      <div className="px-6 py-5">
        <p className="text-[15px] font-semibold">{flow.title}</p>
        <p className="mt-2 text-[14px] leading-relaxed text-soft">{flow.hint}</p>
        <div className="mt-6 flex justify-end">
          <button type="button" className={buttonClasses("secondary")} onClick={onCancel}>
            Stäng
          </button>
        </div>
      </div>
    );
  }

  if (flow.kind === "omatcha") {
    return (
      <div className="px-6 py-5">
        <p className="text-[15px] font-semibold">{flow.title}</p>
        <p className="mt-2 text-[14px] leading-relaxed text-soft">{flow.hint}</p>
        {flow.periodLockMessage ? <p className="mt-3 text-[13px] text-muted">{flow.periodLockMessage}</p> : null}
        <p className="mt-4 text-[13px] font-medium">Nuvarande kontering</p>
        <div className="mt-2 sm:hidden">
          <Kontering entries={v.entries} compact />
        </div>
        <div className="mt-2 hidden sm:block">
          <Kontering entries={v.entries} />
        </div>
        {step === "preview" ? (
          <>
            <p className="mt-4 rounded-xl bg-accent-soft/60 px-4 py-2.5 text-[13px] leading-relaxed">
              Driva kommer skapa en rättelse. Originalverifikationen ändras inte. Matchningen öppnas igen så du kan koppla rätt.
            </p>
            {error ? <p className="mt-3 text-[13px] font-medium text-danger">{error}</p> : null}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className={buttonClasses("secondary")} disabled={isPending} onClick={() => setStep("form")}>
                Avbryt
              </button>
              <button type="button" className={buttonClasses("primary")} disabled={isPending} onClick={submit}>
                {isPending ? "Bokför …" : "Bokför rättelse"}
              </button>
            </div>
          </>
        ) : (
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={buttonClasses("secondary")} onClick={onCancel}>
              Avbryt
            </button>
            <button type="button" className={buttonClasses("primary")} onClick={() => setStep("preview")}>
              Fortsätt
            </button>
          </div>
        )}
      </div>
    );
  }

  const nextHint = selected ? `Ny kontering på ${selected.label}.` : "Välj kostnadskonto.";

  if (step === "preview") {
    return (
      <div className="px-6 py-5">
        <p className="text-[13px] font-medium text-muted">Nuvarande</p>
        <div className="mt-2 sm:hidden">
          <Kontering entries={v.entries} compact />
        </div>
        <div className="mt-2 hidden sm:block">
          <Kontering entries={v.entries} />
        </div>
        <p className="mt-4 text-[13px] font-medium text-muted">Ny</p>
        <p className="mt-1 text-[14px] text-soft">{advanced ? "Avancerad kontering enligt dina rader." : nextHint}</p>
        <p className="mt-4 rounded-xl bg-accent-soft/60 px-4 py-2.5 text-[13px] leading-relaxed">
          Driva kommer skapa en rättelse. Originalverifikationen ändras inte.
        </p>
        {flow.periodLockMessage ? <p className="mt-3 text-[13px] text-muted">{flow.periodLockMessage}</p> : null}
        {error ? <p className="mt-3 text-[13px] font-medium text-danger">{error}</p> : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={buttonClasses("secondary")} disabled={isPending} onClick={() => setStep("form")}>
            Avbryt
          </button>
          <button type="button" className={buttonClasses("primary")} disabled={isPending} onClick={submit}>
            {isPending ? "Bokför …" : "Bokför rättelse"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-5">
      <p className="text-[13px] font-medium text-muted">Nuvarande kontering</p>
      <div className="mt-2 sm:hidden">
        <Kontering entries={v.entries} compact />
      </div>
      <div className="mt-2 hidden sm:block">
        <Kontering entries={v.entries} />
      </div>
      {flow.periodLockMessage ? <p className="mt-3 text-[13px] text-muted">{flow.periodLockMessage}</p> : null}

      {!advanced && flow.kind === "konto" ? (
        <div className="mt-5">
          <p className="mb-2 text-[14px] font-semibold">{flow.title}</p>
          <p className="mb-3 text-[13px] text-soft">{flow.hint}</p>
          <AccountCombobox options={flow.accountOptions ?? []} value={category} onChange={setCategory} />
        </div>
      ) : null}

      {advanced && flow.allowAdvanced ? (
        <div className="mt-5 space-y-2">
          <p className="text-[14px] font-semibold">Avancerad rättelse</p>
          <p className="text-[13px] text-soft">Debet och kredit måste balansera. Driva bokför rättelsen – originalet ändras inte.</p>
          {advLines.map((l, i) => (
            <div key={i} className="grid grid-cols-3 gap-2">
              <input
                inputMode="numeric"
                className="rounded-xl border border-line-strong px-3 py-2 text-[14px]"
                value={l.account}
                onChange={(e) => setAdvLines((rows) => rows.map((r, j) => (j === i ? { ...r, account: e.target.value } : r)))}
                placeholder="Konto"
              />
              <input
                inputMode="numeric"
                className="rounded-xl border border-line-strong px-3 py-2 text-[14px]"
                value={l.debit}
                onChange={(e) => setAdvLines((rows) => rows.map((r, j) => (j === i ? { ...r, debit: e.target.value } : r)))}
                placeholder="Debet"
              />
              <input
                inputMode="numeric"
                className="rounded-xl border border-line-strong px-3 py-2 text-[14px]"
                value={l.credit}
                onChange={(e) => setAdvLines((rows) => rows.map((r, j) => (j === i ? { ...r, credit: e.target.value } : r)))}
                placeholder="Kredit"
              />
            </div>
          ))}
          <button
            type="button"
            className="text-[13px] font-medium text-accent"
            onClick={() => setAdvLines((rows) => [...rows, { account: "", debit: "", credit: "" }])}
          >
            Lägg till rad
          </button>
        </div>
      ) : null}

      <label className="mt-4 block text-[13px] text-soft">
        Orsak <span className="text-muted">(valfritt)</span>
        <input
          className="mt-1 w-full rounded-xl border border-line-strong px-3 py-2 text-[14px]"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Fel kostnadskonto"
        />
      </label>

      {flow.allowAdvanced ? (
        <button type="button" className="mt-3 text-[13px] font-medium text-muted hover:text-ink" onClick={() => setAdvanced((a) => !a)}>
          {advanced ? "Enkel rättelse" : "Avancerad rättelse"}
        </button>
      ) : null}

      {error ? <p className="mt-3 text-[13px] font-medium text-danger">{error}</p> : null}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={buttonClasses("secondary")} onClick={onCancel}>
          Avbryt
        </button>
        <button
          type="button"
          className={buttonClasses("primary")}
          disabled={!advanced && flow.kind === "konto" && !category}
          onClick={() => setStep("preview")}
        >
          Fortsätt
        </button>
      </div>
    </div>
  );
}
