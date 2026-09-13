/**
 * Genererar PWA-ikonerna i public/icons/ utan bildbibliotek: en rundad platta
 * i Fervas bläckfärg med ett enkelt "F"-märke i ljus ton. Placeholder tills
 * riktig varumärkesikon finns (spec §9) – körs med:
 *
 *   npx tsx scripts/generate-pwa-icons.ts
 *
 * Deterministisk: samma indata ger byte-identiska filer, så en omkörning
 * lämnar arbetsträdet rent.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const OUT_DIR = path.join(process.cwd(), "public", "icons");

const INK = [0x1c, 0x1b, 0x18] as const; // text-ink
const CANVAS = [0xf7, 0xf6, 0xf2] as const; // bg-canvas
const ACCENT = [0x15, 0x60, 0x4b] as const; // accent

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, Buffer.from(data)])));
  return Buffer.concat([len, typeBuf, Buffer.from(data), crc]);
}

function encodePng(size: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.subarray(y * size * 4, (y + 1) * size * 4).forEach((v, i) => {
      raw[y * (size * 4 + 1) + 1 + i] = v;
    });
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** Rundad kvadrat: 1 inuti, 0 utanför (utan kantutjämning – ikonen är ändå liten). */
function insideRoundedSquare(x: number, y: number, size: number, inset: number, radius: number): boolean {
  const lo = inset;
  const hi = size - 1 - inset;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const cx = x < lo + radius ? lo + radius : x > hi - radius ? hi - radius : x;
  const cy = y < lo + radius ? lo + radius : y > hi - radius ? hi - radius : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

/** Ett "F" av tre rektanglar i ett normaliserat 0–1-rum. */
function insideF(u: number, v: number): boolean {
  const stem = u >= 0.32 && u <= 0.44 && v >= 0.26 && v <= 0.76;
  const top = u >= 0.32 && u <= 0.7 && v >= 0.26 && v <= 0.37;
  const mid = u >= 0.32 && u <= 0.62 && v >= 0.47 && v <= 0.57;
  return stem || top || mid;
}

function render(size: number, opts: { maskable: boolean; transparent: boolean }): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  // Maskable: hela ytan fylld (safe zone = inre 80 %). Vanlig: plattan får
  // lite luft och transparent hörn.
  const inset = opts.maskable ? 0 : Math.round(size * 0.06);
  const radius = opts.maskable ? 0 : Math.round(size * 0.22);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inPlate = opts.maskable ? true : insideRoundedSquare(x, y, size, inset, radius);
      if (!inPlate) {
        if (opts.transparent) {
          px[i + 3] = 0;
        } else {
          px[i] = CANVAS[0];
          px[i + 1] = CANVAS[1];
          px[i + 2] = CANVAS[2];
          px[i + 3] = 255;
        }
        continue;
      }
      const u = x / (size - 1);
      const v = y / (size - 1);
      const glyph = insideF(u, v);
      // Accentpunkt nere till höger – ger ikonen igenkänning i liten storlek.
      const dot = (u - 0.66) ** 2 + (v - 0.7) ** 2 <= 0.055 ** 2;
      const c = glyph ? CANVAS : dot ? ACCENT : INK;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      px[i + 3] = 255;
    }
  }
  return px;
}

const targets: { file: string; size: number; maskable: boolean; transparent: boolean }[] = [
  { file: "icon-192.png", size: 192, maskable: false, transparent: true },
  { file: "icon-512.png", size: 512, maskable: false, transparent: true },
  { file: "icon-maskable-512.png", size: 512, maskable: true, transparent: false },
  { file: "apple-touch-icon.png", size: 180, maskable: true, transparent: false },
];

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const t of targets) {
  const png = encodePng(t.size, render(t.size, t));
  fs.writeFileSync(path.join(OUT_DIR, t.file), png);
  console.log(`${t.file} ${png.length} bytes`);
}
