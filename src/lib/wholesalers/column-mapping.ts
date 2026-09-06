/**
 * Automatisk kolumnmappning för prisfiler + svenska fältnamn för UI:t.
 *
 * Grossisternas filer skiljer sig – rubrikerna matchas mot synonymlistor
 * (svenska/engelska), och kolumner utan begriplig rubrik gissas försiktigt
 * ur innehållet (GTIN-kontrollsiffra, decimalpriser, långa texter). Allt som
 * gissas kan användaren ändra i förhandsgranskningen; mappningen sparas på
 * anslutningen och föreslås nästa gång. Klientsäker.
 */
import type { WholesalerColumnKey, WholesalerColumnMapping } from "../types";
import { cell, positionalHeader, type RawTable } from "./table";
import { parseDecimal } from "./money";

export const COLUMN_KEYS: WholesalerColumnKey[] = [
  "articleNumber",
  "name",
  "eNumber",
  "rskNumber",
  "gtin",
  "category",
  "discountGroup",
  "unit",
  "packSize",
  "listPrice",
  "discountPercent",
  "netPrice",
  "salesPrice",
];

/** Enkla svenska namn – aldrig tekniska termer i UI:t. */
export const COLUMN_LABELS: Record<WholesalerColumnKey, string> = {
  articleNumber: "Artikelnummer",
  name: "Benämning",
  eNumber: "E-nummer",
  rskNumber: "RSK-nummer",
  gtin: "EAN/GTIN",
  category: "Kategori",
  discountGroup: "Rabattgrupp",
  unit: "Enhet",
  packSize: "Förpackning (antal)",
  listPrice: "Listpris",
  discountPercent: "Rabatt (%)",
  netPrice: "Ditt inköpspris (netto)",
  salesPrice: "Utpris från grossisten",
};

export const COLUMN_HINTS: Partial<Record<WholesalerColumnKey, string>> = {
  articleNumber: "Grossistens eget artikelnummer – krävs för att kunna beställa.",
  netPrice: "Ert avtalade pris exkl. moms. Vinner alltid över listpris × rabatt.",
  discountPercent: "Rabatt i procent på listpriset, per rad eller per rabattgrupp.",
  salesPrice: "Rekommenderat eller avtalat pris mot din kund. Används bara om du valt det i inställningarna.",
};

type Synonyms = { exact: string[]; contains?: string[] };

const SYNONYMS: Record<WholesalerColumnKey, Synonyms> = {
  articleNumber: {
    exact: [
      "artikelnummer", "artnr", "artikelnr", "artikel", "artikelkod", "artikelid", "produktnummer", "produktnr",
      "produktkod", "levartnr", "leverantorensartikelnummer", "grossistensartikelnummer", "item", "itemnumber",
      "itemno", "itemid", "sku", "partnumber", "partno", "article", "articlenumber", "articleno", "productnumber",
      "productid", "product", "nummer", "artikelnrgrossist", "grossistartnr",
    ],
    contains: ["artikelnr", "artikelnummer", "artnr", "articleno", "itemno", "produktnr"],
  },
  name: {
    exact: [
      "benamning", "artikelbenamning", "artikelnamn", "namn", "beskrivning", "description", "name", "text",
      "produktnamn", "titel", "artikeltext", "varubeskrivning", "varutext", "benamning1", "itemname", "productname",
    ],
    contains: ["benamning", "beskrivning", "description", "artikelnamn", "produktnamn"],
  },
  eNumber: {
    exact: ["enummer", "enr", "elnummer", "elnr", "enumber", "eno", "e"],
    contains: ["enummer", "elnummer", "enumber"],
  },
  rskNumber: {
    exact: ["rsk", "rsknummer", "rsknr", "rskno", "rsknumber"],
    contains: ["rsk"],
  },
  gtin: {
    exact: ["gtin", "ean", "eankod", "streckkod", "barcode", "ean13", "gtin13", "eannummer", "eannr"],
    contains: ["gtin", "ean", "streckkod", "barcode"],
  },
  category: {
    exact: ["kategori", "varugrupp", "produktgrupp", "grupp", "category", "productgroup", "huvudgrupp", "sortiment", "kategorinamn"],
    contains: ["kategori", "varugrupp", "produktgrupp", "category"],
  },
  discountGroup: {
    exact: ["rabattgrupp", "rabattkod", "rabgrp", "rabgr", "rabattklass", "discountgroup", "rabattgruppkod", "prisgrupp", "rabattgruppnr"],
    contains: ["rabattgrupp", "rabattkod", "discountgroup", "rabattklass"],
  },
  unit: {
    exact: ["enhet", "enh", "unit", "uom", "saljenhet", "prisenhet", "forpenhet", "enhetskod", "sortenhet"],
    contains: ["enhet"],
  },
  packSize: {
    exact: [
      "forpackning", "forp", "forpackningsstorlek", "forpackningsstl", "antalperforp", "pack", "packsize",
      "forpstorlek", "antalforp", "forpantal", "forpackningsantal", "minstasaljenhet", "packstorlek", "forpstl",
    ],
    contains: ["forpackning", "packsize", "antalperforp", "forpstorlek"],
  },
  listPrice: {
    exact: ["listpris", "bruttopris", "brutto", "listprice", "grundpris", "pris", "price", "listpriskr", "bruttoprisexklmoms", "listprisexklmoms"],
    contains: ["listpris", "bruttopris", "listprice", "grundpris"],
  },
  discountPercent: {
    exact: ["rabatt", "rabattprocent", "rabattsats", "discount", "disc", "rabattiprocent", "rab"],
    contains: ["rabatt", "discount"],
  },
  netPrice: {
    exact: [
      "nettopris", "netto", "dittpris", "inkopspris", "inkpris", "inkop", "netprice", "yourprice", "avtalspris",
      "nettoprisexklmoms", "kundpris", "ertpris", "nettoprisexkl", "nettobelopp", "eget pris", "egetpris",
    ],
    contains: ["nettopris", "inkopspris", "netprice", "avtalspris", "dittpris", "ertpris"],
  },
  salesPrice: {
    exact: [
      "utpris", "rekutpris", "rekommenderatpris", "rekpris", "cirkapris", "capris", "riktpris", "konsumentpris",
      "forsaljningspris", "salesprice", "retailprice", "rrp", "msrp", "rekutprisexklmoms", "utprisexklmoms",
    ],
    contains: ["utpris", "rekommenderat", "riktpris", "konsumentpris", "retailprice", "salesprice", "cirkapris"],
  },
};

/** Rubrik → jämförbar nyckel: små bokstäver, å/ä→a, ö→o, bara a–z0–9. */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .replace(/[^a-z0-9]/g, "");
}

export type MappingConfidence = "high" | "medium" | "low";

export interface DetectedMapping {
  mapping: WholesalerColumnMapping;
  confidence: Partial<Record<WholesalerColumnKey, MappingConfidence>>;
}

/** Kolumnindex för en mappningsreferens (rubrik eller "#N"). -1 = saknas. */
export function columnIndexFor(table: RawTable, ref: string | undefined): number {
  if (!ref) return -1;
  const positional = /^#(\d+)$/.exec(ref);
  if (positional) {
    const idx = Number(positional[1]) - 1;
    return idx >= 0 && idx < table.headers.length ? idx : -1;
  }
  const exact = table.headers.indexOf(ref);
  if (exact >= 0) return exact;
  const norm = normalizeHeader(ref);
  return table.headers.findIndex((h) => normalizeHeader(h) === norm);
}

/** Referens att spara för ett kolumnindex – rubriken när den finns, annars "#N". */
export function columnRefFor(table: RawTable, index: number): string {
  const header = table.headers[index];
  if (!table.hasHeaderRow || !header || /^#\d+$/.test(header)) return positionalHeader(index);
  // Dubblettrubriker: positionsreferens är den enda entydiga.
  return table.headers.indexOf(header) === index && table.headers.lastIndexOf(header) === index
    ? header
    : positionalHeader(index);
}

function isGtin(value: string): boolean {
  const digits = value.replace(/\s/g, "");
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  let sum = 0;
  const body = digits.slice(0, -1);
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i]);
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

function sampleColumn(table: RawTable, index: number, max = 60): string[] {
  const out: string[] = [];
  for (const row of table.rows) {
    const v = cell(row, index);
    if (v) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function ratio(values: string[], pred: (v: string) => boolean): number {
  if (values.length === 0) return 0;
  return values.filter(pred).length / values.length;
}

/**
 * Föreslå mappning. Rubriker först (exakt synonym = hög, delträff = medel),
 * därefter innehållsheuristik för kvarvarande kolumner (låg).
 */
export function detectColumnMapping(table: RawTable, remembered?: WholesalerColumnMapping): DetectedMapping {
  const mapping: WholesalerColumnMapping = {};
  const confidence: DetectedMapping["confidence"] = {};
  const used = new Set<number>();

  // 1. Sparad mappning från samma anslutning – gäller om kolumnen finns.
  if (remembered) {
    for (const key of COLUMN_KEYS) {
      const idx = columnIndexFor(table, remembered[key]);
      if (idx >= 0 && !used.has(idx)) {
        mapping[key] = columnRefFor(table, idx);
        confidence[key] = "high";
        used.add(idx);
      }
    }
  }

  if (table.hasHeaderRow) {
    const normalized = table.headers.map(normalizeHeader);
    // 2a. Exakta synonymer.
    for (const key of COLUMN_KEYS) {
      if (mapping[key]) continue;
      const idx = normalized.findIndex((h, i) => !used.has(i) && SYNONYMS[key].exact.includes(h));
      if (idx >= 0) {
        mapping[key] = columnRefFor(table, idx);
        confidence[key] = "high";
        used.add(idx);
      }
    }
    // 2b. Delträffar ("Nettopris exkl moms").
    for (const key of COLUMN_KEYS) {
      if (mapping[key]) continue;
      const needles = SYNONYMS[key].contains ?? [];
      const idx = normalized.findIndex((h, i) => !used.has(i) && needles.some((n) => h.includes(n)));
      if (idx >= 0) {
        mapping[key] = columnRefFor(table, idx);
        confidence[key] = "medium";
        used.add(idx);
      }
    }
  }

  // 3. Innehållsheuristik för det som återstår.
  const remaining = table.headers.map((_, i) => i).filter((i) => !used.has(i));
  const take = (key: WholesalerColumnKey, idx: number) => {
    mapping[key] = columnRefFor(table, idx);
    confidence[key] = "low";
    used.add(idx);
  };
  for (const idx of remaining) {
    if (used.has(idx)) continue;
    const values = sampleColumn(table, idx);
    if (values.length < 3) continue;
    if (!mapping.gtin && ratio(values, isGtin) >= 0.8) {
      take("gtin", idx);
      continue;
    }
    const decimals = ratio(values, (v) => /[,.]\d{1,2}$/.test(v.replace(/\s/g, "")) && parseDecimal(v) != null);
    if (decimals >= 0.6 && !mapping.listPrice && !mapping.netPrice) {
      take("listPrice", idx);
      continue;
    }
    const longText = ratio(values, (v) => v.length >= 8 && /[a-zåäö]/i.test(v) && !/^\d/.test(v));
    if (longText >= 0.7 && !mapping.name) {
      take("name", idx);
      continue;
    }
    const codeLike = ratio(values, (v) => /^[A-Za-z0-9-]{4,20}$/.test(v) && /\d/.test(v));
    if (codeLike >= 0.9 && !mapping.articleNumber) {
      take("articleNumber", idx);
      continue;
    }
  }

  return { mapping, confidence };
}

/** Förklarande text när viktiga fält saknas – aldrig tekniska ord. */
export function mappingProblems(mapping: WholesalerColumnMapping): string[] {
  const problems: string[] = [];
  const hasArticleRegister = Boolean(mapping.articleNumber && mapping.name);
  const hasDiscounts = Boolean(mapping.discountPercent || mapping.discountGroup);
  const hasAnyPrice = Boolean(mapping.netPrice || mapping.listPrice || mapping.salesPrice);
  if (!hasArticleRegister && hasDiscounts && !hasAnyPrice) {
    problems.push("Vi hittade rabatter men saknar artikelregistret. Ladda även upp grossistens artikel- eller prislista.");
    return problems;
  }
  if (!mapping.articleNumber) problems.push("Välj vilken kolumn som är grossistens artikelnummer.");
  if (!mapping.name) problems.push("Välj vilken kolumn som är artikelns benämning.");
  if (!hasAnyPrice && !hasDiscounts) {
    problems.push("Filen saknar priser. Välj en kolumn för nettopris eller listpris, eller ladda upp en prislista.");
  }
  return problems;
}
