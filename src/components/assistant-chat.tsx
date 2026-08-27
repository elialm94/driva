"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowUp, Check, Sparkles, X } from "lucide-react";
import type { AssistantCard, AssistantMessage } from "@/lib/types";
import { buttonClasses, cx } from "./ui";
import {
  cancelAssistantActionAction,
  confirmAssistantActionAction,
  sendAssistantMessageAction,
} from "@/app/actions";

const SUGGESTIONS = [
  "Hur går företaget?",
  "Vilka kunder har inte betalat?",
  "Skicka en påminnelse till alla vars fakturor är sena",
  "Följ upp offerter som väntat mer än 7 dagar",
  "Vilka köp saknar kvitto?",
  "Hur mycket kan jag spendera utan att riskera momsen?",
  "Skapa en offert till Anna",
];

function CardView({ card, busy, onConfirm, onCancel }: {
  card: AssistantCard;
  busy: boolean;
  onConfirm: (actionId: string) => void;
  onCancel: (actionId: string) => void;
}) {
  if (card.kind === "links") {
    return (
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {card.links.map((l) => (
          <Link key={l.href + l.label} href={l.href as never} className={buttonClasses("secondary", "sm")}>
            {l.label}
          </Link>
        ))}
      </div>
    );
  }

  if (card.kind === "list") {
    return (
      <div className="mt-2.5 overflow-hidden rounded-xl border border-line bg-card">
        {card.title ? (
          <p className="border-b border-line bg-canvas/60 px-3.5 py-2 text-[12px] font-semibold text-soft">{card.title}</p>
        ) : null}
        <div className="divide-y divide-line/70">
          {card.rows.map((r, i) =>
            r.href ? (
              <Link
                key={i}
                href={r.href as never}
                className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13.5px] transition-colors hover:bg-canvas/60"
              >
                <span className="font-medium">{r.label}</span>
                {r.value ? <span className="shrink-0 text-muted tabular">{r.value}</span> : null}
              </Link>
            ) : (
              <div key={i} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13.5px]">
                <span className="font-medium">{r.label}</span>
                {r.value ? <span className="shrink-0 text-muted tabular">{r.value}</span> : null}
              </div>
            )
          )}
        </div>
        {card.links?.length ? (
          <div className="flex flex-wrap gap-1.5 border-t border-line bg-canvas/40 px-3.5 py-2.5">
            {card.links.map((l) => (
              <Link key={l.href + l.label} href={l.href as never} className={buttonClasses("secondary", "sm")}>
                {l.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (card.kind === "entity") {
    return (
      <div className="mt-2.5 overflow-hidden rounded-xl border border-line bg-card">
        <div className="flex items-center justify-between gap-3 px-3.5 py-3">
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium">{card.title}</p>
            {card.subtitle ? <p className="mt-0.5 text-[12.5px] text-muted">{card.subtitle}</p> : null}
          </div>
          <Link href={card.href as never} className={buttonClasses("secondary", "sm")}>
            {card.openLabel}
          </Link>
        </div>
      </div>
    );
  }

  if (card.kind === "create_customer") {
    return (
      <div className="mt-2.5 overflow-hidden rounded-xl border border-accent/25 bg-accent-soft/40">
        <div className="px-3.5 py-3">
          <p className="text-[13.5px] font-medium leading-relaxed">
            Lägg till {card.suggestedName} som kund?
          </p>
        </div>
        <div className="border-t border-accent/15 px-3.5 py-2.5">
          {card.state === "vantar" ? (
            <div className="flex gap-2">
              <button className={buttonClasses("primary", "sm")} disabled={busy} onClick={() => onConfirm(card.actionId)}>
                <Check className="size-3.5" /> Lägg till kund
              </button>
              <button className={buttonClasses("ghost", "sm")} disabled={busy} onClick={() => onCancel(card.actionId)}>
                <X className="size-3.5" /> Avbryt
              </button>
            </div>
          ) : (
            <p className={cx("text-[13px] font-medium", card.state === "utford" ? "text-ok" : "text-muted")}>
              {card.state === "utford" ? (card.resultText ?? "Utfört.") : "Avbrutet – inget skickades."}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border border-accent/25 bg-accent-soft/40">
      <div className="px-3.5 py-3">
        <p className="text-[13.5px] leading-relaxed font-medium">{card.summary}</p>
        {card.rows?.length ? (
          <div className="mt-2 space-y-1">
            {card.rows.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="text-soft">{r.label}</span>
                {r.value ? <span className="font-medium tabular">{r.value}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="border-t border-accent/15 px-3.5 py-2.5">
        {card.state === "vantar" ? (
          <div className="flex gap-2">
            <button className={buttonClasses("primary", "sm")} disabled={busy} onClick={() => onConfirm(card.actionId)}>
              <Check className="size-3.5" /> {card.confirmLabel}
            </button>
            <button className={buttonClasses("ghost", "sm")} disabled={busy} onClick={() => onCancel(card.actionId)}>
              <X className="size-3.5" /> Avbryt
            </button>
          </div>
        ) : (
          <p className={cx("text-[13px] font-medium", card.state === "utford" ? "text-ok" : "text-muted")}>
            {card.state === "utford" ? (card.resultText ?? "Utfört.") : "Avbrutet – inget skickades."}
          </p>
        )}
      </div>
    </div>
  );
}

export function AssistantChat({ messages }: { messages: AssistantMessage[] }) {
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const count = messages.length;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [count, pending]);

  function send(msg: string) {
    const trimmed = msg.trim();
    if (!trimmed) return;
    setText("");
    startTransition(async () => {
      await sendAssistantMessageAction(trimmed);
    });
  }

  return (
    <div className="flex h-[calc(100dvh-220px)] min-h-105 flex-col lg:h-[calc(100dvh-190px)]">
      {/* Meddelanden */}
      <div className="flex-1 space-y-5 overflow-y-auto pb-6 pr-1">
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[14.5px] leading-relaxed text-white sm:max-w-[70%]">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex gap-3">
              <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink text-white">
                <Sparkles className="size-3.5" />
              </div>
              <div className="max-w-[85%] sm:max-w-[75%]">
                <div className="whitespace-pre-line rounded-2xl rounded-tl-md border border-line bg-card px-4 py-2.5 text-[14.5px] leading-relaxed shadow-card">
                  {m.text}
                </div>
                {m.card ? (
                  <CardView
                    card={m.card}
                    busy={pending}
                    onConfirm={(id) => startTransition(async () => confirmAssistantActionAction(id))}
                    onCancel={(id) => startTransition(async () => cancelAssistantActionAction(id))}
                  />
                ) : null}
              </div>
            </div>
          )
        )}
        {pending ? (
          <div className="flex gap-3">
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink text-white">
              <Sparkles className="size-3.5 animate-pulse" />
            </div>
            <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-line bg-card px-4 py-3 shadow-card">
              <span className="size-1.5 animate-bounce rounded-full bg-muted [animation-delay:0ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted [animation-delay:120ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted [animation-delay:240ms]" />
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {/* Förslag + input */}
      <div className="border-t border-line pt-4">
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={pending}
              className="shrink-0 rounded-full border border-line bg-card px-3.5 py-1.5 text-[12.5px] font-medium text-soft transition-colors hover:border-accent hover:text-ink disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            rows={1}
            placeholder='Skriv vad du vill ha gjort, t.ex. "Skapa en offert till Anna" …'
            className="max-h-32 min-h-12 flex-1 resize-none rounded-2xl border border-line-strong bg-card px-4 py-3 text-[15px] leading-relaxed placeholder:text-muted focus:border-accent"
          />
          <button
            type="submit"
            disabled={!text.trim() || pending}
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-white transition-all hover:bg-accent-deep disabled:opacity-40"
            aria-label="Skicka"
          >
            <ArrowUp className="size-5" />
          </button>
        </form>
        <p className="mt-2 text-[11.5px] text-muted">
          Assistenten utför riktiga åtgärder i systemet. Viktiga utskick kräver alltid din bekräftelse först.
        </p>
      </div>
    </div>
  );
}
