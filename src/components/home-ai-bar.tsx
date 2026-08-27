"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { AssistantMessage } from "@/lib/types";
import { AssistantComposer, AssistantMessageList, useAssistantSend } from "./assistant-ui";

const CHIPS = ["Skapa uppdrag", "Vem har inte betalat?", "Skapa offert", "Vad behöver jag göra idag?"];

export function HomeAiBar({ messages }: { messages: AssistantMessage[] }) {
  const { pending, send } = useAssistantSend();
  const hasUserTurn = messages.some((m) => m.role === "user");
  const [expanded, setExpanded] = useState(hasUserTurn);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hasUserTurn) setExpanded(true);
  }, [hasUserTurn]);

  const visible = useMemo(() => (hasUserTurn ? messages.slice(-6) : []), [hasUserTurn, messages]);

  useEffect(() => {
    if (expanded) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [expanded, visible.length, pending]);

  function onSend(text: string) {
    setExpanded(true);
    send(text);
  }

  return (
    <section className="mt-6 w-full">
      <p className="text-sm font-medium text-ink">Vad vill du göra?</p>

      {expanded ? (
        <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-card shadow-card">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <p className="text-[13px] font-medium text-soft">Driva</p>
            <Link href="/assistent" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:text-accent-deep">
              Öppna i Assistent <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
          <div className="max-h-72 space-y-3 overflow-y-auto px-4 py-3">
            <AssistantMessageList messages={visible} busy={pending} compact />
            <div ref={endRef} />
          </div>
        </div>
      ) : null}

      <div className="mt-3 w-full">
        <AssistantComposer
          variant="compact"
          placeholder="Fråga om företaget eller be mig fixa något..."
          suggestions={CHIPS}
          pending={pending}
          onSend={onSend}
        />
      </div>
    </section>
  );
}
