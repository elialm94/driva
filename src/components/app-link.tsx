"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, type ComponentProps, type MouseEvent } from "react";
import { locationHref, resolveAppHref } from "@/lib/nav";
import { isOwnerWorkspaceHref, workspaceBaseFromPathname, workspaceHref } from "@/lib/accounting-workspace/tabs";
import { saveScrollPosition } from "./nav-origin";

/**
 * Ägaradresser (/bokforing/…) som renderas på konsultytan pekas om till
 * /redovisning/k/<id>/… redan i React. Basvägen läses ur pathname, som är
 * densamma på server och klient – DOM-omskrivning i efterhand gav
 * hydreringsfel när anchorn hydrerades efter att attributet ändrats.
 */
function scopeToWorkspace(pathname: string, href: string): string {
  const base = workspaceBaseFromPathname(pathname);
  return isOwnerWorkspaceHref(href) ? workspaceHref(base, href) : href;
}

type LinkProps = ComponentProps<typeof Link>;

/**
 * In-app link that stamps the current view as origin when the destination
 * shows a Back control. Sidebar/bottom-nav should keep using next/link.
 */
export function AppLink({
  href,
  originLabel,
  stampOrigin = true,
  onClick,
  ...rest
}: Omit<LinkProps, "href"> & {
  href: string;
  originLabel?: string;
  stampOrigin?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const origin = locationHref(pathname, searchParams);
  const scoped = scopeToWorkspace(pathname, href);
  const nextHref =
    stampOrigin && scoped.startsWith("/") && !scoped.startsWith("//")
      ? resolveAppHref(scoped, origin, originLabel)
      : scoped;

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    saveScrollPosition();
    onClick?.(e);
  }

  return <Link href={nextHref as never} onClick={handleClick} {...rest} />;
}

/** router.push that stamps origin the same way AppLink does. */
export function useAppNavigate() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return useCallback(
    (href: string) => {
      saveScrollPosition();
      const origin = locationHref(pathname, searchParams);
      router.push(resolveAppHref(scopeToWorkspace(pathname, href), origin) as never);
    },
    [router, pathname, searchParams]
  );
}
