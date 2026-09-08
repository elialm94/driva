"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { actionMenuItemClassName, useActionMenu, type ActionAppearance } from "./action-menu";
import { buttonClasses } from "./ui";
import { useToast } from "./toast";

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
  const menu = useActionMenu();
  const { toast } = useToast();
  const inMenu = appearance === "menu";

  async function copy() {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Kopiera länken:", url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // I en meny stängs menyn direkt – bekräftelsen syns i toasten i stället för i en stängd meny.
    if (inMenu) {
      menu?.close();
      toast({ title: copiedLabel.replace(/^✓\s*/, ""), text: "Klistra in den i ett sms eller mejl till kunden.", tone: "ok" });
    }
  }

  return (
    <button
      type="button"
      role={inMenu ? "menuitem" : undefined}
      className={inMenu ? actionMenuItemClassName() : buttonClasses("secondary", "sm")}
      onClick={copy}
    >
      {copied && !inMenu ? <Check className="size-3.5 shrink-0 text-ok" /> : <Link2 className="size-3.5 shrink-0" />}
      <span className={copied && !inMenu ? "text-ok" : undefined}>{copied && !inMenu ? copiedLabel : label}</span>
    </button>
  );
}
