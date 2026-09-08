/**
 * Katalog över vad en banktransaktion kan vara när den varken är en kund-
 * betalning, en leverantörsbetalning eller ett kortköp med kvitto: bankavgift,
 * inbetalning till skattekontot, amortering, lön (redan bokförd av löne-
 * körningen), ägarens insättning, ränta …
 *
 * Ren data utan beroenden på lagret – används av både serverkoden (bokföring,
 * förslag) och klienten (väljaren i bankvyn). Konteringen är deterministisk
 * BAS-kontering per typ; beloppet kommer alltid från banken.
 */

export type BankDirection = "in" | "ut";

export type BankKindKey =
  /* ---------- utgående ---------- */
  | "kortkop"
  | "skattekonto"
  | "bankavgift"
  | "ranta"
  | "amortering"
  | "forsakring"
  | "utdelning"
  | "aterbetalning_agare"
  | "overforing_eget_konto"
  | "lon"
  /* ---------- inkommande ---------- */
  | "kundbetalning"
  | "agartillskott"
  | "lan_utbetalt"
  | "ranteintakt"
  | "skatteaterbetalning"
  | "ovrig_intakt"
  /* ---------- båda ---------- */
  | "redan_bokford"
  | "annat";

export interface BankKindEntry {
  account: number;
  debit?: number;
  credit?: number;
}

export interface BankKind {
  key: BankKindKey;
  /** Kort etikett i väljaren och på verifikationen: "Bankavgift". */
  label: string;
  /** En rad som förklarar när typen passar. */
  hint: string;
  direction: BankDirection | "bada";
  /**
   * Konteringen för beloppet (alltid positivt). Saknas den bokförs typen på
   * en annan väg: kortköp → utgift som saknar kvitto, kundbetalning → matcha
   * faktura, redan bokförd → koppla befintlig verifikation, lön → lönekörningen.
   */
  entries?: (amount: number) => BankKindEntry[];
  /** Klarspråk på verifikationen – varför konteringen ser ut som den gör. */
  explanation?: (amount: number, counterpart: string) => string;
  /** Beskrivning/motpart som ser ut som typen ger ett förslag innan någon regel finns. */
  pattern?: RegExp;
  /** Går att spara som motpartsregel ("bokför alltid SEB som Bankavgift"). */
  learnable: boolean;
  /** Vart raden pekar när typen inte bokförs här (lön, annat). */
  href?: string;
  matchedType: "utgift" | "skatt" | "ovrigt";
}

const FORETAGSKONTO = 1930;

export const BANK_KINDS: BankKind[] = [
  /* ------------------------------ Utgående ------------------------------ */
  {
    key: "kortkop",
    label: "Köp med kort",
    hint: "Ett vanligt inköp – blir ett köp som väntar på kvitto",
    direction: "ut",
    learnable: true,
    matchedType: "utgift",
  },
  {
    key: "skattekonto",
    label: "Inbetalning till skattekontot",
    hint: "Moms, F-skatt och arbetsgivaravgifter som betalas in till Skatteverket",
    direction: "ut",
    entries: (amount) => [
      { account: 1630, debit: amount },
      { account: FORETAGSKONTO, credit: amount },
    ],
    explanation: (amount) =>
      `${amount} kr fördes från företagskontot till skattekontot. Pengarna är kvar i bolaget – de står bara hos Skatteverket.`,
    pattern: /skatteverk|skattekonto|\bskv\b/i,
    learnable: true,
    matchedType: "skatt",
  },
  {
    key: "lon",
    label: "Löneutbetalning",
    hint: "Lönen bokförs av lönekörningen – kör lönen så matchas utbetalningen hit",
    direction: "ut",
    pattern: /\blön\b|\blon\b|\bsalary\b|nettolön|nettolon|löneutbetalning|loneutbetalning/i,
    learnable: false,
    href: "/bokforing/lon",
    matchedType: "ovrigt",
  },
  {
    key: "bankavgift",
    label: "Bankavgift",
    hint: "Månadsavgift, kortavgift, aviavgift – momsfritt",
    direction: "ut",
    entries: (amount) => [
      { account: 6570, debit: amount },
      { account: FORETAGSKONTO, credit: amount },
    ],
    explanation: (amount, counterpart) =>
      `Bankens avgift ${amount} kr från ${counterpart} bokfördes som bankkostnad (6570). Bankavgifter är momsfria, så hela beloppet är kostnad.`,
    pattern: /bankavgift|månadsavgift|manadsavgift|kortavgift|aviavgift|årsavgift|arsavgift|serviceavgift|företagspaket|foretagspaket|prisplan|avgift internetbank|bg-avgift|swish företag/i,
    learnable: true,
    matchedType: "ovrigt",
  },
  {
    key: "ranta",
    label: "Ränta på lån",
    hint: "Räntekostnad för företagslån eller kredit – momsfritt",
    direction: "ut",
    entries: (amount) => [
      { account: 8410, debit: amount },
      { account: FORETAGSKONTO, credit: amount },
    ],
    explanation: (amount, counterpart) =>
      `Räntan ${amount} kr till ${counterpart} bokfördes som räntekostnad (8410). Ränta är momsfri.`,
    pattern: /\bränta\b|\branta\b|räntekostnad|rantekostnad|\bränte/i,
    learnable: true,
    matchedType: "ovrigt",
  },
  {
    key: "amortering",
    label: "Amortering på lån",
    hint: "Avbetalning på företagslån – minskar skulden, ingen kostnad",
    direction: "ut",
    entries: (amount) => [
      { account: 2350, debit: amount },
      { account: FORETAGSKONTO, credit: amount },
    ],
    explanation: (amount, counterpart) =>
      `Amorteringen ${amount} kr till ${counterpart} minskar låneskulden (2350). Det är ingen kostnad – bara pengar som byter plats i balansräkningen.`,
    pattern: /amortering|avbetalning lån|avbetalning lan/i,
    learnable: true,
    matchedType: "ovrigt",
  },
  {
    key: "forsakring",
    label: "Företagsförsäkring",
    hint: "Försäkringspremie via autogiro – momsfritt",
    direction: "ut",
    entries: (amount) => [
      { account: 6310, debit: amount },
      { account: FORETAGSKONTO, credit: amount },
    ],
    explanation: (amount, counterpart) =>
      `Försäkringspremien ${amount} kr till ${counterpart} bokfördes som företagsförsäkring (6310). Försäkringar är momsfria.`,
    pattern: /försäkring|forsakring|trygg-hansa|trygg hansa|länsförsäkringar|lansforsakringar|folksam|\bif\s+skade|gjensidige|moderna försäkringar|dina försäkringar/i,
    learnable: true,
    matchedType: "ovrigt",
  },
  {
    key: "utdelning",
    label: "Utbetald utdelning",
    hint: "Utdelning som stämman beslutat och som nu betalas ut till ägaren",
    direction: "ut",
    entries: (amount) => [
      { account: 2898, debit: amount },
      { account: FORETAGSKONTO, credit: amount },
    ],
    explanation: (amount) =>
      `Utdelningen ${amount} kr betalades ut och skulden för beslutad utdelning (2898) bockades av. Själva beslutet bokförs vid stämman.`,
    pattern: /utdelning/i,
    learnable: false,
    matchedType: "ovrigt",
  },
  {
    key: "aterbetalning_agare",
    label: "Återbetalning till ägaren",
    hint: "Ägaren får tillbaka egna utlägg eller pengar hen lånat in",
    direction: "ut",
    entries: (amount) => [
      { account: 2893, debit: amount },
      { account: FORETAGSKONTO, credit: amount },
    ],
    explanation: (amount, counterpart) =>
      `${amount} kr betalades tillbaka till ${counterpart} och minskade skulden till ägaren (2893). Ingen kostnad – bolaget betalar bara igen vad det lånat.`,
    pattern: /utlägg|utlagg|eget uttag|återbetalning ägare|aterbetalning agare/i,
    learnable: true,
    matchedType: "ovrigt",
  },
  {
    // Sist bland de utgående: "överföring" står ofta i beskrivningen även för
    // lön, utlägg och utdelning – de mer specifika mönstren ovan vinner.
    key: "overforing_eget_konto",
    label: "Överföring till eget konto",
    hint: "Till sparkonto eller annat konto i bolaget – pengarna är kvar",
    direction: "ut",
    entries: (amount) => [
      { account: 1940, debit: amount },
      { account: FORETAGSKONTO, credit: amount },
    ],
    explanation: (amount) =>
      `${amount} kr flyttades från företagskontot till ett annat eget konto (1940). Pengarna är kvar i bolaget.`,
    pattern: /överföring|overforing|sparkonto|placeringskonto|kapitalkonto|till eget konto/i,
    learnable: true,
    matchedType: "ovrigt",
  },

  /* ----------------------------- Inkommande ----------------------------- */
  {
    key: "kundbetalning",
    label: "Kundbetalning",
    hint: "Betalning av en faktura – välj vilken",
    direction: "in",
    learnable: false,
    matchedType: "ovrigt",
  },
  {
    key: "agartillskott",
    label: "Insättning från ägaren",
    hint: "Ägaren lånar in pengar eller täcker utlägg – bokförs som skuld till ägaren",
    direction: "in",
    entries: (amount) => [
      { account: FORETAGSKONTO, debit: amount },
      { account: 2893, credit: amount },
    ],
    explanation: (amount, counterpart) =>
      `${amount} kr sattes in av ${counterpart} och bokfördes som skuld till ägaren (2893). Bolaget kan betala tillbaka pengarna utan skatt.`,
    pattern: /egen insättning|egen insattning|insättning ägare|aktieägartillskott|aktieagartillskott|lån från ägare|lan fran agare/i,
    learnable: true,
    matchedType: "ovrigt",
  },
  {
    key: "lan_utbetalt",
    label: "Nytt lån utbetalt",
    hint: "Banken eller en finansiär betalar ut ett lån till bolaget",
    direction: "in",
    entries: (amount) => [
      { account: FORETAGSKONTO, debit: amount },
      { account: 2350, credit: amount },
    ],
    explanation: (amount, counterpart) =>
      `Lånet ${amount} kr från ${counterpart} betalades ut och bokfördes som skuld till kreditinstitut (2350).`,
    pattern: /utbetalning lån|utbetalning lan|lånelikvid|lanelikvid|företagslån|foretagslan|kredit utbetal/i,
    learnable: true,
    matchedType: "ovrigt",
  },
  {
    key: "ranteintakt",
    label: "Ränteintäkt",
    hint: "Ränta på företagskontot eller sparkontot – momsfritt",
    direction: "in",
    entries: (amount) => [
      { account: FORETAGSKONTO, debit: amount },
      { account: 8310, credit: amount },
    ],
    explanation: (amount, counterpart) =>
      `Räntan ${amount} kr från ${counterpart} bokfördes som ränteintäkt (8310). Ränta är momsfri.`,
    pattern: /\bränta\b|\branta\b|ränteintäkt|ranteintakt|inlåningsränta|kontoränta/i,
    learnable: true,
    matchedType: "ovrigt",
  },
  {
    key: "skatteaterbetalning",
    label: "Utbetalning från skattekontot",
    hint: "Skatteverket betalar ut överskott från skattekontot",
    direction: "in",
    entries: (amount) => [
      { account: FORETAGSKONTO, debit: amount },
      { account: 1630, credit: amount },
    ],
    explanation: (amount) =>
      `${amount} kr betalades ut från skattekontot till företagskontot. Saldot på skattekontot (1630) minskar med samma belopp.`,
    pattern: /skatteverk|skattekonto|\bskv\b/i,
    learnable: true,
    matchedType: "skatt",
  },
  {
    key: "ovrig_intakt",
    label: "Övrig ersättning",
    hint: "Försäkringsersättning, återbäring eller annan ersättning utan moms",
    direction: "in",
    entries: (amount) => [
      { account: FORETAGSKONTO, debit: amount },
      { account: 3990, credit: amount },
    ],
    explanation: (amount, counterpart) =>
      `${amount} kr från ${counterpart} bokfördes som övrig ersättning (3990) utan moms.`,
    pattern: /försäkringsersättning|forsakringsersattning|skadeersättning|återbäring|aterbaring|bonus/i,
    learnable: true,
    matchedType: "ovrigt",
  },

  /* -------------------------------- Båda -------------------------------- */
  {
    key: "redan_bokford",
    label: "Redan bokförd",
    hint: "Händelsen finns redan i bokföringen – koppla transaktionen till verifikationen",
    direction: "bada",
    learnable: true,
    matchedType: "ovrigt",
  },
  {
    key: "annat",
    label: "Något annat",
    hint: "Bokför med egen kontering under Bokföring › Verifikationer",
    direction: "bada",
    learnable: false,
    href: "/bokforing/verifikationer",
    matchedType: "ovrigt",
  },
];

const BY_KEY = new Map(BANK_KINDS.map((k) => [k.key, k]));

export function bankKindByKey(key: string): BankKind | undefined {
  return BY_KEY.get(key as BankKindKey);
}

export function isBankKindKey(value: unknown): value is BankKindKey {
  return typeof value === "string" && BY_KEY.has(value as BankKindKey);
}

export function directionOf(amount: number): BankDirection {
  return amount > 0 ? "in" : "ut";
}

/** Typerna som går att välja för en transaktion i den riktningen, i väljarens ordning. */
export function bankKindsFor(direction: BankDirection): BankKind[] {
  return BANK_KINDS.filter((k) => k.direction === direction || k.direction === "bada");
}

/** Typen har en egen kontering här (inte kortköp/kundbetalning/redan bokförd/lön/annat). */
export function bankKindPostsHere(kind: BankKind): boolean {
  return typeof kind.entries === "function";
}

/**
 * Första typ vars mönster känner igen texten – deterministiskt och i katalog-
 * ordning. Skattekonto/skatteåterbetalning delar mönster men skiljs på riktning.
 */
export function bankKindByPattern(input: {
  amount: number;
  counterpart: string;
  description: string;
  reference?: string;
}): BankKind | null {
  const text = `${input.counterpart} ${input.description} ${input.reference ?? ""}`;
  const direction = directionOf(input.amount);
  for (const kind of bankKindsFor(direction)) {
    if (kind.pattern?.test(text)) return kind;
  }
  return null;
}
