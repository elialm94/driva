"use client";

import { useState, useTransition } from "react";
import { AppLink } from "./app-link";
import { Check, UserPlus, X } from "lucide-react";
import type { AssistantCard } from "@/lib/types";
import { buttonClasses, cx } from "./ui";
import { NewCustomerModal } from "./new-customer-modal";
import {
  cancelAssistantActionAction,
  completeAssistantCustomerAction,
  confirmAssistantActionAction,
} from "@/app/actions";

/**
 * Kortvyer för verktygsresultat (länkar, entitet, lista, bekräftelse,
 * ny kund). Används av kommandofältets resultatpanel – chattbubblorna som
 * tidigare bodde här är borttagna tillsammans med chatt-UI:t.
 */
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
          <AppLink key={l.href + l.label} href={l.href as never} className={buttonClasses("secondary", "sm")}>
            {l.label}
          </AppLink>
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
        <AppLink href={card.href as never} className={buttonClasses("secondary", "sm")}>
          {card.openLabel}
        </AppLink>
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
              <AppLink
                key={i}
                href={r.href as never}
                className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13.5px] transition-colors hover:bg-canvas/60"
              >
                <span className="font-medium">{r.label}</span>
                {r.value ? <span className="shrink-0 text-muted tabular">{r.value}</span> : null}
              </AppLink>
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
              <AppLink key={l.href + l.label} href={l.href as never} className={buttonClasses("secondary", "sm")}>
                {l.label}
              </AppLink>
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
