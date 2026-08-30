/**
 * Aktör i pågående request – userId + roll + företag.
 * Servern sätter detta efter medlemskapskontroll. Klienten skickar aldrig roll.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { BusinessRole } from "../types";
import { tenantContext } from "../storage/context";
import { requestSlot } from "../storage/request-scope";
import { activeMembershipFor, userById } from "./registry";
import { isSupabaseMode } from "../storage/config";

export interface CollaborationActor {
  userId: string;
  email: string;
  name: string;
  role: BusinessRole;
  businessId: string;
}

const als = new AsyncLocalStorage<CollaborationActor>();
let testActor: CollaborationActor | null = null;

export function setTestActor(actor: CollaborationActor | null): void {
  testActor = actor;
}

export function runAsActor<T>(actor: CollaborationActor, fn: () => T): T {
  return als.run(actor, fn);
}

export function currentActor(): CollaborationActor | null {
  const fromAls = als.getStore();
  if (fromAls) return fromAls;
  if (testActor) return testActor;
  try {
    const slot = requestSlot();
    if (slot.actor) return slot.actor;
  } catch {
    /* utanför RSC */
  }
  const ctx = tenantContext();
  if (ctx?.userId && ctx.businessId) {
    const membership = activeMembershipFor(ctx.userId, ctx.businessId);
    const user = userById(ctx.userId);
    if (membership) {
      return {
        userId: ctx.userId,
        email: user?.email ?? "",
        name: user?.name ?? "",
        role: membership.role,
        businessId: ctx.businessId,
      };
    }
    if (!isSupabaseMode()) {
      return {
        userId: ctx.userId,
        email: user?.email ?? "",
        name: user?.name ?? "Ägare",
        role: "owner",
        businessId: ctx.businessId,
      };
    }
  }
  return testActor;
}

export function requireActor(): CollaborationActor {
  const actor = currentActor();
  if (!actor) {
    throw new Error("Ingen aktör i kontexten – medlemskap måste verifieras på servern.");
  }
  return actor;
}

/** JSON-/demon utan inloggning: implicit ägare av det lokala företaget. */
export const LOCAL_JSON_USER_ID = "local-owner";
export const LOCAL_JSON_BUSINESS_ID = "local";
/** Seedad redovisningskonsult så /redovisning går att öppna lokalt. */
export const LOCAL_JSON_ACCOUNTANT_ID = "local-accountant";
export const LOCAL_JSON_ACCOUNTANT_EMAIL = "anna@byran.se";
export const LOCAL_JSON_ACCOUNTANT_NAME = "Anna Svensson";
