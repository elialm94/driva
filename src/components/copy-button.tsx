"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { buttonClasses } from "./ui";

export function CopyLinkButton({ path, label = "Kopiera kundlänk" }: { path: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={buttonClasses("secondary", "sm")}
      onClick={async () => {
        const url = `${window.location.origin}${path}`;
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          window.prompt("Kopiera länken:", url);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="size-3.5 text-ok" /> : <Link2 className="size-3.5" />}
      {copied ? "Kopierad!" : label}
    </button>
  );
}
