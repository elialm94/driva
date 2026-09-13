/**
 * Be om ny prislista: färdigt mejl. Användaren måste skicka det.
 * Ett skickat mejl markerar ALDRIG prislistan som uppdaterad.
 */
import { inboundAddressForBusiness } from "./inbox";
import { requireWholesalerConnection } from "./wholesalers";
import { connectionLabel } from "../wholesalers/labels";
import { inboundPlusAddressingVerified } from "../inbox/plus-tag";

export interface PriceListRequestDraft {
  to: string;
  subject: string;
  body: string;
  replyTo: string;
  mailto: string;
}

export function priceListRequestDraft(connectionId: string): PriceListRequestDraft {
  const connection = requireWholesalerConnection(connectionId);
  const inbox = inboundAddressForBusiness();
  const label = connectionLabel(connection);
  const to = connection.orderEmail.trim();
  const subject = `Aktuell prislista och rabatter till ${label}`;
  const refHint = inboundPlusAddressingVerified()
    ? `Svara till ${inbox} eller bifoga filen dit.`
    : `Skicka filen till ${inbox}. Ange gärna företagets namn i ämnesraden.`;
  const body = [
    `Hej,`,
    ``,
    `Kan ni skicka aktuell artikel- och prislista samt mitt rabattbrev/nettopriser i ett format vi kan läsa (CSV, TXT, XLSX, XML eller ZIP)?`,
    ``,
    `Kundnummer: ${connection.customerNumber ?? "anges av er"}`,
    ``,
    refHint,
    ``,
    `Tack!`,
  ].join("\n");
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return { to, subject, body, replyTo: inbox, mailto };
}
