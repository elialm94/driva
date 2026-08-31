"use client";

import { Printer } from "lucide-react";
import { actionMenuItemClassName, useActionMenu } from "./action-menu";

/**
 * "Skriv ut / PDF"-raden i offertens åtgärdsmeny. Egen klientkomponent:
 * menyradens klassnamn (actionMenuItemClassName) lever i klientmodulen och
 * kan inte anropas från serversidan – och menyn ska stängas vid klick.
 */
export function QuotePdfMenuItem({ href }: { href: string }) {
  const menu = useActionMenu();
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      role="menuitem"
      className={actionMenuItemClassName()}
      onClick={() => menu?.close()}
    >
      <Printer className="size-3.5 shrink-0" /> Skriv ut / PDF
    </a>
  );
}
