"use client";

import { useEffect, useRef } from "react";
import type { AssistantMessage } from "@/lib/types";
import { AssistantComposer, AssistantMessageList, useAssistantSend } from "./assistant-ui";

const SUGGESTIONS = [
  "Hur går företaget?",
  "Vilka kunder har inte betalat?",
  "Skicka en påminnelse till alla vars fakturor är sena",
  "Följ upp offerter som väntat mer än 7 dagar",
  "Vilka köp saknar kvitto?",
  "Hur mycket kan jag spendera utan att riskera momsen?",
  "Skapa en offert till Anna",
];

export function AssistantChat({ messages }: { messages: AssistantMessage[] }) {
  const { pending, send } = useAssistantSend();
  const endRef = useRef<HTMLDivElement>(null);
  const count = messages.length;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [count, pending]);

  return (
    <div className="flex h-[calc(100dvh-220px)] min-h-105 flex-col lg:h-[calc(100dvh-190px)]">
      <div className="flex-1 space-y-5 overflow-y-auto pb-6 pr-1">
        <AssistantMessageList messages={messages} busy={pending} />
        <div ref={endRef} />
      </div>
      <div className="border-t border-line pt-4">
        <AssistantComposer
          variant="full"
          placeholder='Skriv vad du vill ha gjort, t.ex. "Skapa en offert till Anna" …'
          suggestions={SUGGESTIONS}
          pending={pending}
          onSend={send}
        />
        <p className="mt-2 text-[11.5px] text-muted">
          Assistenten utför riktiga åtgärder i systemet. Viktiga utskick kräver alltid din bekräftelse först.
        </p>
      </div>
    </div>
  );
}
