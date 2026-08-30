"use client";

import {
  enterLocalAccountantDemoAction,
  leaveLocalAccountantDemoAction,
  switchWorkspaceAction,
} from "@/app/collaboration-actions";

export function WorkspaceSwitcher({
  variant,
  clientCount,
  localDemo = false,
}: {
  variant: "to-redovisning" | "to-owner";
  clientCount?: number;
  /** JSON-läge: byt lokal identitet, inte bara workspace-cookie. */
  localDemo?: boolean;
}) {
  if (variant === "to-redovisning") {
    const n = clientCount ?? 0;
    return (
      <button
        type="button"
        onClick={() =>
          void (localDemo ? enterLocalAccountantDemoAction() : switchWorkspaceAction("redovisning"))
        }
        className="rounded-xl px-3 py-2.5 text-left text-[14px] text-soft hover:bg-ink/5 hover:text-ink"
      >
        Redovisning ({n} {n === 1 ? "klient" : "klienter"})
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void (localDemo ? leaveLocalAccountantDemoAction() : switchWorkspaceAction("owner"))}
      className="rounded-xl px-3 py-2.5 text-left text-[14px] text-soft hover:bg-ink/5 hover:text-ink"
    >
      Mitt företag
    </button>
  );
}
