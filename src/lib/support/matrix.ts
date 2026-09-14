/**
 * Supportmatrisen – en central, versionerad sanning om vad Ferva stödjer
 * (spec §10). Den används av onboarding (eligibility), hjälpen (Vad Ferva
 * stödjer), konsultvyn och servervalideringen. Den är inte bara copy: varje
 * post talar om var regeln upprätthålls i koden och vilka tester som täcker den.
 *
 * Tre nivåer:
 *   supported   – Ferva hanterar fallet med expertverifierade regler.
 *   consultant  – fallet får användas i bolaget först när en redovisnings-
 *                 konsult med tillgång till bolaget har godkänt det (guard.ts).
 *   unsupported – blockeras av servern tills det är implementerat och verifierat.
 *
 * Nya ekonomiska regler läggs aldrig till bara för att kod har genererats:
 * varje post bär primärkälla, giltighetsdatum, ägare och testmatris. Ändra
 * SUPPORT_MATRIX_VERSION när en post byter nivå eller läggs till, så att
 * sparade bedömningar och godkännanden går att spåra mot rätt version.
 *
 * Klientsäker och ren: inga importer från server- eller lagringslagret.
 */

export const SUPPORT_MATRIX_VERSION = "2026-09-13.2";

export type SupportLevel = "supported" | "consultant" | "unsupported";

export type SupportArea = "bolag" | "redovisning" | "fakturering" | "lon" | "bokslut";

export const SUPPORT_AREA_LABEL: Record<SupportArea, string> = {
  bolag: "Bolag och verksamhet",
  redovisning: "Redovisning och valuta",
  fakturering: "Fakturering och moms",
  lon: "Lön",
  bokslut: "Bokslut, deklaration och inlämning",
};

export const SUPPORT_LEVEL_LABEL: Record<SupportLevel, string> = {
  supported: "Stöds",
  consultant: "Kräver konsult",
  unsupported: "Stöds inte ännu",
};

export type SupportEntryId =
  | "company_ab"
  | "company_enskild"
  | "company_other"
  | "group_company"
  | "framework_k2"
  | "framework_k3"
  | "market_sweden_sek"
  | "representation_deduction"
  | "foreign_currency"
  | "eu_sales_export"
  | "margin_scheme"
  | "inventory_manufacturing"
  | "complex_equity_events"
  | "invoicing_domestic_vat"
  | "rot_rut"
  | "reverse_charge_construction_outgoing"
  | "e_invoice_peppol"
  | "payroll_fixed_monthly"
  | "payroll_complex"
  | "bookkeeping_core"
  | "year_end_k2_schedules"
  | "year_end_other"
  | "filing_manual"
  | "filing_electronic";

export interface SupportEntry {
  id: SupportEntryId;
  area: SupportArea;
  /** Kort rubrik som företagaren förstår. */
  label: string;
  level: SupportLevel;
  /** Vad det betyder för företaget, på begriplig svenska. */
  summary: string;
  /** Var regeln upprätthålls – UI räcker inte, servern ska stoppa. */
  enforcement: string;
  /** Primärkälla för regeln. Inga regler utan källa. */
  source: string;
  /** Från vilken dag bedömningen gäller (ISO-datum). */
  effectiveFrom: string;
  /** Sista giltighetsdag om regeln är tidsbegränsad. */
  effectiveTo?: string;
  /** Vem som äger bedömningen och ska godkänna en nivåändring. */
  owner: string;
  /** Testfiler som låser regeln. */
  tests: readonly string[];
}

const OWNER_RULES = "Ferva redovisningsregler (expertgranskning krävs för nivåändring)";
const OWNER_PRODUCT = "Ferva produkt";

/**
 * Ordningen här är visningsordningen på hjälpsidan. Håll posterna korta:
 * detaljerna hör hemma i källan och testerna, inte i copy.
 */
export const SUPPORT_MATRIX: readonly SupportEntry[] = [
  /* --------------------------------- bolag --------------------------------- */
  {
    id: "company_ab",
    area: "bolag",
    label: "Aktiebolag",
    level: "supported",
    summary: "Svenska aktiebolag med en eller några ägare. Det är det Ferva är byggt för.",
    enforcement: "Onboardingens företagsform och Inställningar → Företag tillåter aktiebolag.",
    source: "Aktiebolagslagen (2005:551); Bokföringslagen (1999:1078); Årsredovisningslagen (1995:1554).",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/support/support.test.ts", "src/lib/onboarding.test.ts"],
  },
  {
    id: "company_enskild",
    area: "bolag",
    label: "Enskild firma",
    level: "consultant",
    summary:
      "Fakturering, kvitton, bank och löpande bokföring fungerar. Bokslut, NE-bilaga och egenavgifter görs utanför Ferva – därför behövs en redovisningskonsult som godkänner upplägget.",
    enforcement:
      "INK2, K2-årsredovisning och periodiseringsfond blockeras för enskild firma i motorn; onboarding och Inställningar tillåter formen men markerar bolaget som konsultfall.",
    source: "Bokföringslagen 6 kap. (förenklat årsbokslut); Inkomstskattelagen (1999:1229) 30 kap. (periodiseringsfond, enskild näringsverksamhet).",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/support/support.test.ts", "src/lib/accounting/year-end.test.ts"],
  },
  {
    id: "company_other",
    area: "bolag",
    label: "Handelsbolag, kommanditbolag, föreningar och andra företagsformer",
    level: "unsupported",
    summary: "Eget kapital, skatt och deklaration skiljer sig från aktiebolagets. Ferva gissar inte – formen kan inte skapas ännu.",
    enforcement: "Servern avvisar företagsformen i onboarding och i Inställningar, oavsett vad klienten skickar.",
    source: "Lag (1980:1102) om handelsbolag och enkla bolag; Lag (2018:672) om ekonomiska föreningar.",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/support/support.test.ts", "src/lib/onboarding.test.ts"],
  },
  {
    id: "group_company",
    area: "bolag",
    label: "Koncern (moder- eller dotterbolag)",
    level: "unsupported",
    summary: "Koncernredovisning, koncernbidrag och andelar i dotterbolag saknar regler i Ferva.",
    enforcement: "Onboardingen avvisar bolaget; inga koncernkonton eller koncernbilagor finns i motorn.",
    source: "Årsredovisningslagen 7 kap.; Inkomstskattelagen 35 kap. (koncernbidrag).",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/support/support.test.ts"],
  },

  /* ------------------------------ redovisning ------------------------------ */
  {
    id: "framework_k2",
    area: "redovisning",
    label: "K2 – årsredovisning i mindre företag",
    level: "supported",
    summary: "Fervas bokslut, bilagor och årsredovisning följer K2.",
    enforcement: "Årsredovisningen genereras bara enligt K2-uppställningen.",
    source: "BFNAR 2016:10 Årsredovisning i mindre företag (K2).",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/accounting/annual-report.test.ts"],
  },
  {
    id: "framework_k3",
    area: "redovisning",
    label: "K3",
    level: "unsupported",
    summary: "K3 kräver komponentavskrivning, uppskjuten skatt och andra bedömningar som Ferva inte har regler för.",
    enforcement: "Onboardingen avvisar bolaget; ingen K3-uppställning finns.",
    source: "BFNAR 2012:1 Årsredovisning och koncernredovisning (K3).",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/support/support.test.ts"],
  },
  {
    id: "market_sweden_sek",
    area: "redovisning",
    label: "Svensk verksamhet i svenska kronor",
    level: "supported",
    summary: "Kunder, leverantörer, bank och lön i Sverige och i SEK.",
    enforcement: "Alla belopp i Ferva är SEK; kunder saknar landfält och bankkopplingen är svensk.",
    source: "Bokföringslagen 4 kap. 6 § (redovisningsvaluta).",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/financial-invariants.test.ts"],
  },
  {
    id: "representation_deduction",
    area: "redovisning",
    label: "Representation: måltider, fika och personalfest",
    level: "supported",
    summary:
      "Måltider vid representation är inte avdragsgilla, men momsen får lyftas efter schablon: 36 kr per person, 46 kr när alkohol ingår, eller momsen på ett underlag om högst 300 kr per person. Enklare förtäring är avdragsgill upp till 60 kr per person. Ferva frågar alltid hur många som deltog och om alkohol ingick innan notan bokförs.",
    enforcement:
      "En enda motor räknar uppdelningen: representationSplit i src/lib/expenses/manual-expense.ts. Kategorin ligger utanför EXPENSE_CATEGORIES, entriesExpense vägrar kontera den och autopiloten håller den som REQUIRES_USER oavsett konfidens, så varken banken, kvittoläsningen eller assistenten kan bokföra representation utan bekräftade uppgifter.",
    source:
      "Inkomstskattelagen (1999:1229) 16 kap. 2 § (representation, avdragsförbud för måltider och skälig omfattning för enklare förtäring); Mervärdesskattelagen (2023:200) och Skatteverkets ställningstagande om avdrag för ingående skatt vid representationsmåltider (underlag högst 300 kr per person, schablon 36 kr respektive 46 kr per person när alkohol ingår).",
    effectiveFrom: "2017-01-01",
    owner: OWNER_RULES,
    tests: ["src/lib/representation-posting.test.ts", "src/lib/manual-expense.test.ts"],
  },
  {
    id: "foreign_currency",
    area: "redovisning",
    label: "Annan valuta än SEK",
    level: "unsupported",
    summary: "Fakturor, kvitton eller bankkonton i euro eller andra valutor kan inte registreras. Valutakurser och kursdifferenser saknar regler.",
    enforcement: "Onboardingen avvisar bolaget; datamodellen tillåter bara SEK.",
    source: "Bokföringslagen 4 kap. 6 §; BFNAR 2016:10 kap. 8 (omräkning av poster i utländsk valuta).",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/support/support.test.ts"],
  },
  {
    id: "eu_sales_export",
    area: "redovisning",
    label: "Försäljning eller inköp utanför Sverige",
    level: "unsupported",
    summary: "EU-försäljning, export, import och tjänster till utlandet kräver momsregler (unionsintern handel, OSS, importmoms) som inte är verifierade i Ferva.",
    enforcement: "Onboardingen avvisar bolaget; kunder saknar landfält och momsdeklarationen fyller inte rutorna för EU-handel eller export.",
    source: "Mervärdesskattelagen (2023:200), reglerna om unionsintern handel, export och import.",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/support/support.test.ts"],
  },
  {
    id: "margin_scheme",
    area: "redovisning",
    label: "Vinstmarginalbeskattning (VMB)",
    level: "unsupported",
    summary: "Begagnade varor, konst och resetjänster med VMB kan inte hanteras.",
    enforcement: "Inga VMB-konton eller momskoder finns; onboardingen avvisar bolag som beskriver handel med begagnat.",
    source: "Mervärdesskattelagen (2023:200), reglerna om vinstmarginalbeskattning.",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/support/support.test.ts"],
  },
  {
    id: "inventory_manufacturing",
    area: "redovisning",
    label: "Lager och tillverkning",
    level: "unsupported",
    summary: "Lagervärdering, inkurans och pågående tillverkning kräver bokslutsbilagor som Ferva inte har.",
    enforcement: "Onboardingen avvisar bolaget; ingen lagerbilaga finns i bokslutet.",
    source: "BFNAR 2016:10 kap. 12 (varulager); Inkomstskattelagen 17 kap.",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/support/support.test.ts"],
  },
  {
    id: "complex_equity_events",
    area: "redovisning",
    label: "Komplexa aktieaffärer, ackord och andra INK2-undantag",
    level: "unsupported",
    summary: "Nyemission till överkurs, aktieägartillskott med villkor, ackord, fusion och liknande hanteras av konsult i annat system.",
    enforcement: "INK2-motorn stoppar deklarationen när räkenskapsåret innehåller poster den inte har regler för.",
    source: "Inkomstskattelagen 40 kap. (ackord, underskott); Skatteverkets SRU-specifikation för INK2.",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/accounting/ink2.test.ts"],
  },

  /* ------------------------------ fakturering ------------------------------ */
  {
    id: "invoicing_domestic_vat",
    area: "fakturering",
    label: "Svensk kundfakturering med 0, 6, 12 eller 25 % moms",
    level: "supported",
    summary: "Fakturor och kreditfakturor till svenska kunder som PDF via e-post, med momsredovisning per momssats.",
    enforcement: "Servern avvisar andra momssatser vid utfärdande (line_vat) och utfärdar aldrig en faktura på 0 kr utom kreditfakturor.",
    source: "Mervärdesskattelagen (2023:200) 9 kap. (skattesatser) och 17 kap. (fakturans innehåll).",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/invoices/issue-errors.test.ts", "src/lib/invoices/document-view.test.ts"],
  },
  {
    id: "rot_rut",
    area: "fakturering",
    label: "ROT- och RUT-avdrag",
    level: "supported",
    summary: "Skattereduktion på fakturan till privatpersoner, underlag till Skatteverket och bokföring av utbetalningen.",
    enforcement: "Fakturan blockeras när uppgifter för skattereduktionen saknas (personnummer, fastighetsbeteckning, arbetstyp) eller taket överskrids.",
    source: "Inkomstskattelagen 67 kap. 11–19 §§; Skatteverkets filspecifikation för HUS-begäran.",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/tax-reduction.test.ts", "src/lib/hus-begaran.test.ts"],
  },
  {
    id: "reverse_charge_construction_outgoing",
    area: "fakturering",
    label: "Omvänd byggmoms på egna kundfakturor",
    level: "consultant",
    summary:
      "Att fakturera byggtjänster utan moms till ett annat byggföretag kräver att hela kedjan faktura → momsdeklaration → bokföring är expertverifierad. Tills dess får fallet användas när bolagets redovisningskonsult godkänt det i Ferva.",
    enforcement:
      "Utfärdande av en faktura med omvänd byggmoms blockeras (scope_reverse_charge) tills en redovisningskonsult med tillgång till bolaget godkänt fallet.",
    source: "Mervärdesskattelagen (2023:200), omvänd betalningsskyldighet för byggtjänster; Skatteverkets ställningstaganden om byggtjänster.",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/support/support.test.ts", "src/lib/invoices/reverse-charge.test.ts"],
  },
  {
    id: "e_invoice_peppol",
    area: "fakturering",
    label: "E-faktura (Peppol)",
    level: "unsupported",
    summary: "Kundfakturor skickas som PDF via e-post och kan laddas ned. E-faktura ingår inte ännu.",
    enforcement: "Ingen e-fakturakanal finns i produkten; inga inställningar eller löften visas.",
    source: "Lag (2018:1277) om elektroniska fakturor till följd av offentlig upphandling (gäller bara offentliga köpare).",
    effectiveFrom: "2026-09-13",
    owner: OWNER_PRODUCT,
    tests: ["src/lib/support/support.test.ts"],
  },

  /* ---------------------------------- lön ---------------------------------- */
  {
    id: "payroll_fixed_monthly",
    area: "lon",
    label: "Fast månadslön till ägare eller anställd",
    level: "supported",
    summary: "Hel månadslön med tabell- eller procentskatt, åldersberoende arbetsgivaravgift, lönespecifikation och arbetsgivardeklaration.",
    enforcement: "Anställdmodellen tar bara emot fast månadslön; lönekörningen bokförs och fryses per månad.",
    source: "Skatteförfarandelagen (2011:1244) 11 kap.; Socialavgiftslagen (2000:980); Skatteverkets skattetabeller.",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/accounting/payroll.test.ts"],
  },
  {
    id: "payroll_complex",
    area: "lon",
    label: "Timlön, övertid, sjuklön, förmåner, pension, retroaktiv lön, slutlön och kollektivavtal",
    level: "unsupported",
    summary: "Allt som inte är en fast månadslön saknar verifierade regler i Ferva och sköts i ett lönesystem eller av konsult.",
    enforcement: "Onboardingen avvisar bolaget; datamodellen har inga fält för timmar, tillägg eller förmåner.",
    source: "Lag (1991:1047) om sjuklön; Inkomstskattelagen 61 kap. (förmåner); Skatteförfarandelagen 11 kap.",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/support/support.test.ts"],
  },

  /* -------------------------------- bokslut -------------------------------- */
  {
    id: "bookkeeping_core",
    area: "bokslut",
    label: "Löpande bokföring, moms, arbetsgivardeklaration och INK2",
    level: "supported",
    summary: "Bankhändelser, kvitton och fakturor bokförs med BAS-kontoplan; momsdeklaration, AGI och INK2 tas fram ur bokföringen.",
    enforcement: "Perioder låses vid deklaration; verifikationer är oföränderliga och rättas med ny verifikation.",
    source: "Bokföringslagen 5 kap.; BAS-kontoplanen; Skatteverkets filspecifikationer för moms, AGI och SRU.",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/accounting/accounting.test.ts", "src/lib/accounting/vat-flow.test.ts", "src/lib/accounting/ink2.test.ts"],
  },
  {
    id: "year_end_k2_schedules",
    area: "bokslut",
    label: "Bokslut med Fervas bilagor: avskrivningar, periodiseringar, periodiseringsfond och skatt",
    level: "supported",
    summary: "Årsbokslut och K2-årsredovisning för aktiebolag med de bilagor som finns i Ferva.",
    enforcement: "Bilagorna bokförs bara inom sina regler (t.ex. högst 25 % till periodiseringsfond); årsredovisningen kräver stängt år.",
    source: "BFNAR 2016:10 (K2); Inkomstskattelagen 30 kap. (periodiseringsfond); 18 kap. (inventarier).",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/accounting/year-end.test.ts", "src/lib/accounting/annual-report.test.ts"],
  },
  {
    id: "year_end_other",
    area: "bokslut",
    label: "Bokslutsposter utan bilaga i Ferva",
    level: "unsupported",
    summary: "Lager, pågående arbeten enligt huvudregeln, uppskjuten skatt, garantiavsättningar och liknande hanteras av konsult utanför Ferva.",
    enforcement: "Ingen bilaga kan bokföras för fallen; konsulten registrerar dem som manuella verifikationer i annat system.",
    source: "BFNAR 2016:10 kap. 6 (intäkter från uppdrag), kap. 12 (varulager), kap. 16 (avsättningar).",
    effectiveFrom: "2026-09-13",
    owner: OWNER_RULES,
    tests: ["src/lib/support/support.test.ts"],
  },
  {
    id: "filing_manual",
    area: "bokslut",
    label: "Manuell inlämning till Skatteverket och Bolagsverket",
    level: "supported",
    summary: "Ferva tar fram filerna (moms, AGI, SRU, HUS, årsredovisning) och du lämnar in dem själv. Kvittot registreras i Ferva.",
    enforcement: "Inlämningsflödet är export-first; ett riktigt företag ser aldrig en simulerad inlämning eller signering.",
    source: "Skatteförfarandelagen 38 kap. (formkrav); Bolagsverkets regler för digital inlämning av årsredovisning.",
    effectiveFrom: "2026-09-13",
    owner: OWNER_PRODUCT,
    tests: ["src/lib/filing/filing-submission.test.ts"],
  },
  {
    id: "filing_electronic",
    area: "bokslut",
    label: "Automatisk inlämning via API med e-signering",
    level: "unsupported",
    summary: "Kräver avtal med inlämningsleverantör och riktig signering. Tills dess lämnas allt in manuellt.",
    enforcement: "Ingen leverantörsadapter är aktiv utan nycklar och avtal; demoläget är tydligt märkt.",
    source: "Skatteverkets och Bolagsverkets villkor för API-inlämning.",
    effectiveFrom: "2026-09-13",
    owner: OWNER_PRODUCT,
    tests: ["src/lib/filing/filing-submission.test.ts"],
  },
];

const BY_ID = new Map<SupportEntryId, SupportEntry>(SUPPORT_MATRIX.map((e) => [e.id, e]));

export function supportEntry(id: SupportEntryId): SupportEntry {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`Okänd post i supportmatrisen: ${id}`);
  return entry;
}

export function isSupportEntryId(value: unknown): value is SupportEntryId {
  return typeof value === "string" && BY_ID.has(value as SupportEntryId);
}

export function entriesByArea(area: SupportArea): SupportEntry[] {
  return SUPPORT_MATRIX.filter((e) => e.area === area);
}

export function entriesAtLevel(level: SupportLevel): SupportEntry[] {
  return SUPPORT_MATRIX.filter((e) => e.level === level);
}

/** Ordningen som hjälpsidan och konsultvyn använder. */
export const SUPPORT_AREAS: readonly SupportArea[] = ["bolag", "redovisning", "fakturering", "lon", "bokslut"];

/** Strängaste nivån vinner: unsupported > consultant > supported. */
export function worstLevel(levels: readonly SupportLevel[]): SupportLevel {
  if (levels.includes("unsupported")) return "unsupported";
  if (levels.includes("consultant")) return "consultant";
  return "supported";
}

/** Är matrisposten giltig ett visst datum? Poster utan effectiveTo gäller tills vidare. */
export function entryEffectiveOn(entry: SupportEntry, isoDay: string): boolean {
  if (isoDay < entry.effectiveFrom) return false;
  if (entry.effectiveTo && isoDay > entry.effectiveTo) return false;
  return true;
}
