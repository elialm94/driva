/**
 * Centralt leverantörs-/underbiträdesregister (spec §7). Den publika listan på
 * /underbitraden, integritetspolicyns mottagaravsnitt och adminvyn härleds
 * härifrån – ingen fri text på flera ställen. En leverantör listas ENBART när
 * den faktiskt är aktiv i miljön (nyckel/konfiguration finns), så listan kan
 * inte påstå att t.ex. Tink eller Stripe används innan de är påslagna.
 *
 * Regioner och avtalslänkar är leverantörernas publika uppgifter; det som
 * beror på Fervas egna projektinställningar (t.ex. vald Supabase-/Vercel-
 * region) markeras "verifieras vid go-live" i stället för att gissas.
 */
import { readStripeConfig } from "../billing/config";
import { isTinkConfigured } from "../banking/tink/config";
import { readFilingConfig } from "../filing/config";

export type EnvSource = Record<string, string | undefined>;

export type ProviderRole = "underbiträde" | "självständigt ansvarig" | "underbiträde (klientsida)";

export interface ProviderEntry {
  id: string;
  name: string;
  role: ProviderRole;
  /** Vad leverantören gör för Ferva. */
  purpose: string;
  /** Kategorier av uppgifter som kan passera leverantören. */
  dataTypes: string[];
  /** Var behandlingen sker. */
  region: string;
  /** Tredjelandsöverföring och skyddsmekanism, om relevant. */
  transfer?: string;
  termsUrl: string;
  dpaUrl?: string;
  /** Uppgift som måste verifieras manuellt före go-live (projektspecifik). */
  verify?: string;
}

interface ProviderDefinition extends ProviderEntry {
  active: (env: EnvSource) => boolean;
}

function has(env: EnvSource, key: string): boolean {
  return Boolean(env[key]?.trim());
}

function aiActive(env: EnvSource): { openRouter: boolean; generic: boolean } {
  const provider = (env.AI_PROVIDER?.trim() || "openai-compatible").toLowerCase();
  if (provider === "none") return { openRouter: false, generic: false };
  const openRouter = provider === "openrouter" && has(env, "OPENROUTER_API_KEY");
  const generic = provider !== "openrouter" && has(env, "AI_API_KEY");
  return { openRouter, generic };
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

const DEFINITIONS: ProviderDefinition[] = [
  {
    id: "vercel",
    name: "Vercel Inc.",
    role: "underbiträde",
    purpose: "Drift av webbapplikationen (hosting, serverfunktioner, CDN, cron).",
    dataTypes: ["All data som passerar applikationen under behandling", "Åtkomstloggar (IP-adress, URL, tidpunkt)"],
    region: "Serverfunktioner i vald EU-region; CDN globalt.",
    transfer: "Vercel Inc. (USA) – EU:s standardavtalsklausuler i Vercels DPA.",
    termsUrl: "https://vercel.com/legal/terms",
    dpaUrl: "https://vercel.com/legal/dpa",
    verify: "Kontrollera att projektets Function Region är en EU-region (Vercel → Settings → Functions).",
    active: (env) => has(env, "VERCEL") || env.NODE_ENV === "production",
  },
  {
    id: "supabase",
    name: "Supabase Inc.",
    role: "underbiträde",
    purpose: "Databas (Postgres), autentisering, fillagring och MFA.",
    dataTypes: [
      "Konto- och inloggningsuppgifter",
      "Företagets kunder, offerter, fakturor, kvitton, bokföring",
      "Bankhändelser och bilagor",
    ],
    region: "Projektets valda region (EU förutsätts).",
    transfer: "Supabase Inc. (USA) som avtalspart – EU:s standardavtalsklausuler i Supabases DPA.",
    termsUrl: "https://supabase.com/terms",
    dpaUrl: "https://supabase.com/legal/dpa",
    verify: "Kontrollera att Supabase-projektet ligger i en EU-region (Project Settings → General).",
    active: (env) => has(env, "NEXT_PUBLIC_SUPABASE_URL"),
  },
  {
    id: "resend",
    name: "Resend, Inc.",
    role: "underbiträde",
    purpose: "Utskick av transaktionsmejl (offerter, fakturor, inbjudningar, kontomejl) och mottagning av inkommande mejl till inkorgen.",
    dataTypes: ["Mottagar- och avsändaradresser", "Mejlinnehåll och bilagor under leverans", "Leveransstatus"],
    region: "EU-region om vald i Resend; annars USA.",
    transfer: "Resend, Inc. (USA) – EU:s standardavtalsklausuler i Resends DPA.",
    termsUrl: "https://resend.com/legal/terms-of-service",
    dpaUrl: "https://resend.com/legal/dpa",
    verify: "Välj EU-region för domänen i Resend och kontrollera dataretention för loggar.",
    active: (env) => has(env, "RESEND_API_KEY"),
  },
  {
    id: "stripe",
    name: "Stripe Payments Europe, Ltd.",
    role: "självständigt ansvarig",
    purpose: "Abonnemangsbetalning för Ferva (Checkout, kundportal, fakturor från Stripe).",
    dataTypes: ["Företagsnamn, organisationsnummer, e-post", "Kortuppgifter (endast hos Stripe – aldrig i Ferva)"],
    region: "EU (Irland) med koncernbolag i USA.",
    transfer: "Stripe är självständigt personuppgiftsansvarig för betalningsuppgifter; överföring enligt Stripes Data Processing Agreement/Privacy Policy.",
    termsUrl: "https://stripe.com/se/legal/ssa",
    dpaUrl: "https://stripe.com/se/legal/dpa",
    active: (env) => readStripeConfig(env) !== null,
  },
  {
    id: "tink",
    name: "Tink AB",
    role: "underbiträde",
    purpose: "Bankkoppling (kontoinformation) för att hämta transaktioner till bokföringen.",
    dataTypes: ["Kontonummer och kontotransaktioner för företagets bankkonton", "Samtyckesuppgifter"],
    region: "EU (Sverige).",
    termsUrl: "https://tink.com/legal/terms-and-conditions/",
    dpaUrl: "https://tink.com/legal/privacy-policy/",
    active: (env) => isTinkConfigured(env),
  },
  {
    id: "openrouter",
    name: "OpenRouter, Inc.",
    role: "underbiträde",
    purpose: "AI-assistent och tolkning av kvitton/dokument (språkmodell via API).",
    dataTypes: ["Text du skriver till assistenten", "Text ur kvitton, fakturor och bankrader som skickas för tolkning"],
    region: "USA (OpenRouter) – underliggande modelleverantör enligt vald modell.",
    transfer: "Tredjelandsöverföring till USA – EU:s standardavtalsklausuler; ingen träning på data enligt OpenRouters villkor.",
    termsUrl: "https://openrouter.ai/terms",
    dpaUrl: "https://openrouter.ai/privacy",
    verify: "Bekräfta vald modells dataretention/‑användning i OpenRouter-kontot.",
    active: (env) => aiActive(env).openRouter,
  },
  {
    id: "ai-generic",
    name: "AI-leverantör (OpenAI-kompatibelt API)",
    role: "underbiträde",
    purpose: "AI-assistent och tolkning av kvitton/dokument (språkmodell via API).",
    dataTypes: ["Text du skriver till assistenten", "Text ur kvitton, fakturor och bankrader som skickas för tolkning"],
    region: "Enligt konfigurerad leverantör (AI_BASE_URL).",
    transfer: "Beror på leverantör – ska verifieras och namnges före go-live.",
    termsUrl: "https://openai.com/policies/terms-of-use",
    verify: "Namnge leverantören bakom AI_BASE_URL och länka dess DPA innan listan publiceras.",
    active: (env) => aiActive(env).generic,
  },
  {
    id: "google-maps",
    name: "Google Ireland Ltd. (Google Maps Platform)",
    role: "underbiträde (klientsida)",
    purpose: "Adressförslag när du skriver adresser (Places API, anropas från din webbläsare).",
    dataTypes: ["Adresstext du skriver", "IP-adress (webbläsarens anrop)"],
    region: "EU/USA – Googles globala infrastruktur.",
    transfer: "EU:s standardavtalsklausuler / EU–US Data Privacy Framework enligt Googles villkor.",
    termsUrl: "https://cloud.google.com/maps-platform/terms",
    dpaUrl: "https://cloud.google.com/terms/data-processing-addendum",
    active: (env) => has(env, "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"),
  },
  {
    id: "sentry",
    name: "Functional Software, Inc. (Sentry)",
    role: "underbiträde",
    purpose: "Felövervakning. Händelser skrubbas innan de skickas – inga personnummer, tokens, mejl- eller dokumentinnehåll.",
    dataTypes: ["Tekniska felrapporter (stackspår, route, version)", "Pseudonymiserat användar-id"],
    region: "EU eller USA beroende på Sentry-organisationens region.",
    transfer: "Vid USA-region: EU:s standardavtalsklausuler i Sentrys DPA.",
    termsUrl: "https://sentry.io/terms/",
    dpaUrl: "https://sentry.io/legal/dpa/",
    verify: "Skapa Sentry-organisationen i EU-regionen.",
    active: (env) => has(env, "SENTRY_DSN"),
  },
  {
    id: "filing",
    name: "Inlämningstjänst för deklarationer",
    role: "underbiträde",
    purpose: "Elektronisk inlämning av deklarationer (moms, arbetsgivardeklaration, inkomstdeklaration, årsredovisning) till Skatteverket/Bolagsverket.",
    dataTypes: ["Deklarationsunderlag med företagets organisationsnummer och belopp", "Kvittenser"],
    region: "Enligt leverantörens avtal.",
    termsUrl: "",
    verify: "Ange leverantörens namn, region och DPA-länk (FILING_PROVIDER_NAME, FILING_PROVIDER_TERMS_URL) när avtalet är klart.",
    active: (env) => readFilingConfig(env) !== null,
  },
];

/** Aktiva leverantörer för miljön – det som får stå på den publika listan. */
export function activeProviders(env: EnvSource = process.env): ProviderEntry[] {
  return DEFINITIONS.filter((d) => d.active(env)).map((d) => {
    const { active: _active, ...entry } = d;
    if (entry.id === "filing") {
      const cfg = readFilingConfig(env);
      const name = env.FILING_PROVIDER_NAME?.trim();
      const host = hostOf(cfg?.baseUrl);
      return {
        ...entry,
        name: name || (host ? `Inlämningstjänst (${host})` : entry.name),
        termsUrl: env.FILING_PROVIDER_TERMS_URL?.trim() || entry.termsUrl,
      };
    }
    return entry;
  });
}

/** Alla kända leverantörer med aktiv-flagga – för adminvyn. */
export function providerRegister(env: EnvSource = process.env): (ProviderEntry & { active: boolean })[] {
  const active = new Set(activeProviders(env).map((p) => p.id));
  return DEFINITIONS.map(({ active: _a, ...entry }) => ({ ...entry, active: active.has(entry.id) }));
}

/** Leverantörer som är aktiva men saknar verifierad uppgift (adminchecklistan). */
export function providersNeedingVerification(env: EnvSource = process.env): ProviderEntry[] {
  return activeProviders(env).filter((p) => Boolean(p.verify) || !p.termsUrl);
}
