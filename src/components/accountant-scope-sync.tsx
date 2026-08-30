"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { clearAccountantClientCookieAction, rememberAccountantClientAction } from "@/app/collaboration-actions";
import { parseSelectedClientId } from "@/lib/collaboration/switch";

/** Håller BUSINESS_COOKIE i synk med URL:n – inte UI-only scope. */
export function AccountantScopeSync() {
  const pathname = usePathname();
  const clientId = parseSelectedClientId(pathname);

  useEffect(() => {
    if (clientId) void rememberAccountantClientAction(clientId);
    else if (pathname === "/redovisning" || pathname.startsWith("/redovisning/installningar")) {
      void clearAccountantClientCookieAction();
    }
  }, [clientId, pathname]);

  return null;
}
