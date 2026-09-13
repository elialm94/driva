/**
 * Kundregister och arbetsplatser.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

import type { ID } from "./common";
import type { DwellingType } from "./tax-reduction";
import type { WholesalerCustomerPriceRule } from "./wholesalers";

/* ---------------------------------- Kunder ---------------------------------- */

export interface Customer {
  id: ID;
  kind: "privat" | "foretag";
  name: string;
  contactPerson?: string;
  orgNumber?: string;
  email: string;
  phone: string;
  address?: string;
  postalCode?: string;
  city?: string;
  /**
   * Personnummer för skattereduktion. Hör till den privata kunden – inte till
   * offert, faktura, uppdrag eller bostad. Känsligt: maskas i vanliga vyer
   * (`1985••••-1234`), skickas inte till LLM, läggs inte i URL eller
   * analytics, och loggas inte i klartext. Serveractions som läser/skriver
   * värdet validerar input och returnerar maskat värde om det inte är en
   * dedikerad "Visa"-åtgärd.
   *
   * JSON-lagret (`src/lib/store.ts`) sparar fältet i klartext. Kryptering i
   * vila kräver en riktig databas – vi hittar inte på krypto här.
   */
  personalIdentityNumber?: string;
  /**
   * Köparen är ett byggföretag som själv redovisar momsen på byggtjänster
   * (omvänd byggmoms, ML 1 kap. 2 § första stycket 4 b). Sätts som ett
   * uttryckligt val på kunden – produkten bedömer aldrig själv om köparen är
   * byggföretag. Gäller bara företagskunder, och fakturor till kunden
   * faktureras utan moms med laghänvisning på dokumentet.
   */
  reverseChargeConstruction?: boolean;
  /** Arbetsplatser/bostäder. En privat kund kan ha hem + fritidshus. */
  workLocations?: WorkLocation[];
  /** Standardadress för nytt uppdrag / ROT-prefill när flera bostäder finns. */
  defaultWorkLocationId?: ID;
  notes: string;
  /**
   * Historiskt: ROT/RUT ifyllt som använt hos andra. Kundkortet samlar inte
   * längre in det, och usedTaxReductionThisYear räknar det inte – ett tomt
   * värde är okänt, inte noll använt överallt. Fältet kan fortfarande finnas
   * i äldre data.
   */
  taxReductionUsed?: {
    year: number;
    rot: number;
    rut: number;
  };
  /**
   * Standardregel för kundpris på material till den här kunden.
   * Sätts bara när användaren aktivt väljer "Samma val nästa gång".
   */
  materialPriceRule?: WholesalerCustomerPriceRule;
  createdAt: string;
}

/** Bostad där arbete utförs. ROT-uppgifter (beteckning/BRF) bor här, personnummer på kunden. */
export interface WorkLocation {
  id: ID;
  label: string;
  address: string;
  postalCode: string;
  city: string;
  placeId?: string;
  propertyType: DwellingType;
  propertyDesignation?: string;
  brfOrgNumber?: string;
  apartmentNumber?: string;
}
