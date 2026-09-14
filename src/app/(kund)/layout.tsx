import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Publika kunddokument. Avsändaren är kundens företag – fliken ska inte
 * få rotens mall "%s · Ferva", och fel-/404-sidorna i den här gruppen
 * bär ingen FervaMark (se error.tsx / not-found.tsx).
 */
export const metadata: Metadata = {
  title: { default: "Dokument", template: "%s" },
};

export default function PublicCustomerLayout({ children }: { children: ReactNode }) {
  return children;
}
