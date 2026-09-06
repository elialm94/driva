/**
 * Testfixtures för prisfilsimporten. Binära format (ZIP/XLSX) byggs i kod
 * så att inga binärfiler behöver checkas in och innehållet kan läsas i
 * klartext här. Formaten är generiska – inga verkliga grossistexporter
 * efterliknas.
 */
import { deflateRawSync } from "node:zlib";

/* ---------------------------------- ZIP ----------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipInput {
  name: string;
  data: Buffer | string;
  /** 0 = lagrad, 8 = deflate (standard). */
  method?: 0 | 8;
}

/** Minimal ZIP-skrivare: lokala huvuden + central katalog + EOCD. */
export function buildZip(files: ZipInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, "utf8");
    const method = file.method ?? 8;
    const packed = method === 8 ? deflateRawSync(data) : data;
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    locals.push(local, packed);
    centrals.push(central);
    offset += local.length + packed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

/* ---------------------------------- XLSX ---------------------------------- */

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function colRef(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Ett kalkylblad med delade strängar för text och inline-tal för nummer.
 * Tal skrivs som tal (så Excel-typiska 1234.5 utan svensk formatering testas).
 */
export function buildXlsx(rows: (string | number)[][]): Buffer {
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();
  const rowXml = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${colRef(c)}${r + 1}`;
          if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
          if (value === "") return "";
          let idx = sharedIndex.get(value);
          if (idx == null) {
            idx = shared.length;
            shared.push(value);
            sharedIndex.set(value, idx);
          }
          return `<c r="${ref}" t="s"><v>${idx}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared
    .map((s) => `<si><t>${xmlEscape(s)}</t></si>`)
    .join("")}</sst>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Prislista" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  return buildZip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRels },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRels },
    { name: "xl/worksheets/sheet1.xml", data: sheet },
    { name: "xl/sharedStrings.xml", data: sst },
  ]);
}

/* -------------------------------- text-filer ------------------------------ */

/** Semikolon, svenska decimaler, rubriker på svenska. */
export const CSV_SEMICOLON = [
  "Artikelnr;Benämning;E-nummer;RSK;Enhet;Förp;Listpris;Nettopris;Rabattgrupp",
  "100200;Kabel EKK 3G1,5 vit;0010012;;m;100;18,90;12,50;K10",
  "100201;Kabel EKK 3G2,5 vit;0010013;;m;100;29,50;;K10",
  "300400;Vägguttag 2-vägs jordat infällt;1780235;;st;1;89,00;61,20;A20",
  "500600;Rörkoppling 15 mm;;8103567;st;10;45,00;30,00;V05",
].join("\r\n");

/** Tabbseparerad TXT utan nettopris – bara listpris + rabattgrupp. */
export const TXT_TAB_LIST_ONLY = [
  "Artnr\tNamn\tE-nr\tEnhet\tListpris\tRabattgrupp",
  "100200\tKabel EKK 3G1,5 vit\t0010012\tm\t18,90\tK10",
  "300400\tVägguttag 2-vägs jordat infällt\t1780235\tst\t89,00\tA20",
  "999999\tArtikel utan pris\t\tst\t\tA20",
].join("\n");

/** Rabattbrev: bara rabattgrupp + procent. */
export const CSV_DISCOUNT_LETTER = ["Rabattgrupp;Rabatt %", "K10;35", "A20;28,5", "V05;20"].join("\n");

/** Generisk XML-export: upprepat <Artikel>-element med barnelement. */
export const XML_PRICE_FILE = `<?xml version="1.0" encoding="UTF-8"?>
<Prislista leverantor="Testgrossisten">
  <Artikel>
    <Artikelnummer>100200</Artikelnummer>
    <Benamning>Kabel EKK 3G1,5 vit</Benamning>
    <Enummer>0010012</Enummer>
    <Enhet>m</Enhet>
    <Listpris>18.90</Listpris>
    <Nettopris>12.50</Nettopris>
  </Artikel>
  <Artikel>
    <Artikelnummer>500600</Artikelnummer>
    <Benamning>Rörkoppling 15 mm</Benamning>
    <RSK>8103567</RSK>
    <Enhet>st</Enhet>
    <Listpris>45.00</Listpris>
    <Nettopris>30.00</Nettopris>
  </Artikel>
</Prislista>`;

/** Excel-rader: rubriker + tal som tal (utan svensk formatering). */
export const XLSX_ROWS: (string | number)[][] = [
  ["Artikelnummer", "Benämning", "E-nummer", "Enhet", "Listpris", "Nettopris"],
  ["100200", "Kabel EKK 3G1,5 vit", "0010012", "m", 18.9, 12.5],
  ["300400", "Vägguttag 2-vägs jordat infällt", "1780235", "st", 89, 61.2],
];

/** CP1252-kodad variant av CSV-filen (å/ä/ö som en byte). */
export function csvAsWindows1252(text: string): Buffer {
  const map: Record<string, number> = { å: 0xe5, ä: 0xe4, ö: 0xf6, Å: 0xc5, Ä: 0xc4, Ö: 0xd6, é: 0xe9 };
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (map[ch] != null) bytes.push(map[ch]);
    else bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}
