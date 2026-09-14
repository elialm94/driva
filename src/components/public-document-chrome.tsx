import type { ReactNode } from "react";
import { cx } from "./ui";

/**
 * Sidfot på publika kunddokument (/offert, /faktura, /andring, /uppdrag-kund).
 * Avsändaren är kundens företag – inte produkten. Ingen produktmarkering i
 * sidfoten.
 */
export function PublicDocumentFooter({
  sellerName,
  sellerEmail,
  className,
  children,
}: {
  sellerName: string;
  sellerEmail: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <p className={cx("mt-6 text-center text-[12px] text-muted", className)}>
      Frågor? Kontakta {sellerName} på {sellerEmail}
      {children}
    </p>
  );
}
