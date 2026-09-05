/**
 * SIE-fixturer byggda i kod (inga binärfiler i repot). PC8-kodning via
 * samma tabell som exporten använder, så svenska tecken testas på riktigt.
 */
import { encodeSieToPc8 } from "../../accounting/sie";

export interface FixtureTrans {
  account: number;
  amount: string;
  objects?: string;
  text?: string;
}

export interface FixtureVer {
  series?: string;
  number?: number | "";
  date: string;
  text: string;
  lines: FixtureTrans[];
}

export interface SieFixtureOptions {
  companyName?: string;
  orgNumber?: string;
  program?: string;
  sieType?: number;
  years?: { index: number; start: string; end: string }[];
  accounts?: Record<number, string>;
  dimensions?: { dim: number; name: string; objects: { code: string; name: string }[] }[];
  ib?: { year: number; account: number; amount: string }[];
  ub?: { year: number; account: number; amount: string }[];
  res?: { year: number; account: number; amount: string }[];
  verifications?: FixtureVer[];
  /** Extra rader (t.ex. okända taggar). */
  extraLines?: string[];
  /** Öppna verifikationsblocket på samma rad som #VER ("#VER … {"). */
  braceOnVerLine?: boolean;
}

const DEFAULT_ACCOUNTS: Record<number, string> = {
  1510: "Kundfordringar",
  1930: "Företagskonto",
  2440: "Leverantörsskulder",
  2611: "Utgående moms 25 %",
  2641: "Ingående moms",
  2081: "Aktiekapital",
  2091: "Balanserad vinst eller förlust",
  3001: "Försäljning 25 %",
  4010: "Material och varor",
  5410: "Förbrukningsinventarier",
  6212: "Telefon och internet",
};

function q(text: string): string {
  return `"${text.replace(/"/g, '\\"')}"`;
}

function d(iso: string): string {
  return iso.replace(/-/g, "");
}

export function sieText(opts: SieFixtureOptions = {}): string {
  const years = opts.years ?? [{ index: 0, start: "2025-01-01", end: "2025-12-31" }];
  const accounts = opts.accounts ?? DEFAULT_ACCOUNTS;
  const lines: string[] = [];
  lines.push("#FLAGGA 0");
  lines.push(`#PROGRAM ${q(opts.program ?? "Testbok")} 3.1`);
  lines.push("#FORMAT PC8");
  lines.push("#GEN 20260115");
  lines.push(`#SIETYP ${opts.sieType ?? 4}`);
  lines.push(`#FNAMN ${q(opts.companyName ?? "Ekvägens El AB")}`);
  lines.push(`#ORGNR ${opts.orgNumber ?? "559123-4567"}`);
  for (const y of years) lines.push(`#RAR ${y.index} ${d(y.start)} ${d(y.end)}`);
  lines.push("#KPTYP EUBAS97");
  for (const [account, name] of Object.entries(accounts)) lines.push(`#KONTO ${account} ${q(name)}`);
  for (const dim of opts.dimensions ?? []) {
    lines.push(`#DIM ${dim.dim} ${q(dim.name)}`);
    for (const o of dim.objects) lines.push(`#OBJEKT ${dim.dim} ${q(o.code)} ${q(o.name)}`);
  }
  for (const b of opts.ib ?? []) lines.push(`#IB ${b.year} ${b.account} ${b.amount}`);
  for (const b of opts.ub ?? []) lines.push(`#UB ${b.year} ${b.account} ${b.amount}`);
  for (const b of opts.res ?? []) lines.push(`#RES ${b.year} ${b.account} ${b.amount}`);
  for (const v of opts.verifications ?? []) {
    const head = `#VER ${q(v.series ?? "A")} ${v.number === "" ? '""' : (v.number ?? "")} ${d(v.date)} ${q(v.text)} ${d(v.date)}`;
    if (opts.braceOnVerLine) {
      lines.push(`${head} {`);
    } else {
      lines.push(head);
      lines.push("{");
    }
    for (const t of v.lines) {
      const objects = t.objects ?? "";
      lines.push(`   #TRANS ${t.account} {${objects}} ${t.amount}${t.text ? ` ${d(v.date)} ${q(t.text)}` : ""}`);
    }
    lines.push("}");
  }
  for (const extra of opts.extraLines ?? []) lines.push(extra);
  return lines.join("\r\n") + "\r\n";
}

/** Standardfixtur: tre verifikationer 2025 med svenska tecken, IB och ett projekt. */
export function standardSieOptions(): SieFixtureOptions {
  return {
    years: [{ index: 0, start: "2025-01-01", end: "2025-12-31" }, { index: -1, start: "2024-01-01", end: "2024-12-31" }],
    ib: [
      { year: 0, account: 1930, amount: "125000.00" },
      { year: 0, account: 2081, amount: "-50000.00" },
      { year: 0, account: 2091, amount: "-75000.00" },
    ],
    dimensions: [{ dim: 6, name: "Projekt", objects: [{ code: "P1", name: "Villa Ekbacken" }] }],
    verifications: [
      {
        number: 1,
        date: "2025-01-15",
        text: "Fakt 1001 Söderberg",
        lines: [
          { account: 1510, amount: "12500.00" },
          { account: 3001, amount: "-10000.00", objects: '6 "P1"' },
          { account: 2611, amount: "-2500.00" },
        ],
      },
      {
        number: 2,
        date: "2025-02-03",
        text: "Inbetalning Söderberg",
        lines: [
          { account: 1930, amount: "12500.00" },
          { account: 1510, amount: "-12500.00" },
        ],
      },
      {
        number: 3,
        date: "2025-03-10",
        text: "Elgrossisten – kabel",
        lines: [
          { account: 4010, amount: "801.33", text: "Kabel 3G1,5" },
          { account: 2641, amount: "200.33" },
          { account: 2440, amount: "-1001.66" },
        ],
      },
    ],
  };
}

export function sieBytesPc8(opts: SieFixtureOptions = standardSieOptions()): Uint8Array {
  return encodeSieToPc8(sieText(opts));
}

export function sieBytesUtf8(opts: SieFixtureOptions = standardSieOptions(), bom = false): Uint8Array {
  const text = sieText({ ...opts }).replace("#FORMAT PC8", "#FORMAT UTF8");
  const body = new TextEncoder().encode(text);
  if (!bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(body, 3);
  return out;
}

/** Stor men rimlig fil: n verifikationer med två rader var. */
export function largeSieOptions(n: number): SieFixtureOptions {
  const verifications: FixtureVer[] = [];
  for (let i = 1; i <= n; i++) {
    const day = String(1 + (i % 28)).padStart(2, "0");
    const month = String(1 + (i % 12)).padStart(2, "0");
    verifications.push({
      number: i,
      date: `2025-${month}-${day}`,
      text: `Post ${i}`,
      lines: [
        { account: 1930, amount: `${(i % 997) + 1}.${String(i % 100).padStart(2, "0")}` },
        { account: 3001, amount: `-${(i % 997) + 1}.${String(i % 100).padStart(2, "0")}` },
      ],
    });
  }
  return { ...standardSieOptions(), dimensions: [], verifications };
}
