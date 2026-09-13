"use client";

import { useState, useTransition } from "react";
import { CreditCard, ExternalLink } from "lucide-react";
import { openCustomerPortalAction, startCheckoutAction } from "@/app/abonnemang-actions";
import type { BillingAccess } from "@/lib/billing/state";
import { Badge, Card, buttonClasses, type BadgeTone } from "./ui";

export interface AbonnemangCardProps {
  access: BillingAccess;
  configured: boolean;
  canManage: boolean;
  plan: { name: string; pricePerMonthExVat: number; trialDays: number };
  /** ?checkout=klart|avbrutet efter återkomst från Stripe. */
  checkoutResult?: "klart" | "avbrutet";
  /** Avtalspart (LEGAL_*). null ⇒ Checkout är blockerad tills uppgifterna finns. */
  legalEntity?: { name: string; orgNumber: string } | null;
}

const TONE: Record<BillingAccess["reason"], BadgeTone> = {
  demo: "neutral",
  legacy: "neutral",
  trial: "info",
  active: "ok",
  cancel_scheduled: "warn",
  grace: "warn",
  trial_expired: "danger",
  subscription_ended: "danger",
  canceled: "danger",
};

const LABEL: Record<BillingAccess["reason"], string> = {
  demo: "Demo",
  legacy: "Utan provperiod",
  trial: "Provperiod",
  active: "Aktivt",
  cancel_scheduled: "Uppsagt",
  grace: "Betalning väntar",
  trial_expired: "Skrivskyddat",
  subscription_ended: "Skrivskyddat",
  canceled: "Skrivskyddat",
};

/**
 * Abonnemangskortet under Inställningar → Konto. Diskret under provperioden
 * (en rad med dagar kvar), tydligt när något behöver göras. Kortet påstår
 * aldrig att ett abonnemang finns – det visar vad webhooken skrivit.
 */
export function AbonnemangCard({ access, configured, canManage, plan, checkoutResult, legalEntity }: AbonnemangCardProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: false; error: string } | void>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result && !result.ok) setError(result.error);
    });
  }

  const showCheckout =
    access.reason === "trial" || access.reason === "trial_expired" || access.reason === "subscription_ended" || access.reason === "canceled" || access.reason === "legacy";
  const showPortal = access.hasStripeCustomer && (access.hasStripeSubscription || access.reason === "grace" || access.reason === "cancel_scheduled");

  return (
    <Card className="space-y-3 p-6" data-abonnemang={access.reason}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Abonnemang</p>
        <Badge tone={TONE[access.reason]}>{LABEL[access.reason]}</Badge>
      </div>

      {checkoutResult === "klart" ? (
        <p className="rounded-xl bg-ok/10 px-3 py-2 text-[13px] text-ink" role="status">
          Tack! Betalningen registreras hos Stripe och abonnemanget aktiveras här så snart Stripe bekräftat det – oftast inom
          någon minut. Ladda om sidan om statusen inte ändrats.
        </p>
      ) : null}
      {checkoutResult === "avbrutet" ? (
        <p className="rounded-xl bg-canvas px-3 py-2 text-[13px] text-soft" role="status">
          Betalningen avbröts. Inget har ändrats.
        </p>
      ) : null}

      <p className="text-[15px] leading-relaxed text-soft">{access.message}</p>

      {access.reason === "demo" ? null : (
        <p className="text-[13px] text-muted">
          {plan.name} kostar {plan.pricePerMonthExVat} kr per månad exklusive moms. Nya företag börjar med {plan.trialDays} dagars
          gratis provperiod utan kort. Uppsägning görs i kundportalen och gäller till periodens slut. Dina uppgifter raderas
          aldrig automatiskt – allt går alltid att läsa och exportera.
          {legalEntity ? (
            <>
              {" "}
              Avtalspart: {legalEntity.name} (org.nr {legalEntity.orgNumber}).{" "}
              <a href="/villkor" className="underline hover:text-ink">
                Villkor
              </a>
              .
            </>
          ) : null}
        </p>
      )}

      {access.reason === "demo" ? null : !configured ? (
        <p className="text-[13px] text-warn" data-abonnemang-unconfigured>
          Abonnemangsbetalning är inte konfigurerad för den här miljön. Företaget kan inte teckna abonnemang här ännu.
        </p>
      ) : legalEntity === null ? (
        <p className="text-[13px] text-warn" data-abonnemang-legal-missing>
          Abonnemang kan inte tecknas ännu: Fervas avtalsuppgifter (avtalspart) är inte konfigurerade i den här miljön.
        </p>
      ) : !canManage ? (
        <p className="text-[13px] text-muted">Bara företagets ägare eller administratör kan hantera abonnemanget.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {showCheckout ? (
            <button
              type="button"
              className={buttonClasses("primary", "sm")}
              disabled={isPending}
              onClick={() => run(startCheckoutAction)}
              data-abonnemang-checkout
            >
              <CreditCard className="size-3.5 shrink-0" />
              {isPending ? "Öppnar Stripe …" : access.reason === "trial" ? `Fortsätt med ${plan.name}` : "Teckna abonnemang"}
            </button>
          ) : null}
          {showPortal ? (
            <button
              type="button"
              className={buttonClasses(showCheckout ? "secondary" : "primary", "sm")}
              disabled={isPending}
              onClick={() => run(openCustomerPortalAction)}
              data-abonnemang-portal
            >
              <ExternalLink className="size-3.5 shrink-0" />
              {isPending ? "Öppnar …" : access.reason === "grace" ? "Uppdatera kort i kundportalen" : "Hantera abonnemang"}
            </button>
          ) : null}
          <span className="text-[12px] text-muted">Betalningen sker hos Stripe. Ferva lagrar inga kortuppgifter.</span>
        </div>
      )}

      {error ? (
        <p className="text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
