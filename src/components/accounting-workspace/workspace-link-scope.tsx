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
 * Länkar med modifierartangent (ny flik) lämnas orörda men får sin href
 * omskriven i DOM:en vid mount så att även "öppna i ny flik" landar rätt.
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

    root.querySelectorAll<HTMLAnchorElement>('a[href^="/bokforing"]').forEach(rewrite);
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return;
          if (n instanceof HTMLAnchorElement) rewrite(n);
          n.querySelectorAll?.<HTMLAnchorElement>('a[href^="/bokforing"]').forEach(rewrite);
        });
        if (r.type === "attributes" && r.target instanceof HTMLAnchorElement) rewrite(r.target);
      }
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });

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
    return () => {
      observer.disconnect();
      root.removeEventListener("click", onClick, true);
    };
  }, [basePath, router]);

  return <div ref={ref}>{children}</div>;
}
