import { isEmailFormat } from "./settings-validation";
import { missingEmailForSend } from "./customer-validation";
import { hasSendablePhone } from "./sms/channels";

/**
 * Generellt "saknas något → komplettera på plats → återuppta":
 * en blockerad åtgärd (SEND_INVOICE, SEND_QUOTE, …) stannar med
 * pendingAction + customerId/documentId. resolveMissingRequirements
 * sparar på den riktiga entiteten; resumePendingAction fortsätter
 * exakt där det stoppade. Samma kärna används av offert, faktura
 * och (senare) ROT/fakturering/leverantörsbetalning.
 */

export type PendingActionKind = "SEND_INVOICE" | "SEND_QUOTE";

export interface PendingAction {
  kind: PendingActionKind;
  documentId: string;
  customerId: string;
}

export type MissingRequirementCode = "buyer_email";

export const EMAIL_SAVE_FAILED = "Kunde inte spara e-postadressen. Försök igen.";

export function emailInputError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Skriv in kundens e-postadress.";
  if (!isEmailFormat(trimmed)) return "Ange en giltig e-postadress.";
  return null;
}

export function missingEmailDialogCopy(kind: PendingActionKind): { title: string; description: string } {
  return {
    title: "Kunden saknar e-postadress",
    description:
      kind === "SEND_QUOTE"
        ? "Lägg till kundens e-post för att skicka offerten."
        : "Lägg till kundens e-post för att skicka fakturan.",
  };
}

/** Vilka krav som saknas för att den blockerade åtgärden ska kunna återupptas. */
export function requirementsForAction(
  _action: PendingAction,
  customer: { email?: string | null; phone?: string | null }
): MissingRequirementCode[] {
  const missing: MissingRequirementCode[] = [];
  if (missingEmailForSend(customer) && !hasSendablePhone(customer.phone)) missing.push("buyer_email");
  return missing;
}

export type NextAfterResolve =
  | { type: "resume"; action: PendingAction }
  | { type: "collect"; field: MissingRequirementCode };

export function nextAfterResolve(
  action: PendingAction,
  customer: { email?: string | null; phone?: string | null }
): NextAfterResolve {
  const missing = requirementsForAction(action, customer);
  if (missing.length === 0) return { type: "resume", action };
  return { type: "collect", field: missing[0] };
}

export type ResolveEmailResult =
  | { ok: true; email: string; customerId: string }
  | { ok: false; error: string };

export type ResolveStep =
  | { status: "idle" }
  | { status: "collecting"; field: MissingRequirementCode }
  | { status: "invalid"; error: string }
  | { status: "busy" }
  | { status: "failed"; error: string; input: string }
  | { status: "resumed"; email: string };

/**
 * Testbar session för request → collect → resolve → resume.
 * UI-hooken speglar samma steg; dubbelklick stoppas av `saving`.
 */
export function createBlockedActionSession(opts: {
  action: PendingAction;
  customerEmail?: string | null;
  customerPhone?: string | null;
  persist: (customerId: string, email: string) => ResolveEmailResult;
  onResume: (resolved: { email: string }) => void;
}) {
  let collecting: MissingRequirementCode | null = null;
  let emailOverride: string | null = null;
  let saving = false;
  let lastError: string | null = null;
  let input = "";

  function currentEmail() {
    return emailOverride ?? opts.customerEmail?.trim() ?? "";
  }

  function request(): ResolveStep {
    const next = nextAfterResolve(opts.action, { email: currentEmail(), phone: opts.customerPhone });
    if (next.type === "collect") {
      collecting = next.field;
      lastError = null;
      return { status: "collecting", field: next.field };
    }
    opts.onResume({ email: currentEmail() });
    return { status: "resumed", email: currentEmail() };
  }

  function cancel(): ResolveStep {
    collecting = null;
    lastError = null;
    return { status: "idle" };
  }

  function setInput(value: string) {
    input = value;
    lastError = null;
  }

  function resolve(): ResolveStep {
    if (saving) return { status: "busy" };
    if (collecting !== "buyer_email") return { status: "idle" };
    const error = emailInputError(input);
    if (error) {
      lastError = error;
      return { status: "invalid", error };
    }
    saving = true;
    try {
      const persist = opts.persist;
      let result: ResolveEmailResult;
      try {
        result = persist(opts.action.customerId, input);
      } catch {
        lastError = EMAIL_SAVE_FAILED;
        return { status: "failed", error: EMAIL_SAVE_FAILED, input };
      }
      if (!result.ok) {
        lastError = EMAIL_SAVE_FAILED;
        return { status: "failed", error: EMAIL_SAVE_FAILED, input };
      }
      emailOverride = result.email;
      opts.customerEmail = result.email;
      collecting = null;
      lastError = null;
      opts.onResume({ email: result.email });
      return { status: "resumed", email: result.email };
    } finally {
      saving = false;
    }
  }

  return {
    request,
    cancel,
    setInput,
    resolve,
    get collecting() {
      return collecting;
    },
    get error() {
      return lastError;
    },
    get input() {
      return input;
    },
    get email() {
      return currentEmail();
    },
    get saving() {
      return saving;
    },
  };
}
