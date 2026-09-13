"use server";

import { redirect } from "next/navigation";
import { withBusiness } from "@/lib/auth/session";
import { requireUser } from "@/lib/auth/session";
import { createCheckoutUrl, createPortalUrl } from "@/lib/billing/checkout";
import { userFacingBillingError } from "@/lib/billing/errors";
import { appOrigin } from "@/lib/mail";
import { db } from "@/lib/store";
import { tenantContext } from "@/lib/storage/context";
import { isOwnerRole } from "@/lib/collaboration/permissions";
import { currentActor } from "@/lib/collaboration/actor";

/**
 * Abonnemanget: Stripe Checkout och kundportalen. Sessionerna skapas
 * server-side för det företag sessionen pekar på; klienten skickar inget id.
 * Körs med allowReadOnly – det är just när företaget är skrivskyddat som
 * knappen behövs. Bara ägare/administratör tecknar och hanterar abonnemang.
 */

type Result = { ok: false; error: string };

async function assertOwner(): Promise<void> {
  const actor = currentActor();
  if (!isOwnerRole(actor?.role)) {
    throw new Error("Bara företagets ägare eller administratör kan hantera abonnemanget.");
  }
}

async function buildContext() {
  const user = await requireUser();
  const settings = db().settings;
  const businessId = tenantContext()?.businessId;
  if (!businessId) throw new Error("Inget företag i sessionen.");
  return {
    businessId,
    businessName: settings.name || "Företag",
    orgNumber: settings.orgNumber || undefined,
    email: user.email || settings.email || undefined,
    origin: appOrigin(),
  };
}

export async function startCheckoutAction(): Promise<Result> {
  let url: string;
  try {
    url = await withBusiness(
      async () => {
        await assertOwner();
        return createCheckoutUrl(await buildContext());
      },
      { allowReadOnly: true }
    );
  } catch (e) {
    return { ok: false, error: userFacingBillingError(e) };
  }
  redirect(url);
}

export async function openCustomerPortalAction(): Promise<Result> {
  let url: string;
  try {
    url = await withBusiness(
      async () => {
        await assertOwner();
        return createPortalUrl(await buildContext());
      },
      { allowReadOnly: true }
    );
  } catch (e) {
    return { ok: false, error: userFacingBillingError(e) };
  }
  redirect(url);
}
