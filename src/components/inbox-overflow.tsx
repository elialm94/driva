"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyeOff } from "lucide-react";
import { ActionMenu, actionMenuItemClassName, useActionMenu } from "./action-menu";
import { markInboxMailProcessedAction } from "@/app/actions";

/**
 * Sekundära åtgärder under "…" – livscykeln avgör behandlat-status, så
 * "Ignorera" är en undantagsåtgärd för dokument som inte är relevanta,
 * aldrig en primär knapp (krav: inget "Markera behandlad" i huvudflödet).
 */
export function InboxOverflowMenu({ itemId, canIgnore }: { itemId: string; canIgnore: boolean }) {
  if (!canIgnore) return null;
  return (
    <ActionMenu label="Fler åtgärder">
      <IgnoreItem itemId={itemId} />
    </ActionMenu>
  );
}

function IgnoreItem({ itemId }: { itemId: string }) {
  const router = useRouter();
  const menu = useActionMenu();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      role="menuitem"
      className={actionMenuItemClassName()}
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await markInboxMailProcessedAction(itemId);
          menu?.close();
          router.refresh();
        });
      }}
    >
      <EyeOff className="size-4 text-muted" />
      {pending ? "Ignorerar …" : "Ignorera / markera som ej relevant"}
    </button>
  );
}
