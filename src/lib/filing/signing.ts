/**
 * Signering av en inlämning.
 *
 * Byggd på den krok som redan finns i services/bankid.ts: samma miljöflagga
 * (`bankidProvider.environment`) och samma demogrind (`bankidSigningAvailable`),
 * så att det bara finns EN plats i produkten som avgör om BankID är verkligt
 * eller en demofunktion. Kroken där är knuten till offertens BankIDOrder;
 * inlämningen behöver inget ordersvep utan bara resultatet – signaturen – och
 * har därför ett eget, smalare gränssnitt.
 *
 * Så länge environment är "mock" är signaturen en demosignatur: metoden heter
 * bankid_mock, noten säger rakt ut att ingen riktig BankID-signering skett, och
 * ett riktigt företag i skarp drift släpps inte igenom alls.
 */
import type { FilingSignature, FilingSubmission } from "../types";
import { db } from "../store";
import { bankidProvider, bankidSigningAvailable, BankIDUnavailableError } from "../services/bankid";
import { orgNumber10 } from "../accounting/filing-format";

export const DEMO_SIGNATURE_NOTE = "Demosignatur – ingen riktig BankID-signering har genomförts.";

const KIND_TEXT: Record<FilingSubmission["kind"], string> = {
  moms: "momsdeklarationen",
  agi: "arbetsgivardeklarationen",
  ink2: "inkomstdeklarationen (INK2)",
  arsredovisning: "årsredovisningen",
};

/**
 * Texten den som signerar ska se. Kontrollsumman ingår: signaturen gäller den
 * fil som finns, inte deklarationen som idé. Genereras filen om efter
 * signeringen ändras summan och signaturen släpps.
 */
export function filingSignText(submission: FilingSubmission): string {
  const settings = db().settings;
  const checksums = submission.files.map((f) => `${f.filename} (SHA-256 ${f.sha256.slice(0, 16)}…)`).join(", ");
  return (
    `Jag skriver under ${KIND_TEXT[submission.kind]} för ${submission.label} ` +
    `för ${settings.name} (${orgNumber10(settings.orgNumber)}). Filer: ${checksums}.`
  );
}

export interface FilingSignInput {
  submission: FilingSubmission;
  /** Namnet på den som skriver under. Firmatecknaren, inte företaget. */
  signedByName: string;
}

export interface FilingSigner {
  readonly environment: "mock" | "production";
  sign(input: FilingSignInput): FilingSignature;
}

/**
 * Demosignering. Producerar en signatur som är märkt som demosignatur och som
 * bara får skapas i demo – samma regel som mocken i services/bankid.ts.
 */
class MockFilingSigner implements FilingSigner {
  readonly environment = "mock" as const;

  sign(input: FilingSignInput): FilingSignature {
    if (!bankidSigningAvailable()) throw new BankIDUnavailableError();
    return {
      method: "bankid_mock",
      signedAt: new Date().toISOString(),
      signedByName: input.signedByName,
      personalNumberMasked: "••••••••-••••",
      orderRef: `mock-${input.submission.id}`,
      note: DEMO_SIGNATURE_NOTE,
    };
  }
}

/**
 * Ingen signeringsleverantör. Kastar hellre än att skriva en signatur som ingen
 * har gjort – en osignerad inlämning går att signera för hand utanför Driva,
 * en påhittad signatur går inte att göra ogjord.
 */
class UnconfiguredFilingSigner implements FilingSigner {
  readonly environment = "production" as const;

  sign(): FilingSignature {
    throw new BankIDUnavailableError();
  }
}

export function selectFilingSigner(): FilingSigner {
  return bankidProvider.environment === "mock" ? new MockFilingSigner() : new UnconfiguredFilingSigner();
}

/** Går det att signera härifrån? Styr om signeringsknappen visas. */
export function filingSigningAvailable(): boolean {
  return bankidSigningAvailable();
}
