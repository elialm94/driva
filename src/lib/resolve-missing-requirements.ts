import { EMAIL_SAVE_FAILED, emailInputError, type ResolveEmailResult } from "./missing-requirements";
import { updateCustomer } from "./services/customers";

/**
 * Persist-steget i resolveMissingRequirements. Skriver på den riktiga
 * kunden – aldrig en dokumentkopia – och skickar inte offert/faktura.
 */
export function resolveCustomerEmail(customerId: string, email: string): ResolveEmailResult {
  const error = emailInputError(email);
  if (error) return { ok: false, error };
  try {
    const customer = updateCustomer(customerId, { email: email.trim() });
    return { ok: true, email: customer.email, customerId: customer.id };
  } catch {
    return { ok: false, error: EMAIL_SAVE_FAILED };
  }
}
