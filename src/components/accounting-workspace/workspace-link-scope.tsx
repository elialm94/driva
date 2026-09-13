"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { isOwnerWorkspaceHref, workspaceHref } from "@/lib/accounting-workspace/tabs";

/**
 * Skyddsnät för den delade arbetsytan på konsultytan.
 *
 * De delade vykomponenterna länkar till ägarytans adresser (/bokforing/…).
 * De flesta går genom hrefFor/basePath, men bokföringen har hundratals
 * djupa länkar (åtgärdskort, momschecklistor, avstämningar) som byggs i
 * tjänstelagret. I stället för att tråckla basvägen genom varje tjänst fångas
 * klicket här och skrivs om till konsultytans motsvarighet innan navigeringen
 * sker – konsulten hamnar aldrig i ägarens layout.
 *
 * AppLink skriver om ägaradresser redan i React (scopeToWorkspace), så
 * server och klient renderar samma href. Här får DOM:en bara röras när
 * användaren interagerar (pointerdown/fokus/kontextmeny) – en omskrivning
 * vid mount hann före hydreringen av senare strömmade delar och gav
 * "attributes didn't match" på precis de länkarna. Efter interaktionen
 * landar även modifierarklick, mittenklick och "öppna i ny flik" rätt.
 */
export function WorkspaceLinkScope({ basePath, children }: { basePath: string; children: ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    function rewrite(anchor: HTMLAnchorElement) {
      const href = anchor.getAttribute("href");
      if (!href || !isOwnerWorkspaceHref(href)) return;
      anchor.setAttribute("href", workspaceHref(basePath, href));
    }

    function anchorOf(target: EventTarget | null): HTMLAnchorElement | null {
      return ((target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null) ?? null;
    }

    function onInteract(e: Event) {
      const anchor = anchorOf(e.target);
      if (anchor) rewrite(anchor);
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank") return;
      const href = anchor.getAttribute("href");
      if (!href || !isOwnerWorkspaceHref(href)) return;
      e.preventDefault();
      e.stopPropagation();
      router.push(workspaceHref(basePath, href) as never);
    }
    root.addEventListener("click", onClick, true);
    root.addEventListener("pointerdown", onInteract, true);
    root.addEventListener("focusin", onInteract, true);
    root.addEventListener("contextmenu", onInteract, true);
    return () => {
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("pointerdown", onInteract, true);
      root.removeEventListener("focusin", onInteract, true);
      root.removeEventListener("contextmenu", onInteract, true);
    };
  }, [basePath, router]);

  return <div ref={ref}>{children}</div>;
}
