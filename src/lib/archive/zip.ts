import { deflateRawSync } from "node:zlib";

/**
 * En minimal zip-skrivare.
 *
 * Arkivet ska kunna öppnas av Utforskaren, Finder och Skatteverkets granskare
 * om tio år, och då är formatet viktigare än biblioteket. Zip är det formatet:
 * det läses överallt utan installation. Att skriva de dryga hundra raderna här
 * är billigare än ett beroende som ska underhållas i sju år, och det håller
 * arkivexporten fri från leverantörsrisk.
 *
 * Begränsningarna är medvetna och räcker för ett räkenskapsårs underlag:
 *
 *   * Inga zip64-fält, alltså max 4 GB per fil och totalt. Ett år med kvitton
 *     ligger flera storleksordningar under det.
 *   * UTF-8-flaggan (bit 11) sätts, så "å" i ett filnamn blir "å" och inte
 *     "Ã¥" – tidigare kodsidor är en modernitet vi kan hoppa över.
 *   * Deflate för text, lagring (inget komprimeringsförsök) för PDF och bild.
 *     En PDF är redan komprimerad; att deflata den igen kostar tid och sparar
 *     ingenting.
 */

export interface ZipEntry {
  /** Sökväg i arkivet, med / som separator. */
  path: string;
  bytes: Buffer;
  /** Filens tidsstämpel i arkivet. Utan värde används tidpunkten för exporten. */
  modified?: Date;
}

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
}

export function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Redan komprimerade format lagras som de är. */
function worthDeflating(path: string): boolean {
  return !/\.(pdf|png|jpe?g|webp|heic|gif|zip)$/i.test(path);
}

/** MS-DOS-tid: zip ärvde den från 1980, och den har tvåsekunders upplösning. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Zip-sökväg: alltid /, aldrig .. eller inledande separator. */
export function safeZipPath(path: string): string {
  return path
    .split("/")
    .map((part) => part.replace(/[\\:*?"<>|]/g, "-").replace(/^\.+$/, "").trim())
    .filter((part) => part.length > 0)
    .join("/");
}

export function buildZip(entries: ZipEntry[], now = new Date()): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const seen = new Set<string>();

  for (const entry of entries) {
    const path = uniquePath(safeZipPath(entry.path), seen);
    const name = Buffer.from(path, "utf8");
    const stored = worthDeflating(path) ? deflateRawSync(entry.bytes) : entry.bytes;
    // Deflate kan bli större än originalet för små eller redan täta filer.
    const deflated = stored.length < entry.bytes.length;
    const body = deflated ? stored : entry.bytes;
    const { time, date } = dosDateTime(entry.modified ?? now);
    const crc = crc32(entry.bytes);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version som behövs: 2.0 (deflate)
    local.writeUInt16LE(0x0800, 6); // UTF-8-namn
    local.writeUInt16LE(deflated ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, body);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // skriven av version 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(deflated ? 8 : 0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + body.length;
  }

  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, ...centrals, end]);
}

/**
 * Två underlag kan heta samma sak. I ett arkiv är det en tystad fil, så namnet
 * får ett löpnummer i stället: kvitto.pdf, kvitto (2).pdf.
 */
function uniquePath(path: string, seen: Set<string>): string {
  if (!seen.has(path)) {
    seen.add(path);
    return path;
  }
  const dot = path.lastIndexOf(".");
  const stem = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!seen.has(candidate)) {
      seen.add(candidate);
      return candidate;
    }
  }
}
