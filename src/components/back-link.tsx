"use client";

import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { defaultBack, resolveBack } from "@/lib/nav";

export const backLinkClassName =
  "inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-ink";

export function BackAnchor({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href as never} className={backLinkClassName} data-nav="back" aria-label={`Tillbaka till ${label}`}>
      <ArrowLeft className="size-4" />
      {label}
    </Link>
  );
}

export function BackLink({
  fallbackHref,
  fallbackLabel,
  ignoreReturnTo = false,
}: {
  fallbackHref: string;
  fallbackLabel: string;
  ignoreReturnTo?: boolean;
}) {
  const fallback = { href: fallbackHref, label: fallbackLabel };
  if (ignoreReturnTo) return <BackAnchor href={fallback.href} label={fallback.label} />;
  return (
    <Suspense fallback={<BackAnchor href={fallback.href} label={fallback.label} />}>
      <BackLinkInner fallback={fallback} />
    </Suspense>
  );
}

function BackLinkInner({ fallback }: { fallback: { href: string; label: string } }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const back = resolveBack(pathname, searchParams, fallback) ?? fallback;
  return <BackAnchor href={back.href} label={back.label} />;
}

export function useBackNavigation(fallback: { href: string; label: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return resolveBack(pathname, searchParams, fallback) ?? fallback;
}

/**
 * Origin-aware back. Uses `tillbaka` when valid, otherwise the route's
 * canonical parent. Pass fallback only to override label/href (create flows).
 */
export function SmartBack({
  fallbackHref,
  fallbackLabel,
  ignoreReturnTo = false,
}: {
  fallbackHref?: string;
  fallbackLabel?: string;
  ignoreReturnTo?: boolean;
} = {}) {
  const pathname = usePathname();
  const auto = defaultBack(pathname);
  return (
    <BackLink
      fallbackHref={fallbackHref ?? auto?.href ?? "/"}
      fallbackLabel={fallbackLabel ?? auto?.label ?? "Tillbaka"}
      ignoreReturnTo={ignoreReturnTo}
    />
  );
}
