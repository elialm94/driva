/**
 * SIE-import: förhandsgranskning och genomförande mot Fervas bokföringsmodell.
 *
 *  * Filens räkenskapsår (#RAR) blir FiscalYear med IB från #IB och
 *    openingSource "migrering". Verifikationer behåller filens serie + nummer
 *    (källa sie_import) och bokförs med samma invarianter som all annan
 *    bokföring: minst två rader, hela kronor, debet = kredit.
 *  * Ferva bokför i hela kronor. Öresbelopp avrundas per verifikation med
 *    största-rest-metoden så att varje verifikation fortfarande balanserar
 *    exakt – ingen rad ändras mer än ±1 kr och inget konstgjort konto läggs till.
 *  * En verifikation som inte balanserar i FILEN (ören) importeras aldrig –
 *    den listas i förhandsgranskningen och utelämnas.
 *  * År som bara har saldon (#IB/#UB/#RES, inga #VER) importeras som IB +
 *    EN samlad post för årets förändring, tydligt beskriven som just det.
 *  * Konflikter med befintlig bokföring (överlapp, stängt år, år med
 *    verifikationer, nummerkollisioner) får det säkra standardvalet: hoppa
 *    över. Ingenting skrivs över.
 *
 * Funktionerna här är rena mot ett DB-objekt – anroparen (server action /
 * API-route) kör dem i withBusiness så att Supabase-commiten blir atomär.
 */
import type { DB, FiscalYear, Verification, VerificationEntry } from "../types";
import { BAS } from "../bas";
import { uid } from "../ids";
import { isOrgnrFormat, normalizeOrgnr } from "../invoices/formats";
import { logAudit } from "../accounting/audit";
import type { SieFile, SieVerification } from "./sie-parse";

/* --------------------------------- avrundning ------------------------------- */

/**
 * Ören → hela kronor per rad så att summan bevaras exakt (största rest).
 * För en balanserad verifikation (summa 0 ören) blir summan 0 kronor.
 */
export function roundOrePreservingSum(amountsOre: number[]): number[] {
  const exact = amountsOre.map((ore) => ore / 100);
  const base = exact.map((x) => Math.floor(x));
  const target = Math.round(exact.reduce((s, x) => s + x, 0));
  let deficit = target - base.reduce((s, x) => s + x, 0);
  const order = exact
    .map((x, i) => ({ i, remainder: x - Math.floor(x) }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  const out = [...base];
  for (const { i } of order) {
    if (deficit <= 0) break;
    out[i] += 1;
    deficit -= 1;
  }
  return out;
}

/* -------------------------------- räkenskapsår ------------------------------ */

export function fiscalYearLabelFor(startDate: string, endDate: string): string {
  const startYear = startDate.slice(0, 4);
  const endYear = endDate.slice(0, 4);
  if (startDate.endsWith("-01-01") && endDate.endsWith("-12-31") && startYear === endYear) return startYear;
  return startYear === endYear ? `${startYear} (${startDate.slice(5)}–${endDate.slice(5)})` : `${startYear}/${endYear}`;
}

function overlaps(a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/* -------------------------------- förhandsgranskning ------------------------ */

export type SieYearExisting = "none" | "same_year_empty" | "same_year_with_verifications" | "overlap" | "closed";

export interface SieUnbalanced {
  series: string;
  number: number | null;
  date: string;
  text: string;
  /** Summa av raderna i ören (≠ 0). */
  diffOre: number;
}

export interface SieYearPreview {
  index: number;
  startDate: string;
  endDate: string;
  label: string;
  /** Verifikationer i filen med datum i året. */
  verificationCount: number;
  /** Verifikationer som faktiskt importeras om året väljs. */
  importableCount: number;
  firstDate?: string;
  lastDate?: string;
  accountCount: number;
  totalDebitKr: number;
  totalCreditKr: number;
  unbalanced: SieUnbalanced[];
  duplicates: { series: string; number: number; count: number }[];
  /** Serie+nummer som redan finns i Ferva – hoppas över om året tas med. */
  collisions: string[];
  hasOpeningBalances: boolean;
  /** Bara saldon: IB + årets förändring som en samlad post. */
  balancesOnly: boolean;
  existing: SieYearExisting;
  selectable: boolean;
  defaultSelected: boolean;
  willImport: string[];
  omitted: string[];
  warnings: string[];
}

export interface SiePreview {
  companyName?: string;
  orgNumber?: string;
  /** null = filen saknar org.nr; false = stämmer inte med företaget. */
  orgNumberMatches: boolean | null;
  program?: string;
  sieType?: number;
  encoding: SieFile["encoding"];
  years: SieYearPreview[];
  accountCount: number;
  /** Konton som saknas i Fervas standardkontoplan – namnet tas från filen. */
  unknownAccounts: number[];
  dimensions: string[];
  warnings: string[];
  /** Inget år går att importera. */
  nothingToImport: boolean;
}

function inYear(date: string, year: { startDate: string; endDate: string }): boolean {
  return date >= year.startDate && date <= year.endDate;
}

function isBalancedOre(v: SieVerification): boolean {
  return v.lines.reduce((s, l) => s + l.amountOre, 0) === 0 && v.lines.some((l) => l.amountOre !== 0);
}

function verificationKey(series: string, number: number): string {
  return `${series}:${number}`;
}

export function previewSie(file: SieFile, data: Pick<DB, "fiscalYears" | "verifications" | "settings">): SiePreview {
  const existingKeys = new Set(data.verifications.map((v) => verificationKey(v.series, v.number)));
  const years = [...file.years].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const unknownAccounts = [...file.accounts.keys()].filter((a) => !BAS[a]).sort((a, b) => a - b);

  const yearPreviews: SieYearPreview[] = years.map((year) => {
    const label = fiscalYearLabelFor(year.startDate, year.endDate);
    const vers = file.verifications.filter((v) => inYear(v.date, year));
    const warnings: string[] = [];
    const unbalanced: SieUnbalanced[] = [];
    const seen = new Map<string, number>();
    const collisions: string[] = [];
    const accounts = new Set<number>();
    let debitKr = 0;
    let creditKr = 0;
    let importable = 0;
    let firstDate: string | undefined;
    let lastDate: string | undefined;

    for (const v of vers) {
      if (!isBalancedOre(v)) {
        unbalanced.push({ series: v.series, number: v.number, date: v.date, text: v.text, diffOre: v.lines.reduce((s, l) => s + l.amountOre, 0) });
        continue;
      }
      if (v.number != null) {
        const key = verificationKey(v.series, v.number);
        seen.set(key, (seen.get(key) ?? 0) + 1);
        if ((seen.get(key) ?? 0) > 1) continue;
        if (existingKeys.has(key)) {
          collisions.push(`${v.series}${v.number}`);
          continue;
        }
      }
      importable++;
      const kr = roundOrePreservingSum(v.lines.map((l) => l.amountOre));
      for (let i = 0; i < kr.length; i++) {
        accounts.add(v.lines[i].account);
        if (kr[i] > 0) debitKr += kr[i];
        else creditKr += -kr[i];
      }
      if (!firstDate || v.date < firstDate) firstDate = v.date;
      if (!lastDate || v.date > lastDate) lastDate = v.date;
    }
    const duplicates = [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => {
        const [series, number] = key.split(":");
        return { series, number: Number(number), count };
      });

    const ib = file.openingBalances.filter((b) => b.yearIndex === year.index);
    const hasUbOrRes =
      file.closingBalances.some((b) => b.yearIndex === year.index) || file.results.some((b) => b.yearIndex === year.index);
    const balancesOnly = vers.length === 0 && (ib.length > 0 || hasUbOrRes);

    // Befintlig bokföring
    let existing: SieYearExisting = "none";
    const same = data.fiscalYears.find((f) => f.startDate === year.startDate && f.endDate === year.endDate);
    const overlapping = data.fiscalYears.filter((f) => overlaps(f, year) && f !== same);
    if (same?.status === "stangt") existing = "closed";
    else if (overlapping.length > 0) existing = "overlap";
    else if (same) {
      const existingVers = data.verifications.filter((v) => inYear(v.date.slice(0, 10), year));
      existing = existingVers.length > 0 ? "same_year_with_verifications" : "same_year_empty";
    }

    const willImport: string[] = [];
    const omitted: string[] = [];
    if (existing === "closed") {
      omitted.push(`Räkenskapsåret ${label} är stängt i Ferva och kan inte ändras.`);
    } else if (existing === "overlap") {
      omitted.push(
        `Året ${year.startDate}–${year.endDate} överlappar ett befintligt räkenskapsår med andra datum (${overlapping
          .map((f) => `${f.startDate}–${f.endDate}`)
          .join(", ")}). Det kan inte importeras utan att bokföringen delas upp.`,
      );
    } else {
      if (ib.length > 0) {
        if (same && Object.keys(same.openingBalances).length > 0) {
          warnings.push("Ingående balanser finns redan i Ferva för året – filens ingående balanser används inte.");
        } else {
          willImport.push(`Ingående balanser för ${ib.length} konton`);
        }
      }
      if (balancesOnly) {
        if (hasUbOrRes) {
          willImport.push("Årets förändring som en samlad post (filen innehåller inga enskilda verifikationer för året)");
        } else {
          omitted.push("Filen innehåller bara ingående balanser för året – inga verifikationer.");
        }
      } else if (importable > 0) {
        willImport.push(`${importable.toLocaleString("sv-SE")} verifikationer (${accounts.size} konton)`);
      }
      if (unbalanced.length > 0) {
        omitted.push(
          `${unbalanced.length} ${unbalanced.length === 1 ? "verifikation balanserar" : "verifikationer balanserar"} inte i filen och tas inte med.`,
        );
      }
      if (duplicates.length > 0) {
        omitted.push(`${duplicates.length} dubbletter (samma serie och nummer två gånger) – bara första förekomsten tas med.`);
      }
      if (collisions.length > 0) {
        omitted.push(`${collisions.length} verifikationer har nummer som redan finns i Ferva (${collisions.slice(0, 5).join(", ")}${collisions.length > 5 ? " …" : ""}) och hoppas över.`);
      }
      if (existing === "same_year_with_verifications") {
        warnings.push("Året har redan bokföring i Ferva. Väljer du att ta med det läggs filens verifikationer till – inget skrivs över.");
      }
    }

    const selectable = existing !== "closed" && existing !== "overlap" && willImport.length > 0;
    const defaultSelected = selectable && existing !== "same_year_with_verifications";

    return {
      index: year.index,
      startDate: year.startDate,
      endDate: year.endDate,
      label,
      verificationCount: vers.length,
      importableCount: importable,
      firstDate,
      lastDate,
      accountCount: accounts.size,
      totalDebitKr: debitKr,
      totalCreditKr: creditKr,
      unbalanced,
      duplicates,
      collisions,
      hasOpeningBalances: ib.length > 0,
      balancesOnly,
      existing,
      selectable,
      defaultSelected,
      willImport,
      omitted,
      warnings,
    };
  });

  const outside = file.verifications.filter((v) => !years.some((y) => inYear(v.date, y)));
  const warnings = [...file.warnings];
  if (outside.length > 0) {
    warnings.push(`${outside.length} verifikationer har datum utanför filens räkenskapsår och tas inte med.`);
  }
  if (file.sieType != null && file.sieType !== 4) {
    warnings.push(`Filen är SIE-typ ${file.sieType}. Fullständiga verifikationer finns bara i SIE 4 – övriga typer innehåller saldon.`);
  }

  const settingsOrg = isOrgnrFormat(data.settings.orgNumber) ? normalizeOrgnr(data.settings.orgNumber) : "";
  const fileOrg = file.orgNumber && isOrgnrFormat(file.orgNumber) ? normalizeOrgnr(file.orgNumber) : "";
  const orgNumberMatches = !fileOrg ? null : !settingsOrg ? null : fileOrg === settingsOrg;
  if (orgNumberMatches === false) {
    warnings.push(`Filens organisationsnummer (${file.orgNumber}) är inte samma som företagets (${data.settings.orgNumber}). Kontrollera att det är rätt fil.`);
  }

  const dimensions = [...file.dimensions.entries()].map(([dim, name]) => {
    const count = [...file.objects.keys()].filter((k) => k.startsWith(`${dim}:`)).length;
    return `${name || `Dimension ${dim}`}${count ? ` (${count} objekt)` : ""}`;
  });
  if (dimensions.length > 0) {
    warnings.push("Projekt/resultatenheter följer med som text på raderna – Ferva har inga separata dimensioner i bokföringen.");
  }

  return {
    companyName: file.companyName,
    orgNumber: file.orgNumber,
    orgNumberMatches,
    program: file.program,
    sieType: file.sieType,
    encoding: file.encoding,
    years: yearPreviews,
    accountCount: file.accounts.size,
    unknownAccounts,
    dimensions,
    warnings,
    nothingToImport: !yearPreviews.some((y) => y.selectable),
  };
}

/* ----------------------------------- import --------------------------------- */

export interface SieImportChoices {
  /** #RAR-index för de år som ska tas med. */
  yearIndexes: number[];
  /** Dataimportens id – blir verifikationernas källa. */
  importId: string;
}

export interface SieImportResult {
  fiscalYearsCreated: number;
  fiscalYearsUpdated: number;
  verificationsCreated: number;
  openingBalanceYears: number;
  skippedUnbalanced: number;
  skippedDuplicates: number;
  skippedCollisions: number;
  summary: string;
  warnings: string[];
  yearLabels: string[];
}

function accountName(file: SieFile, account: number): string {
  return BAS[account] ?? file.accounts.get(account) ?? `Konto ${account}`;
}

function objectNote(file: SieFile, objects: { dimension: number; code: string }[]): string | undefined {
  if (objects.length === 0) return undefined;
  return objects
    .map((o) => {
      const dim = file.dimensions.get(o.dimension) || `Dimension ${o.dimension}`;
      const name = file.objects.get(`${o.dimension}:${o.code}`) ?? o.code;
      return `${dim}: ${name}`;
    })
    .join(" · ");
}

function entriesFrom(file: SieFile, lines: { account: number; amountOre: number; text?: string; objects: { dimension: number; code: string }[] }[]): VerificationEntry[] {
  const kr = roundOrePreservingSum(lines.map((l) => l.amountOre));
  const entries: VerificationEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (kr[i] === 0) continue;
    const l = lines[i];
    const note = [l.text, objectNote(file, l.objects)].filter(Boolean).join(" · ") || undefined;
    entries.push({
      account: l.account,
      accountName: accountName(file, l.account),
      debit: kr[i] > 0 ? kr[i] : 0,
      credit: kr[i] < 0 ? -kr[i] : 0,
      ...(note ? { note } : {}),
    });
  }
  return entries;
}

function assertBalancedEntries(entries: VerificationEntry[]): boolean {
  const debit = entries.reduce((s, e) => s + e.debit, 0);
  const credit = entries.reduce((s, e) => s + e.credit, 0);
  return entries.length >= 2 && debit > 0 && debit === credit;
}

/**
 * Genomför importen mot data (muteras). Kastar om något valt år inte går
 * att importera – anroparen kör i en transaktion så ingenting halvsparas.
 */
export function applySieImport(
  file: SieFile,
  data: DB,
  choices: SieImportChoices,
  now = new Date().toISOString(),
): SieImportResult {
  const preview = previewSie(file, data);
  const selected = preview.years.filter((y) => choices.yearIndexes.includes(y.index));
  if (selected.length === 0) throw new Error("Välj minst ett räkenskapsår att ta med.");
  for (const y of selected) {
    if (!y.selectable) throw new Error(`Räkenskapsåret ${y.label} kan inte importeras: ${y.omitted[0] ?? "konflikt med befintlig bokföring."}`);
  }

  // Allt byggs först i staging och skrivs till data i ETT steg när varje
  // valt år har validerats – ett fel halvvägs lämnar bokföringen orörd även
  // i JSON-läget (Supabase rullar dessutom tillbaka transaktionen).
  const stagedYears: FiscalYear[] = [];
  const stagedOpening: { fy: FiscalYear; openingBalances: Record<string, number> }[] = [];
  const stagedVerifications: Verification[] = [];
  const allYears = () => [...data.fiscalYears, ...stagedYears];
  const existingKeys = new Set(data.verifications.map((v) => verificationKey(v.series, v.number)));
  const result: SieImportResult = {
    fiscalYearsCreated: 0,
    fiscalYearsUpdated: 0,
    verificationsCreated: 0,
    openingBalanceYears: 0,
    skippedUnbalanced: 0,
    skippedDuplicates: 0,
    skippedCollisions: 0,
    summary: "",
    warnings: [],
    yearLabels: [],
  };
  let maxSeriesA = 0;
  // Egen serie "SIE" för onumrerade verifikationer och samlade saldoposter.
  let sieNext = data.verifications.filter((v) => v.series === "SIE").reduce((m, v) => Math.max(m, v.number), 0) + 1;

  for (const y of selected.sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    // Räkenskapsår
    let fy = allYears().find((f) => f.startDate === y.startDate && f.endDate === y.endDate);
    const ib = file.openingBalances.filter((b) => b.yearIndex === y.index);
    const ibEntries = roundOrePreservingSum(ib.map((b) => b.amountOre));
    const openingBalances: Record<string, number> = {};
    ib.forEach((b, i) => {
      if (ibEntries[i] !== 0) openingBalances[String(b.account)] = ibEntries[i];
    });
    const ibSum = Object.values(openingBalances).reduce((s, v) => s + v, 0);
    if (ib.length > 0 && ibSum !== 0) {
      throw new Error(`Ingående balanser för ${y.label} summerar inte till noll i filen (${ibSum} kr). Filen behöver rättas i källsystemet.`);
    }
    if (!fy) {
      fy = {
        id: `fy-${y.startDate.slice(0, 4)}-${uid().slice(0, 8)}`,
        label: uniqueLabel(allYears(), y.label),
        startDate: y.startDate,
        endDate: y.endDate,
        status: "oppet",
        openingBalances,
        openingSource: "migrering",
      };
      stagedYears.push(fy);
      result.fiscalYearsCreated++;
      if (ib.length > 0) result.openingBalanceYears++;
    } else if (ib.length > 0 && Object.keys(fy.openingBalances).length === 0) {
      stagedOpening.push({ fy, openingBalances });
      result.fiscalYearsUpdated++;
      result.openingBalanceYears++;
    }
    result.yearLabels.push(fy.label);

    const fiscalYearId = fy.id;
    const vers = file.verifications.filter((v) => inYear(v.date, y));
    const seen = new Set<string>();

    for (const v of vers) {
      if (!isBalancedOre(v)) {
        result.skippedUnbalanced++;
        continue;
      }
      let series = v.series;
      let number = v.number;
      if (number == null) {
        // Onumrerade verifikationer får egen serie så filens numrering aldrig förvanskas.
        series = "SIE";
        number = sieNext++;
      }
      const key = verificationKey(series, number);
      if (seen.has(key)) {
        result.skippedDuplicates++;
        continue;
      }
      if (existingKeys.has(key)) {
        result.skippedCollisions++;
        continue;
      }
      const entries = entriesFrom(file, v.lines);
      if (!assertBalancedEntries(entries)) {
        // Rader som avrundas till noll kan lämna en verifikation med < 2 rader.
        result.skippedUnbalanced++;
        result.warnings.push(`${v.series}${v.number ?? ""} (${v.date}) blev tom efter avrundning till hela kronor och togs inte med.`);
        continue;
      }
      seen.add(key);
      existingKeys.add(key);
      if (series === "A") maxSeriesA = Math.max(maxSeriesA, number);
      const verification: Verification = {
        id: uid(),
        series,
        number,
        date: `${v.date}T12:00:00.000Z`,
        description: v.text || `Verifikation ${series}${number}`,
        entries,
        source: { type: "sie_import", id: choices.importId },
        confidence: "hog",
        createdBy: "anvandare",
        status: "bokford",
        postedAt: now,
        fiscalYearId,
        explanation: `Importerad från SIE-fil${file.program ? ` (${file.program})` : ""}. Belopp i hela kronor.`,
        createdAt: now,
      };
      stagedVerifications.push(verification);
      result.verificationsCreated++;
    }

    // År med bara saldon: årets förändring som en samlad post.
    if (y.balancesOnly) {
      const lines = movementLines(file, y.index);
      if (lines.length > 0) {
        const entries = entriesFrom(file, lines.map((l) => ({ ...l, objects: [] })));
        if (!assertBalancedEntries(entries)) {
          throw new Error(`Saldona för ${y.label} går inte ihop i filen (utgående minus ingående balans är inte noll). Året kan inte importeras som samlad post.`);
        }
        const number = sieNext++;
        stagedVerifications.push({
          id: uid(),
          series: "SIE",
          number,
          date: `${y.endDate}T12:00:00.000Z`,
          description: `Årets bokföring ${fy.label} enligt SIE-fil (saldon, inte enskilda verifikationer)`,
          entries,
          source: { type: "sie_import", id: choices.importId },
          confidence: "hog",
          createdBy: "anvandare",
          status: "bokford",
          postedAt: now,
          fiscalYearId,
          explanation: "Filen innehöll bara saldon för året. Förändringen per konto (utgående minus ingående balans, resultat för resultatkonton) bokförs som en samlad post.",
          createdAt: now,
        });
        result.verificationsCreated++;
      }
    }
  }

  // Allt validerat – skriv i ett steg.
  data.fiscalYears.push(...stagedYears);
  for (const { fy, openingBalances } of stagedOpening) {
    fy.openingBalances = openingBalances;
    fy.openingSource = "migrering";
  }
  data.verifications.push(...stagedVerifications);
  // Serie A delar nummerserie med appens egna verifikationer.
  if (maxSeriesA >= data.sequences.verification) data.sequences.verification = maxSeriesA + 1;

  const parts = [
    `${result.verificationsCreated.toLocaleString("sv-SE")} ${result.verificationsCreated === 1 ? "verifikation" : "verifikationer"}`,
    result.yearLabels.join(", "),
  ];
  if (result.openingBalanceYears > 0) parts.push("ingående balanser");
  result.summary = parts.join(" · ");

  logAudit("anvandare", "bokforing_importerad", `Bokföring importerad från SIE-fil: ${result.summary}.`, {
    targetType: "dataimport",
    targetId: choices.importId,
  });
  return result;
}

function uniqueLabel(existing: FiscalYear[], label: string): string {
  if (!existing.some((f) => f.label === label)) return label;
  let n = 2;
  while (existing.some((f) => f.label === `${label} (${n})`)) n++;
  return `${label} (${n})`;
}

/** Årets förändring per konto ur saldon: UB−IB för balanskonton, RES för resultatkonton. */
function movementLines(file: SieFile, yearIndex: number): { account: number; amountOre: number; text?: string }[] {
  const byAccount = new Map<number, number>();
  const ib = new Map<number, number>();
  for (const b of file.openingBalances) if (b.yearIndex === yearIndex) ib.set(b.account, b.amountOre);
  for (const b of file.closingBalances) {
    if (b.yearIndex !== yearIndex) continue;
    const movement = b.amountOre - (ib.get(b.account) ?? 0);
    if (movement !== 0) byAccount.set(b.account, (byAccount.get(b.account) ?? 0) + movement);
  }
  for (const b of file.results) {
    if (b.yearIndex !== yearIndex || b.amountOre === 0) continue;
    byAccount.set(b.account, (byAccount.get(b.account) ?? 0) + b.amountOre);
  }
  return [...byAccount.entries()].map(([account, amountOre]) => ({ account, amountOre, text: "Årets förändring enligt saldon" }));
}
