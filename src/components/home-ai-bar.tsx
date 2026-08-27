"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { AssistantMessage } from "@/lib/types";
import { AssistantComposer, AssistantMessageList, useAssistantSend } from "./assistant-ui";

const CHIPS = ["Skapa offert", "Vem har inte betalat?", "Vad behöver jag göra idag?"];
const EXPANDED_KEY = "driva-home-ai-expanded";

function persistExpanded(value: boolean) {
  try {
    sessionStorage.setItem(EXPANDED_KEY, value ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}

function readExpandedPref(): boolean | null {
  try {
    const v = sessionStorage.getItem(EXPANDED_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* ignore */
  }
  return null;
}

/** `messages` är de senaste raderna (servern skickar bara det som visas, inte hela historiken). */
export function HomeAiBar({ messages, hasUserTurn }: { messages: AssistantMessage[]; hasUserTurn: boolean }) {
  const { pending, send } = useAssistantSend();
  const [expanded, setExpanded] = useState(hasUserTurn);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = readExpandedPref();
    if (stored !== null) setExpanded(stored);
  }, []);

  const visible = useMemo(() => (hasUserTurn ? messages.slice(-6) : []), [hasUserTurn, messages]);

  useEffect(() => {
    if (expanded) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [expanded, visible.length, pending]);

  function expand() {
    setExpanded(true);
    persistExpanded(true);
  }

  function collapse() {
    setExpanded(false);
    persistExpanded(false);
  }

  function onSend(text: string) {
    expand();
    send(text);
  }

  return (
    <section className="mt-8 w-full">
      {!expanded ? (
        <p className="cursor-pointer text-sm font-medium text-ink" onClick={expand}>
          Vad vill du göra?
        </p>
      ) : null}

      {expanded ? (
        <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-card shadow-card">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <p className="text-[13px] font-medium text-soft">Driva</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={collapse}
                className="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink"
              >
                <ChevronDown className="size-3.5" />
                Minimera
              </button>
              <Link href="/assistent" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:text-accent-deep">
                Öppna i Assistent <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
          </div>
          <div className="max-h-72 space-y-3 overflow-y-auto px-4 py-3">
            {hasUserTurn ? (
              <AssistantMessageList messages={visible} busy={pending} compact />
            ) : (
              <div className="flex flex-col gap-1.5">
                {CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    disabled={pending}
                    onClick={() => onSend(chip)}
                    className="rounded-xl px-3 py-2 text-left text-[13.5px] font-medium text-soft transition-colors hover:bg-canvas hover:text-ink disabled:opacity-50"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>
      ) : null}

      <div
        className="mt-3 w-full"
        onClick={(e) => {
          if (expanded) return;
          if ((e.target as HTMLElement).closest("button")) return;
          expand();
        }}
        onFocusCapture={(e) => {
          if (expanded) return;
          const tag = (e.target as HTMLElement).tagName;
          if (tag === "INPUT" || tag === "TEXTAREA") expand();
        }}
      >
        <AssistantComposer
          variant="compact"
          placeholder="Fråga om företaget eller be mig fixa något..."
          suggestions={expanded ? undefined : CHIPS}
          pending={pending}
          onSend={onSend}
        />
      </div>
    </section>
  );
}
