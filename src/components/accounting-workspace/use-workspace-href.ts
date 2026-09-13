"use client";

import { usePathname } from "next/navigation";
import { useCallback } from "react";
import { workspaceBaseFromPathname, workspaceHref } from "@/lib/accounting-workspace/tabs";

/**
 * Översätter ägaradresser (/bokforing/…) till den arbetsyta klienten står på.
 * För programmatisk navigering (router.replace/push) där länkskyddsnätet i
 * WorkspaceLinkScope inte kan fånga något klick.
 */
export function useWorkspaceHref(): (ownerHref: string) => string {
  const pathname = usePathname();
  const base = workspaceBaseFromPathname(pathname);
  return useCallback((ownerHref: string) => workspaceHref(base, ownerHref), [base]);
}
