/**
 * Engångsnotiser som följer med i URL:en efter en redirect ("?kastat=offert",
 * "?bank=kopplad") och visas som toast när sidan laddats. Parametrarna tas
 * bort ur adressen direkt så att omladdning eller delad länk inte upprepar dem.
 *
 * Bara kända nycklar ger en notis – fri text ur URL:en visas aldrig som
 * "Driva säger …", med ett undantag: bankens felmeddelande, som kommer från
 * vår egen callback och bara visas tillsammans med bank=fel.
 */

export type FlashTone = "neutral" | "ok" | "danger";

export interface FlashNotice {
  title: string;
  text?: string;
  tone?: FlashTone;
}

export interface FlashMatch {
  /** Stabil nyckel per notis – används som toast-id så samma notis inte staplas. */
  key: string;
  notice: FlashNotice;
  /** Parametrar som ska tas bort ur URL:en. */
  strip: string[];
}

const DISCARDED: Record<string, FlashNotice> = {
  offert: { title: "Offertutkastet är kastat" },
  faktura: { title: "Fakturautkastet är kastat" },
};

const BANK: Record<string, FlashNotice> = {
  kopplad: {
    title: "Banken är kopplad",
    text: "Transaktionerna hämtas och matchas mot dina fakturor.",
    tone: "ok",
  },
  avbrutet: { title: "Kopplingen avbröts", text: "Inget har ändrats." },
  fel: { title: "Banken godkände inte kopplingen", text: "Försök igen.", tone: "danger" },
};

export const BANK_ERROR_MESSAGE_MAX_CHARS = 200;

export function flashFromSearch(params: URLSearchParams): FlashMatch | null {
  const discarded = params.get("kastat");
  if (discarded && DISCARDED[discarded]) {
    return { key: `kastat:${discarded}`, notice: DISCARDED[discarded], strip: ["kastat"] };
  }

  const bank = params.get("bank");
  if (bank && BANK[bank]) {
    const base = BANK[bank];
    const custom = bank === "fel" ? params.get("meddelande")?.trim().slice(0, BANK_ERROR_MESSAGE_MAX_CHARS) : undefined;
    return {
      key: `bank:${bank}`,
      notice: custom ? { ...base, text: custom } : base,
      strip: ["bank", "meddelande"],
    };
  }

  return null;
}

/** Tar bort notisens parametrar och ger den URL som ska ersätta den aktuella. */
export function hrefWithoutFlash(pathname: string, params: URLSearchParams, strip: string[]): string {
  const next = new URLSearchParams(params.toString());
  for (const key of strip) next.delete(key);
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}
