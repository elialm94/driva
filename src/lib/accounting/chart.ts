import { db, loadedDb } from "../store";
import type { AccountSection, AccountType, BalanceSection, ChartAccountRecord, ResultSection } from "../types";

export type { AccountSection, AccountType, BalanceSection, ResultSection };

/**
 * Kontoregister. Kontoplanen är BAS-strukturen som data, inte en hårdkodad
 * lista med namn: varje konto får en typ och en post i resultat- eller
 * balansräkningen. Rapporterna frågar registret om strukturen i stället för
 * att gissa på nummerintervall, och årsredovisningen kan byggas på riktiga
 * K2-poster.
 *
 * Registret består av två lager:
 *
 *   1. `STANDARD_ACCOUNTS` – BAS-kontoplanen som produkten levererar. Ligger
 *      i kod så att den är versionerad och testbar, inte kopierad per företag.
 *   2. `db().chartAccounts` – företagets egna avvikelser: nya konton, ändrade
 *      namn och arkiverade konton. Bara det som avviker lagras.
 *
 * `chartAccount()` slår ihop lagren. Motorn validerar mot resultatet, så ett
 * eget konto blir bokföringsbart i samma stund det läggs till.
 */

export interface ChartAccount {
  number: number;
  name: string;
  type: AccountType;
  section: AccountSection;
  /** Sant för konton företaget lagt till själv (finns inte i standardplanen). */
  custom?: boolean;
  /** Avstängt för nya konteringar. Historiken påverkas aldrig. */
  archived?: boolean;
}

const TYPE_BY_SECTION: Record<AccountSection, AccountType> = {
  immateriella_anlaggningstillgangar: "tillgang",
  materiella_anlaggningstillgangar: "tillgang",
  finansiella_anlaggningstillgangar: "tillgang",
  varulager: "tillgang",
  kortfristiga_fordringar: "tillgang",
  kassa_och_bank: "tillgang",
  bundet_eget_kapital: "eget_kapital",
  fritt_eget_kapital: "eget_kapital",
  obeskattade_reserver: "skuld",
  avsattningar: "skuld",
  langfristiga_skulder: "skuld",
  kortfristiga_skulder: "skuld",
  nettoomsattning: "intakt",
  ovriga_rorelseintakter: "intakt",
  ravaror_och_fornodenheter: "kostnad",
  ovriga_externa_kostnader: "kostnad",
  personalkostnader: "kostnad",
  avskrivningar: "kostnad",
  ovriga_rorelsekostnader: "kostnad",
  finansiella_intakter: "intakt",
  finansiella_kostnader: "kostnad",
  bokslutsdispositioner: "kostnad",
  skatt: "kostnad",
  arets_resultat: "kostnad",
};

/**
 * BAS-kontogruppernas indelning i K2-poster. Kontogruppen (två första
 * siffrorna) ÄR BAS-strukturen, så detta är en strukturell mappning och inte
 * en gissning: intervallen följer kontoplanens egen indelning.
 */
const SECTION_RANGES: readonly (readonly [number, number, AccountSection])[] = [
  [1000, 1099, "immateriella_anlaggningstillgangar"],
  [1100, 1299, "materiella_anlaggningstillgangar"],
  [1300, 1399, "finansiella_anlaggningstillgangar"],
  [1400, 1499, "varulager"],
  [1500, 1799, "kortfristiga_fordringar"],
  [1800, 1899, "kortfristiga_fordringar"],
  [1900, 1999, "kassa_och_bank"],
  [2000, 2079, "fritt_eget_kapital"],
  [2080, 2089, "bundet_eget_kapital"],
  [2090, 2099, "fritt_eget_kapital"],
  [2100, 2199, "obeskattade_reserver"],
  [2200, 2299, "avsattningar"],
  [2300, 2399, "langfristiga_skulder"],
  [2400, 2999, "kortfristiga_skulder"],
  [3000, 3799, "nettoomsattning"],
  [3800, 3999, "ovriga_rorelseintakter"],
  [4000, 4999, "ravaror_och_fornodenheter"],
  [5000, 6999, "ovriga_externa_kostnader"],
  [7000, 7699, "personalkostnader"],
  [7700, 7899, "avskrivningar"],
  [7900, 7999, "ovriga_rorelsekostnader"],
  [8000, 8399, "finansiella_intakter"],
  [8400, 8799, "finansiella_kostnader"],
  [8800, 8899, "bokslutsdispositioner"],
  [8900, 8989, "skatt"],
  [8990, 8999, "arets_resultat"],
];

/**
 * Konton som bryter mot kontogruppens huvudregel. Håll listan kort – varje
 * post här är ett undantag som rapporterna måste förstå.
 */
const SECTION_OVERRIDES: Record<number, AccountSection> = {
  // Nedskrivningar av finansiella tillgångar ligger i kontogrupperna för
  // finansiella intäkter men är kostnader.
  8070: "finansiella_kostnader",
  8170: "finansiella_kostnader",
  8270: "finansiella_kostnader",
  // Öres- och kronutjämning hör till rörelsen, inte till nettoomsättningen.
  3740: "ovriga_rorelseintakter",
};

/** Kontots post i resultat- eller balansräkningen, härledd ur BAS-strukturen. */
export function sectionForAccount(account: number): AccountSection {
  const override = SECTION_OVERRIDES[account];
  if (override) return override;
  for (const [from, to, section] of SECTION_RANGES) {
    if (account >= from && account <= to) return section;
  }
  // Utanför BAS:s nummerrymd. Behandlas som kostnad så att den aldrig smyger
  // in i balansräkningen utan att någon märker det.
  return "ovriga_rorelsekostnader";
}

export function typeForAccount(account: number): AccountType {
  return TYPE_BY_SECTION[sectionForAccount(account)];
}

/**
 * BAS-kontoplanen som produkten levererar: de konton ett svenskt aktiebolag
 * behöver för löpande bokföring, lön, moms, bokslut och årsredovisning.
 * Företag som behöver mer lägger till egna konton, eller tar in sin
 * fullständiga kontoplan via SIE-import.
 *
 * Namnen följer BAS. De 43 konton produkten hade innan registret infördes
 * behåller sina exakta namn, så att äldre bokföring läses likadant.
 */
const STANDARD_NAMES: Readonly<Record<number, string>> = {
  /* ---- 1 Tillgångar: immateriella ---- */
  1010: "Utvecklingsutgifter",
  1018: "Ackumulerade avskrivningar på utvecklingsutgifter",
  1020: "Koncessioner, patent, licenser, varumärken",
  1028: "Ackumulerade avskrivningar på koncessioner m.m.",
  1060: "Hyresrätter, tomträtter och liknande",
  1070: "Goodwill",
  1078: "Ackumulerade avskrivningar på goodwill",

  /* ---- 1 Tillgångar: materiella ---- */
  1110: "Byggnader",
  1119: "Ackumulerade avskrivningar på byggnader",
  1130: "Mark",
  1150: "Markanläggningar",
  1159: "Ackumulerade avskrivningar på markanläggningar",
  1180: "Pågående nyanläggningar",
  1210: "Maskiner och andra tekniska anläggningar",
  1219: "Ackumulerade avskrivningar på maskiner",
  1220: "Inventarier och verktyg",
  1229: "Ack. avskrivningar inventarier",
  1230: "Installationer",
  1239: "Ackumulerade avskrivningar på installationer",
  1240: "Bilar och andra transportmedel",
  1249: "Ackumulerade avskrivningar på bilar",
  1250: "Datorer",
  1259: "Ackumulerade avskrivningar på datorer",
  1290: "Övriga materiella anläggningstillgångar",

  /* ---- 1 Tillgångar: finansiella ---- */
  1310: "Andelar i koncernföretag",
  1350: "Andelar och värdepapper i andra företag",
  1380: "Andra långfristiga fordringar",
  1385: "Kapitalförsäkring",

  /* ---- 1 Tillgångar: lager och pågående arbeten ---- */
  1410: "Lager av råvaror",
  1440: "Produkter i arbete",
  1460: "Lager av handelsvaror",
  1470: "Pågående arbeten",
  1471: "Pågående arbeten, nedlagda kostnader",
  1479: "Pågående arbeten, fakturerat",

  /* ---- 1 Tillgångar: kortfristiga fordringar ---- */
  1510: "Kundfordringar",
  1513: "Kundfordringar ROT/RUT",
  1515: "Osäkra kundfordringar",
  1519: "Nedskrivning av kundfordringar",
  1610: "Kortfristiga fordringar hos anställda",
  1611: "Reseförskott",
  1630: "Avräkning för skatter och avgifter (skattekonto)",
  1640: "Skattefordringar",
  1650: "Momsfordran",
  1680: "Andra kortfristiga fordringar",
  1685: "Kortfristiga fordringar hos delägare",
  1710: "Förutbetalda kostnader",
  1720: "Förutbetalda leasingavgifter",
  1730: "Förutbetalda försäkringspremier",
  1790: "Upplupna intäkter",

  /* ---- 1 Tillgångar: kassa och bank ---- */
  1910: "Kassa",
  1920: "PlusGiro",
  1930: "Företagskonto",
  1940: "Övriga bankkonton",
  1970: "Särredovisade bankmedel",

  /* ---- 2 Eget kapital ---- */
  2010: "Eget kapital (enskild firma)",
  2013: "Egna uttag",
  2018: "Egna insättningar",
  2019: "Årets resultat (enskild firma)",
  2081: "Aktiekapital",
  2085: "Uppskrivningsfond",
  2086: "Reservfond",
  2091: "Balanserad vinst eller förlust",
  2093: "Erhållna aktieägartillskott",
  2097: "Överkursfond",
  2098: "Vinst eller förlust från föregående år",
  2099: "Årets resultat",

  /* ---- 2 Obeskattade reserver och avsättningar ---- */
  2110: "Periodiseringsfonder",
  2150: "Ackumulerade överavskrivningar",
  2190: "Övriga obeskattade reserver",
  2210: "Avsättningar för pensioner",
  2220: "Avsättningar för garantier",
  2290: "Övriga avsättningar",

  /* ---- 2 Långfristiga skulder ---- */
  2330: "Checkräkningskredit",
  2350: "Andra långfristiga skulder till kreditinstitut",
  2390: "Övriga långfristiga skulder",
  2393: "Lån från närstående personer, långfristig del",

  /* ---- 2 Kortfristiga skulder ---- */
  2410: "Kortfristiga låneskulder till kreditinstitut",
  2420: "Förskott från kunder",
  2440: "Leverantörsskulder",
  2450: "Fakturerad men ej upparbetad intäkt",
  2499: "Andra övriga kortfristiga skulder",
  2510: "Skatteskulder",
  2512: "Beräknad inkomstskatt",
  2514: "Beräknad särskild löneskatt på pensionskostnader",
  2518: "Betald F-skatt",

  /* ---- 2 Moms ---- */
  2610: "Utgående moms, 25 % försäljning",
  2611: "Utgående moms 25 %",
  2612: "Utgående moms på egna uttag, 25 %",
  2614: "Utgående moms omvänd skattskyldighet, 25 %",
  2615: "Utgående moms import av varor, 25 %",
  2620: "Utgående moms, 12 % försäljning",
  2621: "Utgående moms 12 %",
  2624: "Utgående moms omvänd skattskyldighet, 12 %",
  2630: "Utgående moms, 6 % försäljning",
  2631: "Utgående moms 6 %",
  2634: "Utgående moms omvänd skattskyldighet, 6 %",
  2640: "Ingående moms",
  2641: "Ingående moms",
  2645: "Beräknad ingående moms på förvärv från utlandet",
  2647: "Ingående moms omvänd skattskyldighet",
  2650: "Redovisningskonto för moms",

  /* ---- 2 Personalens skatter och avgifter ---- */
  2710: "Personalskatt",
  2730: "Lagstadgade sociala avgifter och särskild löneskatt",
  2731: "Avräkning lagstadgade sociala avgifter",
  2732: "Avräkning särskild löneskatt",
  2740: "Avtalade sociala avgifter",
  2790: "Övriga löneavdrag",

  /* ---- 2 Övriga kortfristiga skulder ---- */
  2820: "Kortfristiga skulder till anställda",
  2821: "Löneskulder",
  2822: "Reseräkningar",
  2850: "Avräkning för skatter och avgifter (skattekonto)",
  2890: "Övriga kortfristiga skulder",
  2893: "Skulder till närstående personer, kortfristig del",
  2898: "Outtagen vinstutdelning",

  /* ---- 2 Upplupna kostnader och förutbetalda intäkter ---- */
  2910: "Upplupna löner",
  2920: "Upplupna semesterlöner",
  2940: "Upplupna lagstadgade sociala och andra avgifter",
  2941: "Beräknade upplupna lagstadgade sociala avgifter",
  2943: "Beräknad upplupen särskild löneskatt på pensionskostnader",
  2960: "Upplupna räntekostnader",
  2970: "Förutbetalda intäkter",
  2990: "Upplupna kostnader",
  2991: "Beräknat arvode för bokslut",
  2998: "Övriga upplupna kostnader och förutbetalda intäkter",

  /* ---- 3 Rörelsens inkomster ---- */
  3001: "Försäljning 25 %",
  3002: "Försäljning 12 %",
  3003: "Försäljning 6 %",
  3004: "Försäljning 0 %",
  3231: "Försäljning byggtjänster, omvänd skattskyldighet",
  3540: "Faktureringsavgifter",
  3590: "Övriga sidointäkter",
  3690: "Övriga ersättningar och intäkter",
  3740: "Öres- och kronutjämning",
  3960: "Valutakursvinster på fordringar och skulder av rörelsekaraktär",
  3970: "Vinst vid avyttring av immateriella och materiella anläggningstillgångar",
  3990: "Övriga ersättningar och intäkter",

  /* ---- 4 Material och varor ---- */
  4010: "Material och varor",
  4415: "Inköpta varor i Sverige, omvänd skattskyldighet, 25 % moms",
  4425: "Inköpta tjänster i Sverige, omvänd skattskyldighet, 25 % moms",
  4600: "Legoarbeten och underentreprenader",
  4731: "Lämnade rabatter",
  4960: "Förändring av lager av varor",
  4970: "Förändring av pågående arbeten",

  /* ---- 5 Lokal, förbrukning, transport, reklam ---- */
  5010: "Lokalhyra",
  5020: "El för belysning",
  5030: "Värme",
  5040: "Vatten och avlopp",
  5060: "Städning och renhållning",
  5070: "Reparation och underhåll av lokaler",
  5090: "Övriga lokalkostnader",
  5210: "Hyra av maskiner och andra tekniska anläggningar",
  5220: "Hyra av inventarier och verktyg",
  5250: "Hyra av datorer",
  5410: "Förbrukningsinventarier",
  5420: "Programvaror och licenser",
  5460: "Förbrukningsmaterial",
  5480: "Arbetskläder och skyddsmaterial",
  5490: "Övriga förbrukningsinventarier och förbrukningsmaterial",
  5510: "Reparation och underhåll av maskiner",
  5520: "Reparation och underhåll av inventarier och verktyg",
  5590: "Övriga kostnader för reparation och underhåll",
  5611: "Drivmedel",
  5612: "Försäkring och skatt för personbilar",
  5613: "Reparation och underhåll av personbilar",
  5615: "Leasing av personbilar",
  5616: "Trängselskatt",
  5619: "Övriga personbilskostnader",
  5620: "Lastbilskostnader",
  5810: "Biljetter",
  5820: "Hyrbilskostnader",
  5831: "Kost och logi",
  5832: "Kost och logi i utlandet",
  5890: "Övriga resekostnader",
  5910: "Annonsering",
  5930: "Reklamtrycksaker och direktreklam",
  5960: "Varuprover, reklamgåvor och presentreklam",
  5990: "Övriga kostnader för reklam och PR",

  /* ---- 6 Övriga externa kostnader ---- */
  6071: "Representation, avdragsgill",
  6072: "Representation",
  6090: "Övriga försäljningskostnader",
  6110: "Kontorsmateriel",
  6150: "Trycksaker",
  6211: "Fast telefoni",
  6212: "Telefon och internet",
  6230: "Datakommunikation",
  6250: "Porto",
  6310: "Företagsförsäkringar",
  6320: "Självrisker",
  6351: "Konstaterade förluster på kundfordringar",
  6352: "Befarade förluster på kundfordringar",
  6390: "Övriga riskkostnader",
  6410: "Styrelsearvoden",
  6420: "Ersättningar till revisor",
  6490: "Övriga förvaltningskostnader",
  6530: "Redovisningstjänster",
  6540: "IT-tjänster",
  6550: "Konsultarvoden",
  6560: "Serviceavgifter till branschorganisationer",
  6570: "Bankkostnader",
  6580: "Advokat- och rättegångskostnader",
  6590: "Övriga externa tjänster",
  6800: "Inhyrd personal",
  6910: "Licensavgifter och royalties",
  6970: "Tidningar, tidskrifter och facklitteratur",
  6981: "Föreningsavgifter, avdragsgilla",
  6982: "Föreningsavgifter, ej avdragsgilla",
  6991: "Övriga externa kostnader",
  6992: "Övriga externa kostnader, ej avdragsgilla",

  /* ---- 7 Personalkostnader ---- */
  7210: "Löner till tjänstemän",
  7220: "Löner till företagsledare",
  7240: "Styrelsearvoden",
  7285: "Semesterlöneskuld",
  7290: "Förändring av semesterlöneskuld",
  7321: "Skattefria traktamenten, Sverige",
  7322: "Skattepliktiga traktamenten, Sverige",
  7331: "Skattefria bilersättningar",
  7332: "Skattepliktiga bilersättningar",
  7382: "Kostnader för fria eller subventionerade måltider",
  7385: "Kostnader för fri bil",
  7389: "Övriga kostnader för förmåner",
  7410: "Pensionsförsäkringspremier",
  7510: "Lagstadgade sociala avgifter",
  7511: "Sociala avgifter för löner och ersättningar",
  7512: "Sociala avgifter för förmånsvärden",
  7515: "Sociala avgifter på skattepliktiga kostnadsersättningar",
  7519: "Sociala avgifter för semester- och löneskulder",
  7533: "Särskild löneskatt för pensionskostnader",
  7570: "Premier för arbetsmarknadsförsäkringar",
  7610: "Utbildning",
  7621: "Sjuk- och hälsovård, avdragsgill",
  7622: "Sjuk- och hälsovård, ej avdragsgill",
  7631: "Personalrepresentation, avdragsgill",
  7632: "Personalrepresentation, ej avdragsgill",
  7690: "Övriga personalkostnader",

  /* ---- 7 Av- och nedskrivningar ---- */
  7740: "Nedskrivningar av maskiner och inventarier",
  7811: "Avskrivningar på balanserade utgifter",
  7817: "Avskrivningar på goodwill",
  7821: "Avskrivningar på byggnader",
  7824: "Avskrivningar på markanläggningar",
  7831: "Avskrivningar på maskiner och andra tekniska anläggningar",
  7832: "Avskrivningar inventarier och verktyg",
  7833: "Avskrivningar på installationer",
  7834: "Avskrivningar på bilar och andra transportmedel",
  7835: "Avskrivningar på datorer",

  /* ---- 7 Övriga rörelsekostnader ---- */
  7960: "Valutakursförluster på fordringar och skulder av rörelsekaraktär",
  7970: "Förlust vid avyttring av immateriella och materiella anläggningstillgångar",
  7990: "Övriga rörelsekostnader",

  /* ---- 8 Finansiella poster ---- */
  8010: "Utdelning på andelar i koncernföretag",
  8070: "Nedskrivningar av andelar i koncernföretag",
  8210: "Utdelningar på andelar i andra företag",
  8220: "Resultat vid försäljning av värdepapper",
  8310: "Ränteintäkter från omsättningstillgångar",
  8314: "Skattefria ränteintäkter",
  8330: "Valutakursdifferenser på kortfristiga fordringar och placeringar",
  8390: "Övriga finansiella intäkter",
  8410: "Räntekostnader för långfristiga skulder",
  8420: "Räntekostnader för kortfristiga skulder",
  8422: "Dröjsmålsräntor för leverantörsskulder",
  8423: "Räntekostnader för skatter och avgifter",
  8430: "Valutakursdifferenser på skulder",
  8490: "Övriga skuldrelaterade poster",

  /* ---- 8 Bokslutsdispositioner ---- */
  8811: "Avsättning till periodiseringsfond",
  8819: "Återföring från periodiseringsfond",
  8850: "Förändring av överavskrivningar",
  8890: "Övriga bokslutsdispositioner",

  /* ---- 8 Skatter och årets resultat ---- */
  8910: "Skatt på årets resultat",
  8920: "Skatt på grund av ändrad beskattning",
  8980: "Övriga skatter",
  8999: "Årets resultat",
};

const STANDARD_ACCOUNTS: ReadonlyMap<number, ChartAccount> = new Map(
  Object.entries(STANDARD_NAMES).map(([number, name]) => {
    const account = Number(number);
    const section = sectionForAccount(account);
    return [account, { number: account, name, type: TYPE_BY_SECTION[section], section }] as const;
  })
);

/** Standardplanens konton, i nummerordning. Utan företagets egna avvikelser. */
export function standardAccounts(): ChartAccount[] {
  return [...STANDARD_ACCOUNTS.values()].sort((a, b) => a.number - b.number);
}

/** Sant om kontot finns i den levererade BAS-planen. */
export function isStandardAccount(account: number): boolean {
  return STANDARD_ACCOUNTS.has(account);
}

/**
 * Företagets avvikelser. Läses utan att seeda fram ett tillstånd: registret
 * frågas medan seedet byggs, och `db()` skulle då anropa sig själv.
 */
function overrides(): ChartAccountRecord[] {
  return loadedDb()?.chartAccounts ?? [];
}

function fromRecord(record: ChartAccountRecord): ChartAccount {
  return {
    number: record.number,
    name: record.name,
    type: record.type,
    section: record.section,
    ...(record.custom ? { custom: true } : {}),
    ...(record.archived ? { archived: true } : {}),
  };
}

/**
 * Ett konto ur registret: företagets egen version om den finns, annars
 * standardplanens. Undefined betyder att kontot inte finns – då vägrar motorn
 * bokföra på det.
 */
export function chartAccount(account: number): ChartAccount | undefined {
  const own = overrides().find((a) => a.number === account);
  if (own) return fromRecord(own);
  return STANDARD_ACCOUNTS.get(account);
}

/** Hela registret för företaget: standardplanen plus egna konton. */
export function chartAccounts(options?: { includeArchived?: boolean }): ChartAccount[] {
  const merged = new Map<number, ChartAccount>(STANDARD_ACCOUNTS);
  for (const record of overrides()) merged.set(record.number, fromRecord(record));
  const rows = [...merged.values()].sort((a, b) => a.number - b.number);
  return options?.includeArchived ? rows : rows.filter((a) => !a.archived);
}

/** Kontonamn för visning. Okända konton får ett ärligt platshållarnamn. */
export function accountName(account: number): string {
  return chartAccount(account)?.name ?? `Konto ${account}`;
}

/** Konton i en post i resultat- eller balansräkningen. */
export function accountsInSection(section: AccountSection): ChartAccount[] {
  return chartAccounts({ includeArchived: true }).filter((a) => a.section === section);
}

/* ------------------------------ Strukturfrågor ------------------------------ */

/**
 * Kontots typ enligt registret. Faller tillbaka på BAS-strukturen för konton
 * som inte finns i registret, så att rapporter aldrig tappar en rad.
 */
export function accountType(account: number): AccountType {
  return chartAccount(account)?.type ?? typeForAccount(account);
}

export function accountSection(account: number): AccountSection {
  return chartAccount(account)?.section ?? sectionForAccount(account);
}

export function isBalanceAccount(account: number): boolean {
  const type = accountType(account);
  return type === "tillgang" || type === "eget_kapital" || type === "skuld";
}

/** Rörelseintäkt (kontoklass 3). Finansiella intäkter räknas inte hit. */
export function isRevenueAccount(account: number): boolean {
  const section = accountSection(account);
  return section === "nettoomsattning" || section === "ovriga_rorelseintakter";
}

/** Rörelsekostnad. Finansiella kostnader, skatt och årets resultat räknas inte hit. */
export function isCostAccount(account: number): boolean {
  const section = accountSection(account);
  return (
    section === "ravaror_och_fornodenheter" ||
    section === "ovriga_externa_kostnader" ||
    section === "personalkostnader" ||
    section === "avskrivningar" ||
    section === "ovriga_rorelsekostnader"
  );
}

/** Finansiell post (kontoklass 8 före bokslutsdispositioner). */
export function isFinancialAccount(account: number): boolean {
  const section = accountSection(account);
  return section === "finansiella_intakter" || section === "finansiella_kostnader";
}

/**
 * Resultatkonto: allt som nollställs vid bokslutet utom kontot årets resultat
 * självt (8999), som är omföringens motkonto.
 */
export function isResultAccount(account: number): boolean {
  const section = accountSection(account);
  if (section === "arets_resultat") return false;
  return !isBalanceAccount(account);
}

/** Kontot årets resultat (BAS 8999) – omföringens motkonto vid stängning. */
export function isYearResultAccount(account: number): boolean {
  return accountSection(account) === "arets_resultat";
}

/* -------------------------------- Egna konton -------------------------------- */

export class ChartAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChartAccountError";
  }
}

function upsertRecord(record: ChartAccountRecord): void {
  const data = db();
  if (!data.chartAccounts) data.chartAccounts = [];
  const index = data.chartAccounts.findIndex((a) => a.number === record.number);
  if (index >= 0) data.chartAccounts[index] = record;
  else data.chartAccounts.push(record);
}

export interface AddAccountInput {
  number: number;
  name: string;
  /** Utan angiven post härleds den ur BAS-strukturen. */
  section?: AccountSection;
}

/**
 * Lägg till ett eget konto. Kontot blir bokföringsbart direkt – motorn
 * validerar mot samma register. Numret måste ligga i BAS:s nummerrymd så att
 * rapporterna kan placera kontot.
 */
export function addCustomAccount(input: AddAccountInput): ChartAccount {
  const number = Math.trunc(input.number);
  if (!Number.isInteger(number) || number < 1000 || number > 8999) {
    throw new ChartAccountError(
      `Kontonummer måste vara fyrsiffrigt mellan 1000 och 8999. ${input.number} går inte att placera i kontoplanen.`
    );
  }
  const name = input.name.trim();
  if (!name) throw new ChartAccountError("Kontot behöver ett namn.");
  const existing = chartAccount(number);
  if (existing && !existing.archived) {
    throw new ChartAccountError(`Konto ${number} finns redan i kontoplanen: ${existing.name}.`);
  }
  const section = input.section ?? sectionForAccount(number);
  const record: ChartAccountRecord = {
    id: `konto-${number}`,
    number,
    name,
    type: TYPE_BY_SECTION[section],
    section,
    custom: !STANDARD_ACCOUNTS.has(number),
    createdAt: new Date().toISOString(),
  };
  upsertRecord(record);
  return fromRecord(record);
}

/** Döp om ett konto. Bokförda verifikationer behåller sitt sparade kontonamn. */
export function renameAccount(account: number, name: string): ChartAccount {
  const current = chartAccount(account);
  if (!current) throw new ChartAccountError(`Konto ${account} finns inte i kontoplanen.`);
  const trimmed = name.trim();
  if (!trimmed) throw new ChartAccountError("Kontot behöver ett namn.");
  const record: ChartAccountRecord = {
    id: `konto-${account}`,
    number: account,
    name: trimmed,
    type: current.type,
    section: current.section,
    custom: current.custom ?? false,
    ...(current.archived ? { archived: true } : {}),
    createdAt: new Date().toISOString(),
  };
  upsertRecord(record);
  return fromRecord(record);
}

/**
 * Arkivera ett konto: inga nya konteringar, men historiken står kvar och
 * rapporterna visar kontot så länge det har saldo eller rörelser.
 */
export function archiveAccount(account: number, archived = true): ChartAccount {
  const current = chartAccount(account);
  if (!current) throw new ChartAccountError(`Konto ${account} finns inte i kontoplanen.`);
  const record: ChartAccountRecord = {
    id: `konto-${account}`,
    number: account,
    name: current.name,
    type: current.type,
    section: current.section,
    custom: current.custom ?? false,
    ...(archived ? { archived: true } : {}),
    createdAt: new Date().toISOString(),
  };
  upsertRecord(record);
  return fromRecord(record);
}

/**
 * Säkerställ att ett konto finns i registret. Används av SIE-import, som tar
 * in klientens fullständiga kontoplan med de namn byrån redan använder.
 */
export function ensureAccount(number: number, name: string): ChartAccount {
  const existing = chartAccount(number);
  if (existing) return existing;
  return addCustomAccount({ number, name });
}
