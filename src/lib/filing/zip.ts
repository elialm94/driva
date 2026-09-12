/**
 * Minimal zip-skrivare (lagring utan komprimering) för filpaket: INK2 består
 * av två SRU-filer som Skatteverkets Filöverföring vill ha tillsammans, och
 * ett paket är enklare att hålla ihop än två nedladdningar. Filerna är små
 * (kilobyte), så komprimering skulle bara lägga till ett beroende.
 *
 * Byte-innehållet skrivs exakt som det är – teckenuppsättningen (ISO 8859-1
 * för SRU) förblir generatorernas sak. Filnamnen är ASCII, så ingen UTF-8-
 * flagga behövs. Ren modul utan beroenden.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  filename: string;
  bytes: Uint8Array;
}

/** MS-DOS-tid/datum som zip-formatet kräver (lokal tid, 2 s upplösning). */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  return { time, date };
}

function u16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true);
}

function u32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

export function buildZip(entries: ZipEntry[], now: Date = new Date()): Uint8Array {
  const { time, date } = dosDateTime(now);
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.filename);
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;

    const local = new Uint8Array(30 + name.length + size);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50);
    u16(lv, 4, 20); // version needed: 2.0
    u16(lv, 6, 0); // flags
    u16(lv, 8, 0); // method: store
    u16(lv, 10, time);
    u16(lv, 12, date);
    u32(lv, 14, crc);
    u32(lv, 18, size);
    u32(lv, 22, size);
    u16(lv, 26, name.length);
    u16(lv, 28, 0);
    local.set(name, 30);
    local.set(entry.bytes, 30 + name.length);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    u32(cv, 0, 0x02014b50);
    u16(cv, 4, 20); // version made by
    u16(cv, 6, 20); // version needed
    u16(cv, 8, 0);
    u16(cv, 10, 0);
    u16(cv, 12, time);
    u16(cv, 14, date);
    u32(cv, 16, crc);
    u32(cv, 20, size);
    u32(cv, 24, size);
    u16(cv, 28, name.length);
    u16(cv, 30, 0); // extra
    u16(cv, 32, 0); // comment
    u16(cv, 34, 0); // disk
    u16(cv, 36, 0); // internal attrs
    u32(cv, 38, 0); // external attrs
    u32(cv, 42, offset);
    central.set(name, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 4, 0);
  u16(ev, 6, 0);
  u16(ev, 8, entries.length);
  u16(ev, 10, entries.length);
  u32(ev, 12, centralSize);
  u32(ev, 16, offset);
  u16(ev, 20, 0);

  const out = new Uint8Array(offset + centralSize + 22);
  let pos = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}
