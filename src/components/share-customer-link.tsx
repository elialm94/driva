"use client";

import { MessageSquare, Share2 } from "lucide-react";
import { CopyLinkButton } from "./copy-button";
import { actionMenuItemClassName, useActionMenu, type ActionAppearance } from "./action-menu";
import { buttonClasses } from "./ui";
import { canUseWebShare, customerShareText, smsShareHref } from "@/lib/customer-link-share";
import { useToast } from "./toast";

export function ShareCustomerLink({
  path,
  kind,
  number,
  phone,
  appearance = "button",
}: {
  path: string;
  kind: "offert" | "faktura";
  number?: string | number;
  phone?: string;
  appearance?: ActionAppearance;
}) {
  const menu = useActionMenu();
  const { toast } = useToast();
  const inMenu = appearance === "menu";
  const text = customerShareText(kind, number);

  async function shareNative() {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.share({ title: text, text, url });
      menu?.close();
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return;
      toast({ title: "Kunde inte öppna delning", tone: "danger" });
    }
  }

  return (
    <div className={inMenu ? "contents" : "flex flex-wrap gap-2"}>
      <CopyLinkButton path={path} appearance={appearance} copiedLabel="✓ Kundlänken är kopierad" />
      {canUseWebShare() ? (
        <button
          type="button"
          role={inMenu ? "menuitem" : undefined}
          className={inMenu ? actionMenuItemClassName() : buttonClasses("secondary", "sm")}
          onClick={() => void shareNative()}
        >
          <Share2 className="size-3.5 shrink-0" />
          Dela
        </button>
      ) : null}
      <a
        href={smsShareHref("https://placeholder.local", phone, text)}
        role={inMenu ? "menuitem" : undefined}
        className={inMenu ? actionMenuItemClassName() : buttonClasses("secondary", "sm")}
        onClick={(e) => {
          const url = `${window.location.origin}${path}`;
          e.currentTarget.href = smsShareHref(url, phone, text);
          menu?.close();
        }}
      >
        <MessageSquare className="size-3.5 shrink-0" />
        SMS
      </a>
    </div>
  );
}
