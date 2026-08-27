"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { actionMenuItemClassName, type ActionAppearance } from "./action-menu";
import { buttonClasses } from "./ui";

export function CopyLinkButton({
  path,
  label = "Kopiera kundlänk",
  copiedLabel = "Kopierad!",
  appearance = "button",
}: {
  path: string;
  label?: string;
  copiedLabel?: string;
  appearance?: ActionAppearance;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Kopiera länken:", url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      role={appearance === "menu" ? "menuitem" : undefined}
      className={appearance === "menu" ? actionMenuItemClassName() : buttonClasses("secondary", "sm")}
      onClick={copy}
    >
      {copied ? <Check className="size-3.5 shrink-0 text-ok" /> : <Link2 className="size-3.5 shrink-0" />}
      <span className={copied ? "text-ok" : undefined}>{copied ? copiedLabel : label}</span>
    </button>
  );
}
