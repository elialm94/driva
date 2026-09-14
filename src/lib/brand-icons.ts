/**
 * Kontroll av att PNG-ikonerna i public/icons/ fortfarande är rastreringar av
 * SVG-källorna i public/brand/.
 *
 * SVG:erna är enda källan till märkets geometri. Koden här ritar inget eget -
 * den läser banan ur filen, rastrerar den i minnet och jämför mot PNG:en på
 * disk. Används av scripts/generate-pwa-icons.ts och brand-icons.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
export const BRAND_DIR = path.join(ROOT, "public", "brand");
export const ICON_DIR = path.join(ROOT, "public", "icons");

/**
 * Vilken SVG varje PNG kommer ur.
 *
 * icon-16 och icon-32 kommer ur favicon.svg, inte ferva-market.svg: i de
 * storlekarna är plattans hörnradie mindre och F:et grövre, annars faller
 * märket isär i flikraden. Rastrera dem aldrig ur ferva-market.svg.
 */
export const ICON_TARGETS: { file: string; size: number; source: string }[] = [
  { file: "icon-192.png", size: 192, source: "ferva-market.svg" },
  { file: "icon-512.png", size: 512, source: "ferva-market.svg" },
  { file: "icon-maskable-512.png", size: 512, source: "ferva-market-square.svg" },
  { file: "apple-touch-icon.png", size: 180, source: "ferva-market-square.svg" },
  { file: "icon-32.png", size: 32, source: "favicon.svg" },
  { file: "icon-16.png", size: 16, source: "favicon.svg" },
];

/**
 * Största tillåtna avvikelse per kanal, och i medeltal över hela bilden.
 *
 * Kantutjämning skiljer sig mellan rastrerare, så jämförelsen sker mot en
 * tolerans. Fel källa, fel storlek, fel färg eller ändrad geometri ger utslag
 * långt över den: en förväxlad källa mäter runt 15 i medelfel och 230 som
 * mest, en godkänd fil under 6 respektive 60.
 */
export const MAX_CHANNEL_DELTA = 96;
export const MAX_MEAN_DELTA = 8;

// ---------------------------------------------------------------- SVG-källan

export interface MarkGeometry {
  viewBox: [number, number];
  /** Hörnradie på plattan. null = ingen platta (genomskinlig bakgrund). */
  plate: { radius: number; fill: [number, number, number] } | null;
  polygon: [number, number][];
  ink: [number, number, number];
  /** Färgen som stod i path-taggen, orörd (kan vara currentColor). */
  inkAttr: string;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Oväntad färg i SVG: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Läser M/L/H/V/Z-banan. Märket består bara av räta linjer. */
export function parsePolygon(d: string): [number, number][] {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? [];
  const points: [number, number][] = [];
  let x = 0;
  let y = 0;
  let cmd = "";
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (/[A-Za-z]/.test(token)) {
      cmd = token;
      if (cmd !== "M" && cmd !== "L" && cmd !== "H" && cmd !== "V" && cmd !== "Z") {
        throw new Error(`Banan använder kommandot ${cmd}, som rastreraren inte kan.`);
      }
      continue;
    }
    const value = Number(token);
    if (cmd === "M" || cmd === "L") {
      x = value;
      y = Number(tokens[++i]);
    } else if (cmd === "H") {
      x = value;
    } else if (cmd === "V") {
      y = value;
    }
    points.push([x, y]);
  }
  return points;
}

export function readMarkSvg(file: string): { source: string; geometry: MarkGeometry; pathData: string } {
  const source = fs.readFileSync(path.join(BRAND_DIR, file), "utf8");
  const viewBox = /viewBox="([^"]+)"/.exec(source)?.[1].trim().split(/\s+/).map(Number);
  if (!viewBox || viewBox.length !== 4) throw new Error(`${file}: viewBox saknas`);
  const rect = /<rect\b[^>]*>/.exec(source)?.[0];
  const pathTag = /<path\b[^>]*>/.exec(source)?.[0];
  if (!pathTag) throw new Error(`${file}: <path> saknas`);
  const d = /\bd="([^"]+)"/.exec(pathTag)?.[1];
  const pathFill = /\bfill="([^"]+)"/.exec(pathTag)?.[1];
  if (!d || !pathFill) throw new Error(`${file}: <path> saknar d eller fill`);
  return {
    source,
    pathData: d,
    geometry: {
      viewBox: [viewBox[2], viewBox[3]],
      plate: rect
        ? {
            radius: Number(/\brx="([\d.]+)"/.exec(rect)?.[1] ?? 0),
            fill: hexToRgb(/\bfill="([^"]+)"/.exec(rect)?.[1] ?? "#000000"),
          }
        : null,
      polygon: parsePolygon(d),
      ink: pathFill.startsWith("#") ? hexToRgb(pathFill) : [0, 0, 0],
      inkAttr: pathFill,
    },
  };
}

// ------------------------------------------------------------- Rastreringen

function insidePolygon(points: [number, number][], px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function insidePlate(px: number, py: number, w: number, h: number, r: number): boolean {
  if (px < 0 || py < 0 || px > w || py > h) return false;
  if (r <= 0) return true;
  const cx = px < r ? r : px > w - r ? w - r : px;
  const cy = py < r ? r : py > h - r ? h - r : py;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

/** Övertäckningssamplad rastrering till RGBA. 8x8 delprov per pixel. */
export function rasterize(geometry: MarkGeometry, size: number): Uint8Array {
  const samples = 8;
  const [vw, vh] = geometry.viewBox;
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let plateHits = 0;
      let inkHits = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const ux = ((x + (sx + 0.5) / samples) / size) * vw;
          const uy = ((y + (sy + 0.5) / samples) / size) * vh;
          if (geometry.plate && insidePlate(ux, uy, vw, vh, geometry.plate.radius)) plateHits++;
          if (insidePolygon(geometry.polygon, ux, uy)) inkHits++;
        }
      }
      const total = samples * samples;
      const plate = plateHits / total;
      const ink = inkHits / total;
      const plateWeight = plate * (1 - ink);
      const weight = plateWeight + ink;
      const base = geometry.plate?.fill ?? [0, 0, 0];
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        out[i + c] = weight ? Math.round((base[c] * plateWeight + geometry.ink[c] * ink) / weight) : 0;
      }
      out[i + 3] = Math.round(Math.max(plate, ink) * 255);
    }
  }
  return out;
}

// ------------------------------------------------------------- PNG-avkodning

export interface DecodedPng {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** Bara bildmåtten, ur IHDR. Billigare än att avkoda hela bilden. */
export function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("Inte en PNG-fil");
  if (buf.toString("ascii", 12, 16) !== "IHDR") throw new Error("IHDR saknas");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function decodePng(buf: Buffer): DecodedPng {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("Inte en PNG-fil");
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error("Interlacade PNG:er stöds inte");
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (depth !== 8) throw new Error(`Bitdjup ${depth} stöds inte`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType as 0 | 2 | 4 | 6];
  if (!channels) throw new Error(`Färgtyp ${colorType} stöds inte`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const planes = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const cur = planes.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? planes.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pred = a + b - c;
        const pa = Math.abs(pred - a);
        const pb = Math.abs(pred - b);
        const pc = Math.abs(pred - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (colorType === 6) {
      rgba.set(planes.subarray(i * 4, i * 4 + 4), i * 4);
    } else if (colorType === 2) {
      rgba.set(planes.subarray(i * 3, i * 3 + 3), i * 4);
      rgba[i * 4 + 3] = 255;
    } else if (colorType === 0) {
      rgba.fill(planes[i], i * 4, i * 4 + 3);
      rgba[i * 4 + 3] = 255;
    } else {
      rgba.fill(planes[i * 2], i * 4, i * 4 + 3);
      rgba[i * 4 + 3] = planes[i * 2 + 1];
    }
  }
  return { width, height, rgba };
}

// -------------------------------------------------------------- Jämförelsen

export interface IconCheck {
  file: string;
  source: string;
  size: number;
  ok: boolean;
  problem?: string;
  meanDelta: number;
  maxDelta: number;
}

/** Lägger bilden mot vitt så att olika sätt att koda genomskinlighet inte räknas som skillnad. */
function overWhite(rgba: Uint8Array, i: number): [number, number, number] {
  const a = rgba[i * 4 + 3] / 255;
  return [
    rgba[i * 4] * a + 255 * (1 - a),
    rgba[i * 4 + 1] * a + 255 * (1 - a),
    rgba[i * 4 + 2] * a + 255 * (1 - a),
  ];
}

/** Mäter hur långt en PNG ligger från en rastrering av en given SVG-källa. */
export function compareIconToSource(file: string, size: number, source: string): IconCheck {
  const base = { file, source, size, meanDelta: 0, maxDelta: 0 };
  const png = path.join(ICON_DIR, file);
  if (!fs.existsSync(png)) return { ...base, ok: false, problem: "filen saknas i public/icons/" };

  const decoded = decodePng(fs.readFileSync(png));
  if (decoded.width !== size || decoded.height !== size) {
    return { ...base, ok: false, problem: `är ${decoded.width}x${decoded.height}, ska vara ${size}x${size}` };
  }

  const reference = rasterize(readMarkSvg(source).geometry, size);
  let sum = 0;
  let max = 0;
  for (let i = 0; i < size * size; i++) {
    const a = overWhite(decoded.rgba, i);
    const b = overWhite(reference, i);
    const delta = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    sum += delta;
    if (delta > max) max = delta;
  }
  const meanDelta = sum / (size * size);
  const problem =
    max > MAX_CHANNEL_DELTA
      ? `avviker som mest ${Math.round(max)} per kanal (tak ${MAX_CHANNEL_DELTA})`
      : meanDelta > MAX_MEAN_DELTA
        ? `avviker i medeltal ${meanDelta.toFixed(2)} (tak ${MAX_MEAN_DELTA})`
        : undefined;
  return { ...base, ok: !problem, problem, meanDelta, maxDelta: max };
}

export function checkIcons(): IconCheck[] {
  return ICON_TARGETS.map((t) => compareIconToSource(t.file, t.size, t.source));
}
