/**
 * Minimal ZIP-läsare (lokala filhuvuden + central katalog) för prisfiler och
 * XLSX. Stöder lagring (0) och deflate (8) via Node:s zlib.
 *
 * Skydd mot ZIP-bomber och fientliga arkiv:
 *   * tak på antal poster, uppackad totalstorlek och kompressionsgrad
 *   * uppackad storlek kontrolleras mot den deklarerade (aldrig obegränsad
 *     inflate)
 *   * filnamn med ".." eller absoluta sökvägar avvisas
 *   * nästlade arkiv packas inte upp
 */
import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  /** Offset till lokala filhuvudet. */
  localHeaderOffset: number;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

export const ZIP_LIMITS = {
  maxEntries: 500,
  maxTotalUncompressedBytes: 80 * 1024 * 1024,
  maxEntryUncompressedBytes: 60 * 1024 * 1024,
  /** Uppackad/komprimerad – textfiler komprimeras sällan över ~30×. */
  maxCompressionRatio: 200,
} as const;

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

export function isZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === SIG_LOCAL;
}

function safeEntryName(name: string): boolean {
  if (!name || name.length > 512) return false;
  if (name.includes("\0")) return false;
  const normalized = name.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return false;
  return !normalized.split("/").some((part) => part === "..");
}

/** Läs den centrala katalogen. Kastar ZipError vid trasigt eller fientligt arkiv. */
export function listZipEntries(buffer: Buffer): ZipEntry[] {
  if (buffer.length < 22) throw new ZipError("Filen är för liten för att vara ett ZIP-arkiv.");
  // EOCD ligger sist; kommentaren kan vara upp till 65535 byte.
  const minEocd = Math.max(0, buffer.length - 22 - 65_535);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= minEocd; i--) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("ZIP-arkivet saknar slutkatalog och kan inte läsas.");
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount > ZIP_LIMITS.maxEntries) {
    throw new ZipError(`ZIP-arkivet innehåller för många filer (max ${ZIP_LIMITS.maxEntries}).`);
  }
  if (centralOffset + centralSize > buffer.length) throw new ZipError("ZIP-arkivets katalog pekar utanför filen.");

  const entries: ZipEntry[] = [];
  let p = centralOffset;
  let total = 0;
  for (let k = 0; k < entryCount; k++) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new ZipError("ZIP-arkivets katalog är skadad.");
    }
    const method = buffer.readUInt16LE(p + 10);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const uncompressedSize = buffer.readUInt32LE(p + 24);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localHeaderOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString("utf8", p + 46, p + 46 + nameLen);
    if (!safeEntryName(name)) throw new ZipError(`ZIP-arkivet innehåller ett otillåtet filnamn (${name.slice(0, 40)}).`);
    if (uncompressedSize > ZIP_LIMITS.maxEntryUncompressedBytes) {
      throw new ZipError("En fil i ZIP-arkivet är för stor för att packas upp.");
    }
    total += uncompressedSize;
    if (total > ZIP_LIMITS.maxTotalUncompressedBytes) {
      throw new ZipError("ZIP-arkivet blir för stort uppackat.");
    }
    if (compressedSize > 0 && uncompressedSize / compressedSize > ZIP_LIMITS.maxCompressionRatio) {
      throw new ZipError("ZIP-arkivet har en misstänkt hög kompressionsgrad och avvisas.");
    }
    entries.push({ name, compressedSize, uncompressedSize, method, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Packa upp en post. Uppackad storlek verifieras mot den deklarerade. */
export function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const p = entry.localHeaderOffset;
  if (p + 30 > buffer.length || buffer.readUInt32LE(p) !== SIG_LOCAL) {
    throw new ZipError("ZIP-posten är skadad.");
  }
  const nameLen = buffer.readUInt16LE(p + 26);
  const extraLen = buffer.readUInt16LE(p + 28);
  const dataStart = p + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) throw new ZipError("ZIP-posten pekar utanför filen.");
  const compressed = buffer.subarray(dataStart, dataEnd);

  let out: Buffer;
  if (entry.method === 0) {
    out = Buffer.from(compressed);
  } else if (entry.method === 8) {
    try {
      out = inflateRawSync(compressed, { maxOutputLength: ZIP_LIMITS.maxEntryUncompressedBytes + 1 });
    } catch {
      throw new ZipError("En fil i ZIP-arkivet kunde inte packas upp.");
    }
  } else {
    throw new ZipError("ZIP-arkivet använder en komprimering som inte stöds.");
  }
  if (out.length > ZIP_LIMITS.maxEntryUncompressedBytes) {
    throw new ZipError("En fil i ZIP-arkivet är för stor för att packas upp.");
  }
  // Deklarerad storlek 0 förekommer med data descriptors – då gäller den faktiska.
  if (entry.uncompressedSize > 0 && out.length !== entry.uncompressedSize) {
    throw new ZipError("ZIP-postens storlek stämmer inte med arkivets uppgifter.");
  }
  return out;
}

export function zipEntryByName(entries: ZipEntry[], name: string): ZipEntry | undefined {
  const wanted = name.toLowerCase();
  return entries.find((e) => e.name.toLowerCase() === wanted);
}
