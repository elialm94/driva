/**
 * Produktbilder och kategoriikoner för materialbutiken – klientsäker.
 *
 * Bilder kommer bara från grossistens egen prisfil (kolumn med bildlänk).
 * Ferva hämtar aldrig bilder från nätet själv och behöver ingen ny
 * integration: finns en https-länk visas den som miniatyr, annars får
 * kortet en ikon utifrån kategori/benämning så att butiken ändå går att
 * skanna med ögat.
 */

export const IMAGE_URL_MAX_CHARS = 500;

/**
 * Bara absoluta http(s)-adresser utan blanksteg eller HTML-tecken släpps
 * igenom – allt annat (javascript:, data:, relativa sökvägar, skräp) tas
 * bort tyst så att artikeln importeras utan bild.
 */
export function sanitizeImageUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value || value.length > IMAGE_URL_MAX_CHARS) return undefined;
  if (!/^https?:\/\/[^\s"'<>\\]+$/i.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (!url.hostname.includes(".")) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Ser cellvärdet ut som en bildlänk? (kolumngissning i prisfilen) */
export function looksLikeImageUrl(value: string): boolean {
  return sanitizeImageUrl(value) != null;
}

export type ProductIconKey =
  | "cable"
  | "plug"
  | "switch"
  | "breaker"
  | "light"
  | "conduit"
  | "pipe"
  | "valve"
  | "tap"
  | "drain"
  | "heat"
  | "fasteners"
  | "tools"
  | "safety"
  | "box";

const ICON_RULES: Array<[ProductIconKey, RegExp]> = [
  ["cable", /\b(kabel|ledning|ekk|eqlq|fk\b|rk\b|kabelband|kabelsko|installationskabel|signalkabel|nätverkskabel|natverkskabel)/i],
  ["light", /(armatur|belysning|led|lampa|ljuskälla|ljuskalla|downlight|spotlight|panel|lysrör|lysror|strålkastare|stralkastare)/i],
  ["breaker", /(dvärgbrytare|dvargbrytare|jordfelsbrytare|automat|säkring|sakring|central|normkapsling|kapsling|brytare\b|kontaktor|relä|rela\b)/i],
  ["switch", /(strömställare|stromstallare|dimmer|tryckknapp|vred|timer|termostat|rörelsevakt|rorelsevakt|sensor)/i],
  ["plug", /(uttag|stickpropp|apparatdosa|apparat|ram\b|täcklock|tacklock|stickkontakt|laddbox|laddstation)/i],
  ["conduit", /(flexrör|flexror|vp-rör|vp-ror|kabelkanal|kanal|ränna|ranna|stege|kabelstege|skyddsrör|skyddsror|kanalisation)/i],
  ["tap", /(blandare|dusch|handdusch|takdusch|tvättställ|tvattstall|wc|toalett|badkar|köksblandare|koksblandare|sanitet|porslin)/i],
  ["valve", /(ventil|kulventil|backventil|säkerhetsventil|sakerhetsventil|shunt|fördelare|fordelare|fördelarskåp|fordelarskap|vattenmätare|vattenmatare)/i],
  ["drain", /(avlopp|golvbrunn|vattenlås|vattenlas|böj\b|boj\b|muff|grenrör|grenror|spillvatten|dagvatten|brunn)/i],
  ["heat", /(radiator|element|värme|varme|golvvärme|golvvarme|varmvatten|beredare|pump|cirkulation|expansion|isolering|cellgummi)/i],
  ["pipe", /(rör|ror\b|koppling|press|pex|kopparrör|kopparror|nippel|övergång|overgang|klammer|rörklammer|rorklammer|slang)/i],
  ["fasteners", /(skruv|spik|plugg|bult|mutter|bricka|ankare|fäste|faste|beslag|konsol|infästning|infastning)/i],
  ["safety", /(handske|handskar|skydd|hjälm|hjalm|glasögon|glasogon|mask|väst|vast|skyddsskor|hörsel|horsel)/i],
  ["tools", /(verktyg|borr|bits|blad|kniv|tång|tang|nyckel|mejsel|såg|sag\b|maskin|laser|mätare|matare)/i],
];

/**
 * Ikon för ett artikelkort utan bild. Kategorin väger tyngst (grossistens
 * egen indelning), benämningen därefter. Deterministiskt – samma artikel får
 * alltid samma ikon.
 */
export function productIconKey(product: { category?: string; name: string }): ProductIconKey {
  const category = product.category ?? "";
  for (const [key, rule] of ICON_RULES) if (category && rule.test(category)) return key;
  for (const [key, rule] of ICON_RULES) if (rule.test(product.name)) return key;
  return "box";
}

/** Stabil färgton (0–5) för kategoritiles så att butikens indelning känns igen. */
export function categoryHue(category: string): number {
  let hash = 0;
  for (const ch of category.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 6;
}
