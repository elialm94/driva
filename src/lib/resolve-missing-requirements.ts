import {
  EMAIL_SAVE_FAILED,
  PHONE_SAVE_FAILED,
  emailInputError,
  phoneInputError,
  type ResolveEmailResult,
} from "./missing-requirements";
import { updateCustomer } from "./services/customers";
import { getCustomer } from "./services/data";

export type ResolvePhoneResult =
  | { ok: true; phone: string; customerId: string }
  | { ok: false; error: string };

/**
 * Persist-steget i resolveMissingRequirements. Skriver på den riktiga
 * kunden – aldrig en dokumentkopia – och skickar inte offert/faktura.
 *
 * En adress som anges vid utskicket vandrar till kundkortet så att den bara
 * behöver skrivas en gång. En befintlig adress skrivs däremot aldrig över på
 * vägen: kundkortet äger kontaktvägen, och ett utskick är inte platsen att
 * tysta byta den. Skyddet ligger här och inte i grinden eller komponenten,
 * eftersom offert- och fakturaflödet delar just den här funktionen.
 */
export function resolveCustomerEmail(
  customerId: string,
  email: string,
  opts: { overwrite?: boolean } = {}
): ResolveEmailResult {
  const error = emailInputError(email);
  if (error) return { ok: false, error };
  try {
    const existing = getCustomer(customerId)?.email?.trim();
    if (existing && !opts.overwrite) {
      return { ok: true, email: existing, customerId };
    }
    const customer = updateCustomer(customerId, { email: email.trim() });
    return { ok: true, email: customer.email, customerId: customer.id };
  } catch {
    return { ok: false, error: EMAIL_SAVE_FAILED };
  }
}

/**
 * Samma persist-steg som e-post: skriver telefon på den riktiga kunden
 * och skickar inte offerten. Befintligt nummer skrivs inte över utan
 * overwrite - kundkortet äger kontaktvägen.
 */
export function resolveCustomerPhone(
  customerId: string,
  phone: string,
  opts: { overwrite?: boolean } = {}
): ResolvePhoneResult {
  const error = phoneInputError(phone);
  if (error) return { ok: false, error };
  try {
    const existing = getCustomer(customerId)?.phone?.trim();
    if (existing && !opts.overwrite) {
      return { ok: true, phone: existing, customerId };
    }
    const customer = updateCustomer(customerId, { phone: phone.trim() });
    return { ok: true, phone: customer.phone, customerId: customer.id };
  } catch {
    return { ok: false, error: PHONE_SAVE_FAILED };
  }
}
