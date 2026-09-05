/**
 * Räkenskapsschemat INK2R: kopplingen mellan kontoplanen och blankettens rutor.
 *
 * Tabellen är BAS-gruppens SRU-koppling för Inkomstdeklaration 2, uttryckt som
 * kontointervall. Den är ingen tolkning: vilket konto som hör till vilken ruta
 * är bestämt av kopplingstabellen, och Driva följer den.
 *
 * Två regler ur Skatteverkets tekniska beskrivning (SKV 269) styr hur beloppen
 * skrivs, och de förklarar varför tabellen ser ut som den gör:
 *
 *   1. "Blankettens tecken gäller och beloppet redovisas som positivt belopp."
 *      En kostnad hamnar alltså i en kostnadsruta som ett positivt tal – rutan
 *      bär minustecknet, inte beloppet.
 *   2. Rutor som kan gå i båda riktningarna finns i par, en ruta per riktning
 *      (lagerförändring, överavskrivningar, periodiseringsfond). Därför bär
 *      raderna här två fältkoder: en för varje håll nettot kan peka.
 */

/** Ett kontointervall, båda ändarna inklusive. */
export type AccountRange = [from: number, to: number];

export interface Ink2rRule {
  ranges: AccountRange[];
  /** Fältkod när nettot ligger på kontonas normala sida. */
  code: string;
  /**
   * Fältkod när nettot ligger på andra sidan. Saknas den skrivs beloppet i
   * `code` med minustecken – blanketten har då bara en rad för posten.
   */
  oppositeCode?: string;
  /** Kontonas normala sida. Avgör vilket håll som är "positivt" i rutan. */
  normal: "debet" | "kredit";
  label: string;
}

/**
 * Balansräkningen. Tillgångar har debetsaldo, eget kapital och skulder
 * kreditsaldo, och båda redovisas som positiva belopp i sina rutor.
 *
 * Rutorna för koncern- och intresseföretag finns med fastän ett litet
 * aktiebolag sällan har dem: ett konto som saknas i tabellen blir en varning i
 * stället för en tyst nolla, och då är det bättre att täcka hela kontoplanen.
 */
export const INK2R_BALANCE: Ink2rRule[] = [
  { code: "7202", label: "Förskott avseende immateriella anläggningstillgångar", normal: "debet", ranges: [[1088, 1088]] },
  { code: "7201", label: "Koncessioner, patent, licenser, varumärken, hyresrätter, goodwill och liknande rättigheter", normal: "debet", ranges: [[1000, 1087], [1089, 1099]] },
  { code: "7216", label: "Förbättringsutgifter på annans fastighet", normal: "debet", ranges: [[1120, 1129]] },
  { code: "7217", label: "Pågående nyanläggningar och förskott avseende materiella anläggningstillgångar", normal: "debet", ranges: [[1180, 1189], [1280, 1289]] },
  { code: "7214", label: "Byggnader och mark", normal: "debet", ranges: [[1100, 1119], [1130, 1179], [1190, 1199]] },
  { code: "7215", label: "Maskiner, inventarier och övriga materiella anläggningstillgångar", normal: "debet", ranges: [[1200, 1279], [1290, 1299]] },
  { code: "7230", label: "Andelar i koncernföretag", normal: "debet", ranges: [[1310, 1319]] },
  { code: "7231", label: "Andelar i intresseföretag och gemensamt styrda företag", normal: "debet", ranges: [[1330, 1339]] },
  { code: "7233", label: "Fordringar hos koncern-, intresse- och gemensamt styrda företag", normal: "debet", ranges: [[1320, 1329], [1340, 1359]] },
  { code: "7234", label: "Ägarintressen i övriga företag", normal: "debet", ranges: [[1360, 1369]] },
  { code: "7235", label: "Andra långfristiga värdepappersinnehav och fordringar", normal: "debet", ranges: [[1300, 1309], [1370, 1399]] },
  { code: "7241", label: "Råvaror och förnödenheter", normal: "debet", ranges: [[1410, 1429]] },
  { code: "7242", label: "Varor under tillverkning", normal: "debet", ranges: [[1440, 1449]] },
  { code: "7243", label: "Färdiga varor och handelsvaror", normal: "debet", ranges: [[1450, 1469]] },
  { code: "7245", label: "Pågående arbeten för annans räkning", normal: "debet", ranges: [[1470, 1479]] },
  { code: "7246", label: "Förskott till leverantörer", normal: "debet", ranges: [[1480, 1489]] },
  { code: "7244", label: "Övriga lagertillgångar", normal: "debet", ranges: [[1400, 1409], [1430, 1439], [1490, 1499]] },
  { code: "7251", label: "Kundfordringar", normal: "debet", ranges: [[1500, 1559], [1580, 1599]] },
  { code: "7262", label: "Upparbetad men ej fakturerad intäkt", normal: "debet", ranges: [[1620, 1629]] },
  { code: "7252", label: "Fordringar hos koncern-, intresse- och gemensamt styrda företag", normal: "debet", ranges: [[1560, 1572], [1574, 1579], [1660, 1672], [1674, 1679]] },
  { code: "7261", label: "Fordringar hos övriga företag som det finns ett ägarintresse i och övriga fordringar", normal: "debet", ranges: [[1573, 1573], [1600, 1619], [1630, 1659], [1673, 1673], [1680, 1699]] },
  { code: "7263", label: "Förutbetalda kostnader och upplupna intäkter", normal: "debet", ranges: [[1700, 1799]] },
  { code: "7270", label: "Andelar i koncernföretag", normal: "debet", ranges: [[1860, 1869]] },
  { code: "7271", label: "Övriga kortfristiga placeringar", normal: "debet", ranges: [[1800, 1859], [1870, 1899]] },
  { code: "7281", label: "Kassa, bank och redovisningsmedel", normal: "debet", ranges: [[1900, 1999]] },

  { code: "7301", label: "Bundet eget kapital", normal: "kredit", ranges: [[2080, 2089]] },
  { code: "7302", label: "Fritt eget kapital", normal: "kredit", ranges: [[2090, 2099]] },
  { code: "7321", label: "Periodiseringsfonder", normal: "kredit", ranges: [[2110, 2139]] },
  { code: "7322", label: "Ackumulerade överavskrivningar", normal: "kredit", ranges: [[2150, 2159]] },
  { code: "7323", label: "Övriga obeskattade reserver", normal: "kredit", ranges: [[2140, 2149], [2160, 2199]] },
  { code: "7331", label: "Avsättningar för pensioner och liknande förpliktelser", normal: "kredit", ranges: [[2210, 2219]] },
  { code: "7332", label: "Övriga avsättningar för pensioner och liknande förpliktelser", normal: "kredit", ranges: [[2230, 2239]] },
  { code: "7333", label: "Övriga avsättningar", normal: "kredit", ranges: [[2200, 2209], [2220, 2229], [2240, 2299]] },
  { code: "7350", label: "Obligationslån", normal: "kredit", ranges: [[2310, 2329]] },
  { code: "7351", label: "Checkräkningskredit", normal: "kredit", ranges: [[2330, 2339]] },
  { code: "7352", label: "Övriga skulder till kreditinstitut", normal: "kredit", ranges: [[2340, 2359]] },
  { code: "7353", label: "Skulder till koncern-, intresse- och gemensamt styrda företag", normal: "kredit", ranges: [[2360, 2372], [2374, 2379]] },
  { code: "7354", label: "Övriga skulder till företag med ägarintresse och övriga skulder", normal: "kredit", ranges: [[2300, 2309], [2373, 2373], [2380, 2399]] },
  { code: "7360", label: "Checkräkningskredit", normal: "kredit", ranges: [[2480, 2489]] },
  { code: "7361", label: "Övriga skulder till kreditinstitut", normal: "kredit", ranges: [[2410, 2419]] },
  { code: "7362", label: "Förskott från kunder", normal: "kredit", ranges: [[2420, 2429]] },
  { code: "7363", label: "Pågående arbeten för annans räkning", normal: "kredit", ranges: [[2430, 2439]] },
  { code: "7364", label: "Fakturerad men ej upparbetad intäkt", normal: "kredit", ranges: [[2450, 2459]] },
  { code: "7365", label: "Leverantörsskulder", normal: "kredit", ranges: [[2440, 2449]] },
  { code: "7366", label: "Växelskulder", normal: "kredit", ranges: [[2492, 2492]] },
  { code: "7367", label: "Skulder till koncern-, intresse- och gemensamt styrda företag", normal: "kredit", ranges: [[2460, 2472], [2474, 2479], [2860, 2872], [2874, 2879]] },
  { code: "7368", label: "Skatteskulder", normal: "kredit", ranges: [[2500, 2599]] },
  { code: "7369", label: "Skulder till övriga företag som det finns ett ägarintresse i och övriga skulder", normal: "kredit", ranges: [[2400, 2409], [2473, 2473], [2490, 2491], [2493, 2499], [2600, 2799], [2800, 2859], [2873, 2873], [2880, 2899]] },
  { code: "7370", label: "Upplupna kostnader och förutbetalda intäkter", normal: "kredit", ranges: [[2900, 2999]] },
];

/**
 * Resultaträkningen. Intäktsrutor har fältkod 74xx, kostnadsrutor 75xx, och
 * det är rutan som bär tecknet: en kostnad skrivs som ett positivt belopp i en
 * 75xx-ruta.
 *
 * Årets resultat (899x) saknas här med flit. Det räknas ur resultaträkningen i
 * sru.ts – bokslutets omföring till 8999 skulle annars räknas två gånger, och
 * före bokslutet finns den inte alls.
 */
export const INK2R_RESULT: Ink2rRule[] = [
  { code: "7410", label: "Nettoomsättning", normal: "kredit", ranges: [[3000, 3799]] },
  { code: "7412", label: "Aktiverat arbete för egen räkning", normal: "kredit", ranges: [[3800, 3899]] },
  { code: "7413", label: "Övriga rörelseintäkter", normal: "kredit", ranges: [[3900, 3999]] },
  { code: "7511", label: "Råvaror och förnödenheter", normal: "debet", ranges: [[4000, 4799], [4910, 4929]] },
  { code: "7512", label: "Handelsvaror", normal: "debet", ranges: [[4960, 4969], [4980, 4989]] },
  {
    code: "7411",
    oppositeCode: "7510",
    label: "Förändring av lager av produkter i arbete, färdiga varor och pågående arbete för annans räkning",
    normal: "kredit",
    ranges: [[4900, 4909], [4930, 4959], [4970, 4979], [4990, 4999]],
  },
  { code: "7513", label: "Övriga externa kostnader", normal: "debet", ranges: [[5000, 6999]] },
  { code: "7514", label: "Personalkostnader", normal: "debet", ranges: [[7000, 7699]] },
  { code: "7516", label: "Nedskrivningar av omsättningstillgångar utöver normala nedskrivningar", normal: "debet", ranges: [[7740, 7749], [7790, 7799]] },
  { code: "7515", label: "Av- och nedskrivningar av materiella och immateriella anläggningstillgångar", normal: "debet", ranges: [[7700, 7739], [7750, 7789], [7800, 7899]] },
  { code: "7517", label: "Övriga rörelsekostnader", normal: "debet", ranges: [[7900, 7999]] },
  { code: "7521", label: "Nedskrivningar av finansiella anläggningstillgångar och kortfristiga placeringar", normal: "debet", ranges: [[8070, 8079], [8170, 8189], [8270, 8289], [8370, 8389]] },
  { code: "7414", oppositeCode: "7518", label: "Resultat från andelar i koncernföretag", normal: "kredit", ranges: [[8000, 8069], [8080, 8099]] },
  { code: "7416", oppositeCode: "7520", label: "Övriga finansiella intäkter och resultatposter", normal: "kredit", ranges: [[8200, 8269], [8290, 8299]] },
  { code: "7417", label: "Övriga ränteintäkter och liknande resultatposter", normal: "kredit", ranges: [[8300, 8369], [8390, 8399]] },
  { code: "7522", label: "Räntekostnader och liknande resultatposter", normal: "debet", ranges: [[8400, 8499]] },
  { code: "7419", label: "Mottagna koncernbidrag", normal: "kredit", ranges: [[8820, 8829]] },
  { code: "7524", label: "Lämnade koncernbidrag", normal: "debet", ranges: [[8830, 8839]] },
  { code: "7420", oppositeCode: "7525", label: "Återföring av periodiseringsfond", normal: "kredit", ranges: [[8819, 8819]] },
  { code: "7525", oppositeCode: "7420", label: "Avsättning till periodiseringsfond", normal: "debet", ranges: [[8810, 8818]] },
  { code: "7421", oppositeCode: "7526", label: "Förändring av överavskrivningar", normal: "kredit", ranges: [[8850, 8859]] },
  { code: "7527", label: "Övriga bokslutsdispositioner", normal: "debet", ranges: [[8840, 8849]] },
  { code: "7422", oppositeCode: "7527", label: "Övriga bokslutsdispositioner", normal: "kredit", ranges: [[8860, 8899]] },
  { code: "7528", label: "Skatt på årets resultat", normal: "debet", ranges: [[8900, 8989]] },
];

/** Årets resultat: vinst i 7450, förlust i 7550 (rad 3.26 och 3.27). */
export const INK2R_RESULTAT_VINST = "7450";
export const INK2R_RESULTAT_FORLUST = "7550";

/** Kontona bokslutet nollar resultaträkningen mot. Ingår inte i tabellen. */
export const ARETS_RESULTAT_ACCOUNTS: AccountRange = [8990, 8999];

export function ruleForAccount(account: number, rules: Ink2rRule[]): Ink2rRule | undefined {
  return rules.find((rule) => rule.ranges.some(([from, to]) => account >= from && account <= to));
}

export function inRange(account: number, [from, to]: AccountRange): boolean {
  return account >= from && account <= to;
}
