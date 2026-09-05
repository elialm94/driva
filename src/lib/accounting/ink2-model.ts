/**
 * INK2:ans begrepp: fältkoderna, satserna och de rena beräkningarna.
 *
 * Utan lagringsberoende, så både skattemotorn och vyerna kan läsa dem.
 * Hämtningen ur bokföringen ligger i tax.ts.
 *
 * Blanketten skiljer på två resultat, och hela poängen med modulen är att hålla
 * dem åtskilda: bokföringen visar ETT resultat (årsredovisningens), skattelagen
 * ger ETT ANNAT. Skillnaden är inte fel i bokföringen utan avsiktliga
 * skillnader mellan god redovisningssed och skattereglerna, och varje skillnad
 * har en egen ruta på INK2S. Rutorna är därför inte en presentationsdetalj –
 * de ÄR modellen, och en justering utan ruta går inte att deklarera.
 */

/* ------------------------------ Fälten på INK2S --------------------------- */

/**
 * De rutor ett litet aktiebolag faktiskt använder. Blanketten har fler
 * (koncernbidrag, andelsförsäljningar, ackord) – de kräver bedömningar som
 * Driva inte gör, och saknas därför här hellre än att fyllas i på en gissning.
 */
export type Ink2Field =
  | "4.1" // Årets resultat, vinst
  | "4.2" // Årets resultat, förlust
  | "4.3a" // Skatt på årets resultat
  | "4.3c" // Andra bokförda kostnader som inte ska dras av
  | "4.5c" // Andra bokförda intäkter som inte ska tas upp
  | "4.6a" // Beräknad schablonintäkt på kvarvarande periodiseringsfonder
  | "4.9" // Skattemässig justering av bokfört resultat för avskrivningar
  | "4.14a" // Outnyttjat underskott från föregående år
  | "4.15" // Överskott
  | "4.16"; // Underskott

export const INK2_FIELD_LABEL: Record<Ink2Field, string> = {
  "4.1": "Årets resultat, vinst",
  "4.2": "Årets resultat, förlust",
  "4.3a": "Skatt på årets resultat",
  "4.3c": "Andra bokförda kostnader som inte ska dras av",
  "4.5c": "Andra bokförda intäkter som inte ska tas upp",
  "4.6a": "Beräknad schablonintäkt på kvarvarande periodiseringsfonder",
  "4.9": "Skattemässig justering av bokfört resultat för avskrivningar",
  "4.14a": "Outnyttjat underskott från föregående år",
  "4.15": "Överskott",
  "4.16": "Underskott",
};

/* ------------------------------- Skattesatser ----------------------------- */

/** Bolagsskatt, 20,6 % sedan beskattningsår som börjar 2021. */
export const BOLAGSSKATT_SATS = 0.206;

/**
 * Statslåneräntan den 30 november, i procent. Räntan sätts av Riksgälden och
 * går inte att räkna fram – den måste stå i en tabell, och ett år som saknas
 * ska stoppa beräkningen i stället för att interpoleras fram.
 *
 * Nyckeln är året räntan sattes. Beskattningsåret använder räntan från den
 * 30 november året närmast före det kalenderår beskattningsåret går ut, så
 * beskattningsår 2026 läser 2025.
 */
export const STATSLANERANTA_30_NOV: Record<number, number> = {
  2018: 0.51,
  2019: -0.09,
  2020: -0.1,
  2021: 0.23,
  2022: 1.94,
  2023: 2.62,
  2024: 1.96,
  2025: 2.55,
};

/**
 * Golvet för statslåneräntan vid schablonintäkt på periodiseringsfond
 * (30 kap. 6 a § IL). Infört när räntan blev negativ: utan golvet hade
 * uppskjuten skatt varit gratis.
 */
export const STATSLANERANTA_GOLV = 0.5;

/**
 * Schablonräntan för ett beskattningsår, i procent. `undefined` när
 * statslåneräntan för året inte finns i tabellen – då vet Driva inte, och ska
 * säga det.
 *
 * Sedan lagändringen 2018:1206 används hela statslåneräntan; tidigare 72 % av
 * den. Driva räknar bara år från och med 2019, så bara den nya regeln finns.
 */
export function schablonranta(taxYear: number): number | undefined {
  const slr = STATSLANERANTA_30_NOV[taxYear - 1];
  if (slr === undefined) return undefined;
  return Math.max(slr, STATSLANERANTA_GOLV);
}

/**
 * Schablonintäkt på periodiseringsfonder: en beräknad ränta på uppskjuten
 * skatt. Underlaget är fonderna vid beskattningsårets INGÅNG – årets egen
 * avsättning räntebeläggs först nästa år.
 *
 * Intäkten bokförs aldrig. Den är ingen affärshändelse, bara ett tillägg i
 * deklarationen, och skulle bokföringen bära den vore årsredovisningen fel.
 */
export function schablonintakt(fundsAtYearStart: number, rate: number, monthsInYear = 12): number {
  if (fundsAtYearStart <= 0 || rate <= 0) return 0;
  const full = (fundsAtYearStart * rate) / 100;
  return Math.round((full * monthsInYear) / 12);
}

/* --------------------- Ej avdragsgilla och skattefria poster --------------- */

export interface AccountTaxRule {
  account: number;
  field: Ink2Field;
  label: string;
  explanation: string;
}

/**
 * Kostnader som är bokförda men inte får dras av. De läggs tillbaka som en
 * pluspost: företaget behåller kostnaden i resultaträkningen men får ingen
 * skattelindring av den.
 *
 * Listan går på konto, inte på bedömning. Ett konto som HETER "ej avdragsgill"
 * är bokförarens eget beslut om posten, och det beslutet är det Driva följer –
 * motorn tolkar aldrig ett kvitto för att avgöra om en lunch var representation.
 */
export const NON_DEDUCTIBLE_ACCOUNTS: AccountTaxRule[] = [
  {
    account: 6072,
    field: "4.3c",
    label: "Representation, ej avdragsgill",
    explanation:
      "Extern representation utöver det avdragsgilla beloppet (t.ex. måltider med kunder) får inte dras av vid inkomstbeskattningen.",
  },
  {
    account: 6982,
    field: "4.3c",
    label: "Föreningsavgifter, ej avdragsgilla",
    explanation:
      "Medlemsavgifter till föreningar är inte avdragsgilla. Serviceavgifter för en motprestation är det – de hör på ett annat konto.",
  },
  {
    account: 6992,
    field: "4.3c",
    label: "Övriga externa kostnader, ej avdragsgilla",
    explanation:
      "Kontot samlar det som bokförts som uttalat ej avdragsgillt: böter, viten, skattetillägg, förseningsavgifter och gåvor.",
  },
  {
    account: 7622,
    field: "4.3c",
    label: "Sjuk- och hälsovård, ej avdragsgill",
    explanation: "Privat sjukvård och sjukvårdsförsäkring är en förmån för den anställde och inte avdragsgill för bolaget.",
  },
  {
    account: 7632,
    field: "4.3c",
    label: "Personalrepresentation, ej avdragsgill",
    explanation: "Personalfester och liknande är avdragsgilla inom ett schablonbelopp; överskjutande del är det inte.",
  },
  {
    account: 8423,
    field: "4.3c",
    label: "Räntekostnader för skatter och avgifter",
    explanation:
      "Kostnadsränta på skattekontot är inte avdragsgill. Det är en följd av att skatten betalats sent, inte en kostnad i verksamheten.",
  },
];

/**
 * Intäkter som är bokförda men inte ska beskattas. De dras bort som en
 * minuspost – annars beskattas något som är skattefritt.
 */
export const TAX_FREE_INCOME_ACCOUNTS: AccountTaxRule[] = [
  {
    account: 8314,
    field: "4.5c",
    label: "Skattefria ränteintäkter",
    explanation:
      "Intäktsränta på skattekontot är skattefri. Den ligger i det bokförda resultatet och måste rensas bort för att inte beskattas.",
  },
];

/** Skatt på årets resultat. Egen ruta (4.3a), inte "andra kostnader". */
export const SKATT_PA_ARETS_RESULTAT = 8910;

/* ---------------------- Skattemässiga avskrivningar ----------------------- */

/**
 * Räkenskapsenlig avskrivning har två regler och bolaget får välja den som ger
 * det lägsta värdet – alltså det största avdraget.
 */
export type DepreciationRule = "huvudregeln" | "kompletteringsregeln";

export const DEPRECIATION_RULE_LABEL: Record<DepreciationRule, string> = {
  huvudregeln: "Huvudregeln (30 %)",
  kompletteringsregeln: "Kompletteringsregeln (20 %)",
};

/** Huvudregeln: lägsta värde är 70 % av underlaget. */
export const HUVUDREGEL_KVAR_ANDEL = 0.7;

/**
 * Kompletteringsregeln: andel av anskaffningsutgiften som får stå kvar, räknat
 * bakåt från årets inköp. Femte året är noll – regeln skriver av en inventarie
 * helt på fem år, vilket är dess hela syfte när huvudregelns 30 % av ett
 * krympande värde aldrig kommer ända ner.
 */
export const KOMPLETTERINGSREGEL_ANDELAR = [0.8, 0.6, 0.4, 0.2, 0];

export interface DepreciationBasis {
  /** Bokfört värde på inventarierna vid årets ingång. */
  openingBookValue: number;
  /**
   * Anskaffningsutgifter per antal år bakåt: index 0 är årets inköp som finns
   * kvar vid årets slut, index 1 föregående års, och så vidare.
   *
   * Fyll alltid alla fem åren. En tom plats betyder "inga inköp det året", och
   * det är ett svar med innebörd: en inventarie som köptes för mer än fem år
   * sedan får skrivas av helt enligt kompletteringsregeln. Skickar man in ett
   * bokfört värde utan sin inköpshistorik ser det ut som just det.
   */
  acquisitionsByYearsBack: number[];
  /** Ersättning för inventarier som sålts och som skaffats tidigare år. */
  proceedsFromEarlierAssets?: number;
}

export interface DepreciationLimits {
  /** Underlaget: vad som finns att skriva av på i år. */
  basis: number;
  lowestValueHuvudregeln: number;
  lowestValueKompletteringsregeln: number;
  /** Den regel som ger störst avdrag. */
  rule: DepreciationRule;
  /** Högsta skattemässiga avskrivning i år. */
  maxDepreciation: number;
}

/**
 * Högsta skattemässiga värdeminskningsavdrag för inventarier.
 *
 * Huvudregeln räknar på ett underlag som krymper varje år, så den kommer aldrig
 * ända ner till noll. Kompletteringsregeln räknar i stället på
 * anskaffningsutgifterna och skriver av helt på fem år. Bolaget väljer fritt
 * det lägsta värdet, alltså det största avdraget – men samma regel måste
 * användas för hela inventariebeståndet.
 */
export function depreciationLimits(basis: DepreciationBasis): DepreciationLimits {
  const acquisitionsThisYear = basis.acquisitionsByYearsBack[0] ?? 0;
  const underlag = Math.max(
    0,
    basis.openingBookValue + acquisitionsThisYear - (basis.proceedsFromEarlierAssets ?? 0)
  );

  const huvudregeln = Math.round(underlag * HUVUDREGEL_KVAR_ANDEL);
  const kompletteringsregeln = Math.round(
    KOMPLETTERINGSREGEL_ANDELAR.reduce(
      (sum, share, yearsBack) => sum + (basis.acquisitionsByYearsBack[yearsBack] ?? 0) * share,
      0
    )
  );

  // Kompletteringsregeln får inte höja värdet över vad som finns att skriva av.
  const lowestKomplettering = Math.min(kompletteringsregeln, underlag);
  const rule: DepreciationRule = lowestKomplettering < huvudregeln ? "kompletteringsregeln" : "huvudregeln";
  const lowest = Math.min(huvudregeln, lowestKomplettering);

  return {
    basis: underlag,
    lowestValueHuvudregeln: huvudregeln,
    lowestValueKompletteringsregeln: lowestKomplettering,
    rule,
    maxDepreciation: Math.max(0, underlag - lowest),
  };
}
