/**
 * Motpartsnormalisering och en versionerad, generell svensk merchant-
 * kunskapsbas. Ren data + rena funktioner – inga lagerberoenden, används av
 * både förslagsmotorn (server) och vyerna (klient).
 *
 * Två saker skiljs strikt:
 *   * normalizeMerchant: "MCDONALDS 1234 STOCKHOLM", "McDonald's 5678" och
 *     "MCDONALD'S GBG" blir samma stabila nyckel (råtexten behålls alltid).
 *   * MERCHANT_KB: vad en känd motpart KAN vara – möjliga kategorier, den
 *     följdfråga som måste ställas och riskflaggor. Aldrig en slutlig bokning:
 *     Shell kan vara drivmedel, butik, biltvätt eller privat; McDonald's är
 *     inte "mat" utan privat, representation, personalmåltid eller tjänsteresa.
 *
 * Kunskapsbasen är versionerad (MERCHANT_KB_VERSION) så att varje loggat
 * beslut kan spåras till den kunskap som gällde.
 */

export const MERCHANT_KB_VERSION = "2026.09.1";

export type MerchantType =
  | "drivmedel"
  | "restaurang"
  | "dagligvaror"
  | "bygghandel"
  | "grossist"
  | "verktyg"
  | "telekom"
  | "forsakring"
  | "programvara"
  | "kollektivtrafik"
  | "parkering"
  | "hotell"
  | "bank"
  | "skatteverket"
  | "myndighet"
  | "kontantuttag"
  | "hyra";

export const MERCHANT_TYPE_LABEL: Record<MerchantType, string> = {
  drivmedel: "drivmedelsstation",
  restaurang: "restaurang/snabbmat",
  dagligvaror: "livsmedelsbutik",
  bygghandel: "bygghandel",
  grossist: "grossist",
  verktyg: "järn- och verktygshandel",
  telekom: "teleoperatör",
  forsakring: "försäkringsbolag",
  programvara: "programvara/abonnemang",
  kollektivtrafik: "kollektivtrafik",
  parkering: "parkering",
  hotell: "hotell",
  bank: "bank",
  skatteverket: "Skatteverket",
  myndighet: "myndighet",
  kontantuttag: "kontantuttag",
  hyra: "hyresvärd",
};

export type MerchantRisk = "privat" | "representation" | "moms_osaker" | "kontant";

export interface MerchantFollowUp {
  /** Vardagsfrågan som måste ställas innan köpet bokförs. */
  question: string;
  /** 2–4 begripliga svar. Svaren mappas i services/expenses.ts. */
  options: string[];
}

export interface MerchantKnowledge {
  key: string;
  display: string;
  type: MerchantType;
  patterns: RegExp[];
  /** Möjliga utgiftskategorier (nycklar i EXPENSE_CATEGORIES), troligast först. */
  categories: string[];
  followUp?: MerchantFollowUp;
  risk: MerchantRisk[];
  /**
   * Får ett köp hos motparten bokföras automatiskt när kvittot finns och
   * kategorin är entydig? Bara för motparter utan privat-/momsrisk (bygghandel,
   * grossist, telekom, programvara). Riskmotparter kräver alltid ett svar tills
   * företagets egen regel är inlärd.
   */
  autoBookWithReceipt: boolean;
  /**
   * Generisk kunskap ("restaurang", "pizzeria", "hotell", "parkering"): ger
   * typ, följdfråga och risk men INTE nyckel – två olika pizzerior ska aldrig
   * dela regel. Varumärken (Shell, Byggmax) är aldrig generiska.
   */
  generic?: boolean;
}

export const PRIVATE_ANSWER = "Privat / gäller inte företaget";

const FUEL_FOLLOW_UP: MerchantFollowUp = {
  question: "Var köpet drivmedel till företaget?",
  options: ["Drivmedel", "Butik/förbrukning", "Biltvätt", PRIVATE_ANSWER],
};

const RESTAURANT_FOLLOW_UP: MerchantFollowUp = {
  question: "Vad var måltiden?",
  options: [PRIVATE_ANSWER, "Kundrepresentation", "Personalmåltid", "Mat på tjänsteresa"],
};

const GROCERY_FOLLOW_UP: MerchantFollowUp = {
  question: "Vad gällde köpet?",
  options: [PRIVATE_ANSWER, "Förbrukning till företaget", "Kundrepresentation", "Personalmåltid"],
};

const HOTEL_FOLLOW_UP: MerchantFollowUp = {
  question: "Var övernattningen en tjänsteresa?",
  options: ["Hotell på tjänsteresa", "Konferens", PRIVATE_ANSWER],
};

/**
 * JavaScripts \b är ASCII: mellan "f" och "ö" finns en ordgräns, så /\bif\b/
 * skulle träffa "Ifö". Byt varje \b mot en unicode-medveten gräns
 * (bokstäver och siffror räknas som ordtecken).
 */
const UNI_BOUNDARY = "(?:(?<![\\p{L}\\p{N}])|(?![\\p{L}\\p{N}]))";
function uni(re: RegExp): RegExp {
  const flags = re.flags.includes("u") ? re.flags : `${re.flags}u`;
  return new RegExp(re.source.replace(/\\b/gu, UNI_BOUNDARY), flags);
}

function kb(
  key: string,
  display: string,
  type: MerchantType,
  patterns: RegExp[],
  categories: string[],
  opts: { followUp?: MerchantFollowUp; risk?: MerchantRisk[]; autoBookWithReceipt?: boolean; generic?: boolean } = {}
): MerchantKnowledge {
  return {
    key,
    display,
    type,
    patterns: patterns.map(uni),
    categories,
    followUp: opts.followUp,
    risk: opts.risk ?? [],
    autoBookWithReceipt: opts.autoBookWithReceipt ?? false,
    ...(opts.generic ? { generic: true } : {}),
  };
}

function generic(entry: MerchantKnowledge): MerchantKnowledge {
  return { ...entry, generic: true };
}

const fuel = (key: string, display: string, ...patterns: RegExp[]) =>
  kb(key, display, "drivmedel", patterns, ["drivmedel", "verktyg", "ovrigt"], { followUp: FUEL_FOLLOW_UP, risk: ["privat"] });
const restaurant = (key: string, display: string, ...patterns: RegExp[]) =>
  kb(key, display, "restaurang", patterns, ["representation", "personal", "kost_resa"], {
    followUp: RESTAURANT_FOLLOW_UP,
    risk: ["privat", "representation", "moms_osaker"],
  });
const grocery = (key: string, display: string, ...patterns: RegExp[]) =>
  kb(key, display, "dagligvaror", patterns, ["verktyg", "representation", "personal"], {
    followUp: GROCERY_FOLLOW_UP,
    risk: ["privat", "moms_osaker"],
  });
const building = (key: string, display: string, ...patterns: RegExp[]) =>
  kb(key, display, "bygghandel", patterns, ["material", "verktyg"], { autoBookWithReceipt: true });
const wholesaler = (key: string, display: string, ...patterns: RegExp[]) =>
  kb(key, display, "grossist", patterns, ["material", "verktyg"], { autoBookWithReceipt: true });
/** Järn-/verktygshandel: förbrukning för snickaren – bokförs med kvitto. */
const tools = (key: string, display: string, ...patterns: RegExp[]) =>
  kb(key, display, "verktyg", patterns, ["verktyg", "material"], { autoBookWithReceipt: true });
/** Hemelektronik: hög privatrisk – alltid en fråga tills företagets regel finns. */
const electronics = (key: string, display: string, ...patterns: RegExp[]) =>
  kb(key, display, "verktyg", patterns, ["verktyg", "programvara"], { risk: ["privat"] });
const telecom = (key: string, display: string, ...patterns: RegExp[]) =>
  kb(key, display, "telekom", patterns, ["telefon"], { autoBookWithReceipt: true });
const insurance = (key: string, display: string, ...patterns: RegExp[]) =>
  kb(key, display, "forsakring", patterns, ["forsakring"], { autoBookWithReceipt: true });
const software = (key: string, display: string, ...patterns: RegExp[]) =>
  kb(key, display, "programvara", patterns, ["programvara"], { autoBookWithReceipt: true });
const transit = (key: string, display: string, ...patterns: RegExp[]) =>
  kb(key, display, "kollektivtrafik", patterns, ["resa", "ovrigt"], { risk: ["privat"] });
const parking = (key: string, display: string, ...patterns: RegExp[]) =>
  kb(key, display, "parkering", patterns, ["parkering", "ovrigt"], { risk: ["privat"] });
const hotel = (key: string, display: string, ...patterns: RegExp[]) =>
  kb(key, display, "hotell", patterns, ["hotell", "konferens"], { followUp: HOTEL_FOLLOW_UP, risk: ["privat"] });

/**
 * Den generella kunskapsbasen. Mönstren matchar på den NORMALISERADE texten
 * (gemener, utan bolagsform, terminal-id och ortssuffix) och kräver
 * ordgränser – "shellac" är inte Shell, "Ifö" är inte If.
 */
export const MERCHANT_KB: MerchantKnowledge[] = [
  /* ------------------------------ Drivmedel ------------------------------ */
  fuel("shell", "Shell", /\bshell\b/u),
  fuel("circle_k", "Circle K", /\bcircle\s?k\b/u, /\bcirklek\b/u),
  fuel("okq8", "OKQ8", /\bokq\s?8\b/u, /\bok\s?q8\b/u),
  fuel("preem", "Preem", /\bpreem\b/u),
  fuel("st1", "St1", /\bst\s?1\b/u),
  fuel("ingo", "Ingo", /\bingo\b/u),
  fuel("tanka", "Tanka", /\btanka\b/u),
  fuel("qstar", "Qstar", /\bq\s?star\b/u),

  /* ------------------------------ Restaurang ----------------------------- */
  restaurant("mcdonalds", "McDonald's", /\bmc\s?donald'?s?\b/u, /\bmcd\b/u),
  restaurant("burger_king", "Burger King", /\bburger\s?king\b/u),
  restaurant("max", "MAX Burgers", /\bmax\s?(burgers|hamburgare)?\b/u),
  restaurant("sibylla", "Sibylla", /\bsibylla\b/u),
  restaurant("espresso_house", "Espresso House", /\bespresso\s?house\b/u),
  restaurant("pressbyran", "Pressbyrån", /\bpressbyr[åa]n\b/u),
  restaurant("seven_eleven", "7-Eleven", /\b7[\s-]?eleven\b/u),
  restaurant("subway", "Subway", /\bsubway\b/u),
  generic(restaurant("pizza", "Pizzeria", /\bpizz(a|eria)\b/u)),
  generic(restaurant("restaurang", "Restaurang", /\brestaurang\b/u, /\brestaurant\b/u, /\bkrog\b/u, /\bbistro\b/u, /\bcaf[ée]\b/u, /\bkonditori\b/u, /\bbageri\b/u)),
  restaurant("foodora", "Foodora", /\bfoodora\b/u, /\buber\s?eats\b/u, /\bwolt\b/u),
  restaurant("systembolaget", "Systembolaget", /\bsystembolaget\b/u),

  /* ------------------------------ Dagligvaror ---------------------------- */
  grocery("ica", "ICA", /\bica\b/u),
  grocery("coop", "Coop", /\bcoop\b/u),
  grocery("willys", "Willys", /\bwillys\b/u),
  grocery("hemkop", "Hemköp", /\bhemk[öo]p\b/u),
  grocery("lidl", "Lidl", /\blidl\b/u),
  grocery("city_gross", "City Gross", /\bcity\s?gross\b/u),

  /* ------------------------------ Bygghandel ----------------------------- */
  building("bauhaus", "Bauhaus", /\bbauhaus\b/u),
  building("byggmax", "Byggmax", /\bbyggmax\b/u),
  building("beijer", "Beijer Byggmaterial", /\bbeijer\b/u),
  building("k_rauta", "K-Rauta", /\bk[\s-]?rauta\b/u),
  building("hornbach", "Hornbach", /\bhornbach\b/u),
  building("xl_bygg", "XL-Bygg", /\bxl[\s-]?bygg\b/u),
  building("optimera", "Optimera", /\boptimera\b/u),
  building("woody", "Woody Bygghandel", /\bwoody\b/u),
  building("derome", "Derome", /\bderome\b/u),
  building("bolist", "Bolist", /\bbolist\b/u),
  building("byggtema", "Byggtema", /\bbyggtema\b/u),
  building("fresks", "Fresks", /\bfresks\b/u),
  building("bygghemma", "Bygghemma", /\bbygghemma\b/u),
  building("flugger", "Flügger", /\bfl[üu]gger\b/u),
  building("beckers", "Beckers", /\bbeckers\b/u),

  /* ------------------------------- Grossist ------------------------------ */
  wholesaler("ahlsell", "Ahlsell", /\bahlsell\b/u),
  wholesaler("dahl", "Dahl", /\bdahl\b/u),
  wholesaler("solar", "Solar", /\bsolar\b/u),
  wholesaler("onninen", "Onninen", /\bonninen\b/u),
  wholesaler("swedol", "Swedol", /\bswedol\b/u),
  wholesaler("wurth", "Würth", /\bw[üu]rth\b/u),
  wholesaler("hilti", "Hilti", /\bhilti\b/u),
  wholesaler("elektroskandia", "Elektroskandia", /\belektroskandia\b/u),
  wholesaler("rexel", "Rexel", /\brexel\b/u),

  /* -------------------------------- Verktyg ------------------------------ */
  tools("clas_ohlson", "Clas Ohlson", /\bclas\s?ohlson\b/u),
  tools("jula", "Jula", /\bjula\b/u),
  tools("biltema", "Biltema", /\bbiltema\b/u),
  electronics("kjell", "Kjell & Company", /\bkjell\b/u),
  electronics("elgiganten", "Elgiganten", /\belgiganten\b/u),
  electronics("mediamarkt", "MediaMarkt", /\bmedia\s?markt\b/u),

  /* -------------------------------- Telekom ------------------------------ */
  telecom("telia", "Telia", /\btelia\b/u),
  telecom("telenor", "Telenor", /\btelenor\b/u),
  telecom("tele2", "Tele2", /\btele\s?2\b/u, /\bcomviq\b/u),
  telecom("tre", "Tre", /\btre\b/u, /\bhi3g\b/u, /\b3\s?sverige\b/u, /\bhallon\b/u),
  telecom("bahnhof", "Bahnhof", /\bbahnhof\b/u),
  telecom("telness", "Telness", /\btelness\b/u),

  /* ------------------------------ Försäkring ----------------------------- */
  insurance("trygg_hansa", "Trygg-Hansa", /\btrygg[\s-]?hansa\b/u),
  insurance("if", "If Skadeförsäkring", /\bif\b/u),
  insurance("lansforsakringar", "Länsförsäkringar", /\bl[äa]nsf[öo]rs[äa]kringar\b/u, /\blf\s?(skåne|stockholm|göteborg|uppsala|bergslagen|halland|jämtland|norrbotten|västerbotten|gävleborg|kalmar|kronoberg|blekinge|gotland|jönköping|älvsborg|skaraborg|värmland|dalarna|västernorrland|östgöta|södermanland)\b/u),
  insurance("folksam", "Folksam", /\bfolksam\b/u),
  insurance("gjensidige", "Gjensidige", /\bgjensidige\b/u),
  insurance("dina", "Dina Försäkringar", /\bdina\s?f[öo]rs[äa]kringar\b/u),
  insurance("moderna", "Moderna Försäkringar", /\bmoderna\s?f[öo]rs[äa]kringar\b/u),
  insurance("fora", "Fora", /\bfora\b/u),
  insurance("collectum", "Collectum", /\bcollectum\b/u),

  /* ------------------------------ Programvara ---------------------------- */
  software("adobe", "Adobe", /\badobe\b/u),
  software("microsoft", "Microsoft", /\bmicrosoft\b/u, /\bmsft\b/u),
  software("google", "Google", /\bgoogle\b/u),
  software("apple", "Apple", /\bapple\.com\b/u, /\bapple\b/u),
  software("fortnox", "Fortnox", /\bfortnox\b/u),
  software("bygglet", "Bygglet", /\bbygglet\b/u),

  /* ------------------------ Kollektivtrafik & parkering ------------------ */
  transit("sl", "SL", /\bsl\b/u, /\bstorstockholms lokaltrafik\b/u),
  transit("vasttrafik", "Västtrafik", /\bv[äa]sttrafik\b/u),
  transit("skanetrafiken", "Skånetrafiken", /\bsk[åa]netrafiken\b/u),
  transit("sj", "SJ", /\bsj\b/u),
  parking("parkster", "Parkster", /\bparkster\b/u),
  parking("easypark", "EasyPark", /\beasy\s?park\b/u),
  parking("apcoa", "Apcoa", /\bapcoa\b/u),
  parking("aimo", "Aimo Park", /\baimo\b/u),
  generic(parking("parkering", "Parkering", /\bparkering\b/u, /\bp-avgift\b/u)),

  /* -------------------------------- Hotell ------------------------------- */
  hotel("scandic", "Scandic", /\bscandic\b/u),
  hotel("nordic_choice", "Strawberry (Nordic Choice)", /\bnordic\s?choice\b/u, /\bstrawberry\b/u, /\bclarion\b/u, /\bcomfort\s?hotel\b/u),
  generic(hotel("hotell", "Hotell", /\bhotel+\b/u, /\bhostel\b/u)),

  /* ----------------------------- Myndigheter ----------------------------- */
  kb("skatteverket", "Skatteverket", "skatteverket", [/\bskatteverket\b/u, /\bskv\b/u, /\bskattekonto\b/u], ["ovrigt"]),
  kb("bolagsverket", "Bolagsverket", "myndighet", [/\bbolagsverket\b/u], ["ovrigt"], { autoBookWithReceipt: true }),
  kb("transportstyrelsen", "Transportstyrelsen", "myndighet", [/\btransportstyrelsen\b/u], ["ovrigt"], { autoBookWithReceipt: true }),

  /* ------------------------------ Kontantuttag --------------------------- */
  kb("kontantuttag", "Kontantuttag", "kontantuttag", [/\buttag\b/u, /\bbankomat\b/u, /\batm\b/u, /\bcash\b/u, /\bkontantuttag\b/u], [], {
    risk: ["kontant", "privat", "moms_osaker"],
    generic: true,
  }),
];

const BY_KEY = new Map(MERCHANT_KB.map((m) => [m.key, m]));

export function merchantKnowledgeByKey(key: string): MerchantKnowledge | undefined {
  return BY_KEY.get(key);
}

/* ----------------------------- Normalisering ----------------------------- */

const COMPANY_SUFFIX = /\b(ab|hb|kb|aktiebolag|publ|sverige|sweden|filial|oy|as|a\/s|ltd|gmbh|inc|llc|bv)\b/gu;
const PAYMENT_NOISE =
  /\b(kortköp|kortkop|k[öo]p|card|visa|mastercard|maestro|bankkort|betalkort|autogiro|swish|klarna|paypal|betalning|payment|purchase|pos|nets|ecom|e-handel|web|online|www)\b/gu;
const TERMINAL_TOKEN = /\b(?=[a-z0-9-]*\d)[a-z0-9-]{3,}\b/gu;
const DATE_TOKEN = /\b\d{2,4}[-./]\d{1,2}([-./]\d{1,4})?\b/gu;

/** Ortsnamn som brukar hänga på i kortköpstexter ("SHELL GÖTEBORG"). */
const CITIES = [
  "stockholm", "sthlm", "göteborg", "goteborg", "gbg", "malmö", "malmo", "uppsala", "västerås", "vasteras", "örebro", "orebro",
  "linköping", "linkoping", "helsingborg", "jönköping", "jonkoping", "norrköping", "norrkoping", "lund", "umeå", "umea", "gävle",
  "gavle", "borås", "boras", "eskilstuna", "södertälje", "sodertalje", "karlstad", "täby", "taby", "växjö", "vaxjo", "halmstad",
  "sundsvall", "luleå", "lulea", "trollhättan", "trollhattan", "östersund", "ostersund", "borlänge", "borlange", "falun",
  "kalmar", "skövde", "skovde", "karlskrona", "kristianstad", "skellefteå", "skelleftea", "uddevalla", "varberg", "nyköping",
  "nykoping", "motala", "landskrona", "solna", "sundbyberg", "nacka", "huddinge", "haninge", "botkyrka", "järfälla", "jarfalla",
  "sollentuna", "kungsbacka", "kungälv", "kungalv", "mölndal", "molndal", "partille", "lerum", "årsta", "arsta", "kista",
  "bromma", "hägersten", "hagersten", "farsta", "skärholmen", "skarholmen", "barkarby", "kungens kurva", "sisjön", "sisjon",
  "hisingen", "frölunda", "frolunda", "ängelholm", "angelholm", "visby", "kiruna", "piteå", "pitea", "örnsköldsvik",
  "ornskoldsvik", "sandviken", "hudiksvall", "enköping", "enkoping", "strängnäs", "strangnas", "katrineholm", "ystad",
  "trelleborg", "hässleholm", "hassleholm", "lidköping", "lidkoping", "mariestad", "alingsås", "alingsas", "vänersborg",
  "vanersborg", "falkenberg", "vetlanda", "nässjö", "nassjo", "tranås", "tranas", "värnamo", "varnamo", "ljungby",
];
const CITY_RE = new RegExp(`\\b(${CITIES.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gu");

export interface NormalizedMerchant {
  /** Stabil nyckel för regler: "mcdonalds", "circle k", "hyresvärden i sthlm". */
  key: string;
  /** Visningsnamn – kunskapsbasens om den känner motparten, annars snyggad råtext. */
  display: string;
  /** Råtexten precis som banken gav den. Tappas aldrig. */
  raw: string;
  knowledge?: MerchantKnowledge;
}

function titleCase(s: string, raw: string): string {
  const allCaps = raw.toUpperCase() === raw;
  const upperInRaw = new Set(raw.split(/\s+/u).filter((w) => w.length <= 3 && w === w.toUpperCase()).map((w) => w.toLowerCase()));
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length <= 3 && (allCaps || upperInRaw.has(w)) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Text → gemener utan skräp; grunden för både nyckel och KB-matchning. */
export function normalizedMerchantText(raw: string): string {
  let s = raw.toLowerCase().replace(/['’`´]/gu, "").replace(/&/gu, " ").replace(/[*_/|#,;:()[\]{}"]+/gu, " ");
  s = s.replace(DATE_TOKEN, " ");
  s = s.replace(COMPANY_SUFFIX, " ");
  s = s.replace(PAYMENT_NOISE, " ");
  s = s.replace(/\s+/gu, " ").trim();
  return s;
}

/**
 * Normalisera en motpart. Nyckeln tar bort terminal-id, siffror, bolagsform
 * och ortssuffix men rör inte betydelsebärande siffror i kända namn (Tele2,
 * OKQ8, St1, 7-Eleven) – de träffas av kunskapsbasen före rensningen.
 */
const NORMALIZE_CACHE = new Map<string, NormalizedMerchant>();
const NORMALIZE_CACHE_MAX = 2_000;

export function normalizeMerchant(raw: string): NormalizedMerchant {
  const cached = NORMALIZE_CACHE.get(raw);
  if (cached) return cached;
  const result = normalizeMerchantUncached(raw);
  if (NORMALIZE_CACHE.size >= NORMALIZE_CACHE_MAX) NORMALIZE_CACHE.clear();
  NORMALIZE_CACHE.set(raw, result);
  return result;
}

function normalizeMerchantUncached(raw: string): NormalizedMerchant {
  const text = normalizedMerchantText(raw);
  const knowledge = MERCHANT_KB.find((m) => m.patterns.some((p) => p.test(text)));
  if (knowledge && !knowledge.generic) return { key: knowledge.key, display: knowledge.display, raw, knowledge };

  let key = text.replace(TERMINAL_TOKEN, " ").replace(/\b\d+\b/gu, " ");
  key = key.replace(CITY_RE, " ");
  key = key.replace(/[^a-zåäöéü0-9\- ]+/gu, " ").replace(/(^| )[a-zåäö]( |$)/gu, " ").replace(/\s+/gu, " ").trim();
  if (!key) key = text.replace(/[^a-zåäöéü0-9\- ]+/gu, " ").replace(/\s+/gu, " ").trim();
  return { key, display: key ? titleCase(key, raw) : raw.trim(), raw, ...(knowledge ? { knowledge } : {}) };
}

/* ------------------------------ Riskflaggor ------------------------------ */

export type RiskFlag =
  | "privat_risk"
  | "restaurang"
  | "kontantuttag"
  | "overforing_till_person"
  | "utland"
  | "okand_mottagare"
  | "ovanligt_belopp";

export const RISK_FLAG_LABEL: Record<RiskFlag, string> = {
  privat_risk: "Kan vara privat",
  restaurang: "Restaurang/mat – syfte och deltagare avgör avdraget",
  kontantuttag: "Kontantuttag – vad pengarna gick till måste styrkas",
  overforing_till_person: "Överföring till en person",
  utland: "Utländsk motpart – momsen hanteras annorlunda",
  okand_mottagare: "Okänd mottagare",
  ovanligt_belopp: "Ovanligt stort belopp för motparten",
};

const FOREIGN_RE = uni(
  /\b(eur|usd|gbp|dkk|nok|pln|chf|czk)\b|\bvaluta|kurs\b|\b\d+[.,]\d{2}\s?(eur|usd|gbp)\b|\.(de|com|co\.uk|nl|pl|dk|no|fi|fr|es|it|ie|eu)\b|\bforeign\b|\butland/iu
);
const PERSON_TRANSFER_RE = uni(/\b(swish|överföring|overforing|betalning till|till konto)\b/iu);

/** Ser namnet ut som en privatperson (två–tre namnord, ingen bolagsform, inte i KB)? */
export function looksLikePersonName(counterpart: string): boolean {
  const raw = counterpart.trim();
  if (!raw) return false;
  COMPANY_SUFFIX.lastIndex = 0;
  if (COMPANY_SUFFIX.test(raw.toLowerCase())) return false;
  const words = raw.split(/\s+/u);
  if (words.length < 2 || words.length > 3) return false;
  return words.every((w) => /^\p{Lu}[\p{Ll}']+(-\p{Lu}?[\p{Ll}']+)?$/u.test(w));
}

/**
 * Deterministiska riskflaggor ur transaktionstexten och kunskapsbasen. En
 * enda flagga räcker för att kräva mänskligt beslut – aldrig automatik.
 */
export function merchantRiskFlags(input: {
  amount: number;
  counterpart: string;
  description: string;
  reference?: string;
  /** Typiskt belopp för motparten historiskt (median), om känt. */
  typicalAmount?: number;
  /** Finns redan bevis (faktura/underlag/regel) som pekar ut motparten? */
  known?: boolean;
}): RiskFlag[] {
  const flags = new Set<RiskFlag>();
  const merchant = normalizeMerchant(input.counterpart);
  const text = `${input.counterpart} ${input.description} ${input.reference ?? ""}`;
  const kbType = merchant.knowledge?.type;

  if (kbType === "kontantuttag" || /\b(uttag|bankomat|atm)\b/iu.test(text)) flags.add("kontantuttag");
  if (kbType === "restaurang") flags.add("restaurang");
  if (merchant.knowledge?.risk.includes("privat")) flags.add("privat_risk");
  if (FOREIGN_RE.test(text)) flags.add("utland");
  if (input.amount < 0 && PERSON_TRANSFER_RE.test(text) && looksLikePersonName(input.counterpart)) flags.add("overforing_till_person");
  if (input.amount < 0 && !merchant.knowledge && !input.known) flags.add("okand_mottagare");
  if (input.typicalAmount && input.typicalAmount > 0 && Math.abs(input.amount) >= 1_000 && Math.abs(input.amount) > 3 * input.typicalAmount) {
    flags.add("ovanligt_belopp");
  }
  return [...flags];
}
