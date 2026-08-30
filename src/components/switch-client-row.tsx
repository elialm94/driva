"use client";

import { switchClientAction } from "@/app/collaboration-actions";

export function SwitchClientRow({
  businessId,
  name,
  status,
}: {
  businessId: string;
  name: string;
  status: string;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-baseline justify-between gap-4 border-b border-line/70 px-3 py-2 text-left last:border-b-0 hover:bg-canvas/70"
      onClick={() => void switchClientAction(businessId)}
    >
      <span className="min-w-0 truncate text-[14px] font-medium text-ink">{name}</span>
      <span className="shrink-0 text-[12px] text-soft">{status}</span>
    </button>
  );
}
