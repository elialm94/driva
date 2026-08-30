"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { buttonClasses } from "./ui";

export function InboxAddressCard({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      window.prompt("Kopiera adressen:", address);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mb-4 rounded-2xl border border-line bg-card px-4 py-3">
      <p className="text-[13px] text-muted">Inkommande adress</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{address}</span>
        <button type="button" className={buttonClasses("secondary", "sm")} onClick={copy}>
          {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
          {copied ? "Kopierad" : "Kopiera"}
        </button>
      </div>
      <p className="mt-2 text-[13px] text-soft">
        Ge adressen till leverantörer eller vidarebefordra fakturor och kvitton hit.
      </p>
    </div>
  );
}
