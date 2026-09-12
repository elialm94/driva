"use client";

import { useRef, useState } from "react";
import { BadgeCheck, ChevronDown, ChevronUp, CircleHelp, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { AttentionRow, type AttentionToast } from "./attention-list";
import { Card, cx } from "./ui";
import { useBookkeepingModeSwitch } from "./bokforing-mode-switch";
import {
  SIMPLE_QUEUE_INITIAL,
  simpleQueueState,
  type DecisionCard,
  type SimpleQueueState,
} from "@/lib/services/decision-cards";

/**
 * Enkel bokföring: EN arbetskö. Överst ett enda tillstånd (Allt är klart /
 * N saker behöver dig / Ferva arbetar), sedan högst fem beslutskort och
 * "Visa fler". Knapparna är samma CTA:er som Hem och redovisningsvyn – det
 * här är en ram runt åtgärdsmotorn, inte en andra motor.
 */
export function SimpleBookkeepingQueue({
  cards,
  working,
  nextDeadline,
  anchorId,
}: {
  cards: DecisionCard[];
  working?: { documents: number; bankSyncing: boolean };
  nextDeadline?: { label: string; date: string };
  anchorId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [resolvedIds, setResolvedIds] = useState<readonly string[]>([]);
  const [toasts, setToasts] = useState<AttentionToast[]>([]);
  const sectionRef = useRef<HTMLDivElement>(null);

  const active = cards.filter((c) => !resolvedIds.includes(c.id));
  const state = simpleQueueState({ cards: active, working, nextDeadline });
  const visible = expanded ? cards : cards.slice(0, SIMPLE_QUEUE_INITIAL);
  const hidden = cards.length - visible.length;
  const toastById = new Map(toasts.map((t) => [t.id, t]));

  return (
    <div ref={sectionRef} id={anchorId} className="scroll-mt-6">
      <QueueHeadline state={state} />

      {cards.length > 0 ? (
        <div className="mt-5 card divide-y divide-line/70" data-simple-queue>
          {visible.map((card) => (
            <AttentionRow
              key={card.id}
              item={card.action}
              decision={card}
              toast={toastById.get(card.id)}
              onResolved={(id) => setResolvedIds((prev) => (prev.includes(id) ? prev : [...prev, id]))}
              onToast={(text, undo) =>
                setToasts((prev) => [
                  ...prev.filter((t) => t.id !== card.id),
                  { id: card.id, item: card.action, text, undo },
                ])
              }
              onClearToast={() => {
                setToasts((prev) => prev.filter((t) => t.id !== card.id));
                setResolvedIds((prev) => prev.filter((id) => id !== card.id));
              }}
            />
          ))}
          {hidden > 0 || expanded ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => {
                setExpanded((v) => !v);
                if (expanded) requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ block: "nearest" }));
              }}
              className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-b-[calc(1.25rem-1px)] px-5 py-3 text-[13px] font-medium text-soft transition-colors hover:bg-canvas/60 hover:text-ink"
            >
              {expanded ? "Visa färre" : `Visa ${hidden} fler`}
              {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function QueueHeadline({ state }: { state: SimpleQueueState }) {
  const icon =
    state.kind === "klart" ? (
      <BadgeCheck className="size-5 text-ok" />
    ) : state.kind === "arbetar" ? (
      <LoaderCircle className="size-5 animate-spin text-muted" />
    ) : (
      <CircleHelp className="size-5 text-warn" />
    );
  return (
    <div data-simple-queue-state={state.kind}>
      <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
        {icon}
        {state.title}
      </h2>
      <p className={cx("mt-0.5 text-[14px] text-soft", state.kind === "behover" && "line-clamp-2")}>{state.text}</p>
    </div>
  );
}

/**
 * Diskret fot under kön: "Visa allt" i Underlag/Bank/Moms och den sekundära
 * vägen in i redovisningsvyn. Aldrig en primärknapp – kön är huvudvägen.
 */
export function SimpleQueueFooter({ allowModeSwitch = true }: { allowModeSwitch?: boolean }) {
  const { switchTo, pending } = useBookkeepingModeSwitch();
  const links: { href: string; label: string }[] = [
    { href: "/bokforing/underlag", label: "Alla underlag" },
    { href: "/bokforing/bank", label: "Alla banktransaktioner" },
    { href: "/bokforing/moms", label: "Moms" },
    { href: "/bokforing/deklarationer", label: "Deklarationer" },
  ];
  return (
    <Card className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 text-[13px]">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-soft">
        <span className="text-muted">Visa allt:</span>
        {links.map((l) => (
          <Link key={l.href} href={l.href as never} className="font-medium text-accent hover:underline">
            {l.label}
          </Link>
        ))}
      </p>
      {allowModeSwitch ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => switchTo("avancerat")}
          data-bokforing-mode="enkelt"
          className="font-medium text-muted hover:text-ink"
        >
          Öppna redovisningsvyn
        </button>
      ) : null}
    </Card>
  );
}
