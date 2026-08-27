"use client";

import { useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowUp, Check, Sparkles, UserPlus, X } from "lucide-react";
import type { AssistantCard, AssistantMessage } from "@/lib/types";
import { buttonClasses, cx } from "./ui";
import { NewCustomerModal } from "./new-customer-modal";
import {
  cancelAssistantActionAction,
  completeAssistantCustomerAction,
  confirmAssistantActionAction,
  sendAssistantMessageAction,
} from "@/app/actions";

export function AssistantCardView({
  card,
  busy,
  compact = false,
}: {
  card: AssistantCard;
  busy: boolean;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const blocked = busy || pending;

  if (card.kind === "links") {
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {card.links.map((l) => (
          <Link key={l.href + l.label} href={l.href as never} className={buttonClasses("secondary", "sm")}>
            {l.label}
          </Link>
        ))}
      </div>
    );
  }

  if (card.kind === "entity") {
    return (
      <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-line bg-card px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium">{card.title}</p>
          {card.subtitle ? <p className="truncate text-[12px] text-muted">{card.subtitle}</p> : null}
        </div>
        <Link href={card.href as never} className={buttonClasses("secondary", "sm")}>
          {card.openLabel}
        </Link>
      </div>
    );
  }

  if (card.kind === "list") {
    return (
      <div className="mt-2 overflow-hidden rounded-xl border border-line bg-card">
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

  if (card.kind === "create_customer") {
    return (
      <CreateCustomerCard card={card} busy={blocked} compact={compact} />
    );
  }

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-accent/25 bg-accent-soft/40">
      <div className="px-3.5 py-3">
        <p className="text-[13.5px] font-medium leading-relaxed">{card.summary}</p>
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
            <button
              className={buttonClasses("primary", "sm")}
              disabled={blocked}
              onClick={() => startTransition(async () => confirmAssistantActionAction(card.actionId))}
            >
              <Check className="size-3.5" /> {card.confirmLabel}
            </button>
            <button
              className={buttonClasses("ghost", "sm")}
              disabled={blocked}
              onClick={() => startTransition(async () => cancelAssistantActionAction(card.actionId))}
            >
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

function CreateCustomerCard({
  card,
  busy,
}: {
  card: Extract<AssistantCard, { kind: "create_customer" }>;
  busy: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const blocked = busy || pending;

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-accent/25 bg-accent-soft/40">
      <div className="px-3.5 py-3">
        <p className="text-[13.5px] font-medium leading-relaxed">
          Lägg till {card.suggestedName} som kund så kan jag fortsätta.
        </p>
      </div>
      <div className="border-t border-accent/15 px-3.5 py-2.5">
        {card.state === "vantar" ? (
          <div className="flex gap-2">
            <button className={buttonClasses("primary", "sm")} disabled={blocked} onClick={() => setOpen(true)}>
              <UserPlus className="size-3.5" /> Lägg till {card.suggestedName}
            </button>
            <button
              className={buttonClasses("ghost", "sm")}
              disabled={blocked}
              onClick={() => startTransition(async () => cancelAssistantActionAction(card.actionId))}
            >
              <X className="size-3.5" /> Avbryt
            </button>
          </div>
        ) : (
          <p className={cx("text-[13px] font-medium", card.state === "utford" ? "text-ok" : "text-muted")}>
            {card.state === "utford" ? (card.resultText ?? "Kunden är tillagd.") : "Avbrutet."}
          </p>
        )}
      </div>
      <NewCustomerModal
        open={open}
        onClose={() => setOpen(false)}
        initialName={card.suggestedName}
        onCreated={(customer) => {
          startTransition(async () => completeAssistantCustomerAction(card.actionId, customer.id));
        }}
      />
    </div>
  );
}

export function AssistantMessageBubble({
  message,
  busy,
  compact = false,
}: {
  message: AssistantMessage;
  busy: boolean;
  compact?: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className={cx(
            "rounded-2xl rounded-br-md bg-accent text-white leading-relaxed",
            compact ? "max-w-[90%] px-3.5 py-2 text-[14px]" : "max-w-[85%] px-4 py-2.5 text-[14.5px] sm:max-w-[70%]"
          )}
        >
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <div className={cx("mt-0.5 flex shrink-0 items-center justify-center rounded-lg bg-ink text-white", compact ? "size-6" : "size-7")}>
        <Sparkles className={compact ? "size-3" : "size-3.5"} />
      </div>
      <div className={compact ? "min-w-0 max-w-[90%] flex-1" : "max-w-[85%] sm:max-w-[75%]"}>
        <div
          className={cx(
            "whitespace-pre-line rounded-2xl rounded-tl-md border border-line bg-card leading-relaxed shadow-card",
            compact ? "px-3.5 py-2 text-[14px]" : "px-4 py-2.5 text-[14.5px]"
          )}
        >
          {message.text}
        </div>
        {message.card ? <AssistantCardView card={message.card} busy={busy} compact={compact} /> : null}
      </div>
    </div>
  );
}

export function AssistantTyping({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex gap-3">
      <div className={cx("mt-0.5 flex shrink-0 items-center justify-center rounded-lg bg-ink text-white", compact ? "size-6" : "size-7")}>
        <Sparkles className={cx(compact ? "size-3" : "size-3.5", "animate-pulse")} />
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-line bg-card px-4 py-3 shadow-card">
        <span className="size-1.5 animate-bounce rounded-full bg-muted [animation-delay:0ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted [animation-delay:120ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted [animation-delay:240ms]" />
      </div>
    </div>
  );
}

export function AssistantMessageList({
  messages,
  busy,
  compact = false,
}: {
  messages: AssistantMessage[];
  busy: boolean;
  compact?: boolean;
}) {
  return (
    <div className={cx("space-y-4", compact && "space-y-3")}>
      {messages.map((m) => (
        <AssistantMessageBubble key={m.id} message={m} busy={busy} compact={compact} />
      ))}
      {busy ? <AssistantTyping compact={compact} /> : null}
    </div>
  );
}

export function AssistantComposer({
  variant,
  placeholder,
  suggestions,
  pending,
  onSend,
}: {
  variant: "full" | "compact";
  placeholder: string;
  suggestions?: string[];
  pending: boolean;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  function submit(msg: string) {
    const trimmed = msg.trim();
    if (!trimmed) return;
    setText("");
    onSend(trimmed);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(text);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit(text);
  }

  const chips =
    suggestions && suggestions.length > 0 ? (
      <div
        className={cx(
          "flex gap-1.5",
          variant === "compact" ? "flex-wrap" : "overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        )}
      >
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => submit(s)}
            disabled={pending}
            className="shrink-0 rounded-full border border-line bg-card px-3.5 py-1.5 text-[12.5px] font-medium text-soft transition-colors hover:border-accent hover:text-ink disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
    ) : null;

  const field =
    variant === "compact" ? (
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-card px-3.5 text-[15px] placeholder:text-muted focus:border-accent"
      />
    ) : (
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        placeholder={placeholder}
        className="max-h-32 min-h-12 flex-1 resize-none rounded-2xl border border-line-strong bg-card px-4 py-3 text-[15px] leading-relaxed placeholder:text-muted focus:border-accent"
      />
    );

  return (
    <div>
      {variant === "full" && chips ? <div className="mb-3">{chips}</div> : null}
      <form ref={formRef} className="flex w-full items-end gap-2" onSubmit={onSubmit}>
        {field}
        <button
          type="submit"
          disabled={!text.trim() || pending}
          className={cx(
            "flex shrink-0 items-center justify-center bg-accent text-white transition-all hover:bg-accent-deep disabled:opacity-40",
            variant === "compact" ? "size-11 rounded-xl" : "size-12 rounded-2xl"
          )}
          aria-label="Skicka"
        >
          <ArrowUp className={variant === "compact" ? "size-4.5" : "size-5"} />
        </button>
      </form>
      {variant === "compact" && chips ? <div className="mt-2.5">{chips}</div> : null}
    </div>
  );
}

export function useAssistantSend() {
  const [pending, startTransition] = useTransition();
  function send(msg: string) {
    startTransition(async () => {
      await sendAssistantMessageAction(msg);
    });
  }
  return { pending, send };
}
