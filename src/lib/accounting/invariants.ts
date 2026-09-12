import { createHash } from "crypto";
import type { DB, FiscalYear, Verification, VerificationSource } from "../types";
import { accountName, accountType } from "./chart";
import { bokforingsdatum, isVatPeriodicity, vatPeriodsOf, type Period, type VatPeriodicity } from "./dates";
import { verificationLabel } from "./engine";
import { SKATTEKONTO } from "./tax-account-model";
import { vatCodeForAccount } from "./vat";

/**
 * Invarianter för bokföringen: påståenden som måste vara sanna om ett laddat
 * tillstånd, oavsett hur det uppstod (demoseed, SIE-import, riktig drift).
 *
 * Rena funktioner. Varje kontroll tar tillståndet som argument, läser aldrig
 * db() och muterar ingenting, så samma kontroll kan köras i ett test, i ett
 * skript eller mot ett importerat räkenskapsår. Enda undantaget är
 * kontoregistret (chart.ts), som slår upp företagets egna konton i det laddade
 * tillståndet; används egna konton ska kontrollen därför köras med samma
 * tillstånd aktivt.
 *
 * Kontrollerna hittar fel, de rättar aldrig. Varje brott är en text som går
 * att läsa högt för den som ska förstå vad som är trasigt, med konto,
 * verifikationsnummer eller belopp i klartext.
 */

export type InvariantKey =
  /** (a) Varje verifikation har debet lika med kredit. */
  | "verifikation_balanserar"
  /** (b) Verifikationsnumren är obrutna per serie, och varje verifikation ligger i rätt räkenskapsår. */
  | "nummerserie_obruten"
  /** (c) En bokförd verifikation har inte ändrats efter bokföringen. */
  | "bokford_verifikation_oforandrad"
  /** (d) Momsens rutor för en period stämmer med rörelserna på 26xx-kontona. */
  | "momsrutor_mot_momskonton"
  /** (e) Saldot på 1630 härleds ur skattekontots och bankens rörelser plus ingående balans. */
  | "skattekonto_harleds_ur_rorelserna"
  /** (f) En låst period har inte fått nya verifikationer efter att låset sattes. */
  | "last_period_oforandrad"
  /** (g) Balansrapportens tillgångar är lika med skulder plus eget kapital plus beräknat resultat. */
  | "balansrapporten_balanserar"
  /** (h) Varje underlag (source.id) har högst en verifikation. */
  | "ett_underlag_en_verifikation";

/**
 * `brott` = invarianten är bruten, tillståndet är fel.
 * `ej_verifierbar` = kontrollen kan inte utföras med det som lagras i dag.
 * Skillnaden är viktig: ett tomt svar från en kontroll som inte kan köras är
 * inte samma sak som ett godkänt resultat, och får aldrig läsas som ett sådant.
 */
export type InvariantSeverity = "brott" | "ej_verifierbar";

export interface InvariantViolation {
  invariant: InvariantKey;
  severity: InvariantSeverity;
  /** Klarspråk: vad som är fel, med belopp, konto eller verifikationsnummer. */
  message: string;
  verificationIds?: string[];
  account?: number;
  period?: { start: string; end: string };
}

export interface Invariant {
  key: InvariantKey;
  /** Rubrik på svenska, samma text i rapporter och tester. */
  label: string;
  check: (data: DB) => InvariantViolation[];
}

export interface InvariantReport {
  /** Allt kontrollerna hittade, i registrets ordning. */
  violations: InvariantViolation[];
  /** Verkliga brott. */
  brott: InvariantViolation[];
  /** Kontroller som inte kunde utföras med dagens lagring. */
  ejVerifierbara: InvariantViolation[];
  /** Per invariant, tom lista när invarianten håller. */
  perInvariant: Record<InvariantKey, InvariantViolation[]>;
  /** Inga brott. Poster som inte kunde verifieras räknas inte som brott. */
  ok: boolean;
}

/* ------------------------------- Hjälpare -------------------------------- */

/** Momskontona i BAS: utgående, ingående och redovisningskontot 2650. */
const MOMSKONTO_FRAN = 2600;
const MOMSKONTO_TILL = 2699;

/**
 * Underlagstyper som bokförs på ett fast periodslutdatum även när perioden är
 * låst (PostOptions.bypassPeriodLock i engine.ts): momsomföringen, skattekontot,
 * bokslutet, avskrivningarna, periodiseringarna och ingående balanser. De är
 * deterministiska systemposter, inte nya affärshändelser, och räknas därför inte
 * som en ändring av en låst period i (f).
 */
const KALLOR_MED_LASUNDANTAG: VerificationSource["type"][] = [
  "avskrivning",
  "bokslut",
  "ingaende_balans",
  "moms",
  "periodisering",
  "skattekonto",
];

/**
 * Underlagstyper där flera verifikationer på samma id är modellen och inte en
 * dubbelbokföring. De räknas inte i (h):
 *
 *   rattelse       createCorrection bokför återföringen och den nya bokningen,
 *                  båda med det rättade verifikationens id (engine.ts).
 *   bokslut        close.ts bokför flera avslutsposter på räkenskapsårets id, och
 *                  year-end.ts bokför förändringen varje gång en bilaga räknas om.
 *   periodisering  accruals.ts bokför periodiseringen och dess återföring på
 *                  samma id.
 *   avskrivning    assets.ts bokför en period i taget på tillgångens id.
 *   sie_import     alla verifikationer i filen bär importens id.
 *
 * Kvar under kontrollen är de källor som ÄR ett dokument eller en händelse som
 * bokförs en gång: kundfaktura, betalning, utgift, leverantörsfaktura,
 * banktransaktion, moms, skattekonto, lön och ingående balans.
 */
const KALLOR_MED_FLERA_VERIFIKATIONER: VerificationSource["type"][] = [
  "avskrivning",
  "bokslut",
  "periodisering",
  "rattelse",
  "sie_import",
];

function vDate(v: Verification): string {
  return bokforingsdatum(v.date);
}

function label(v: Verification): string {
  return verificationLabel(v);
}

/** Nettot (debet minus kredit) på ett konto i en verifikation. */
function netOn(v: Verification, account: number): number {
  let net = 0;
  for (const e of v.entries) {
    if (e.account === account) net += e.debit - e.credit;
  }
  return net;
}

function sourceKey(source: VerificationSource): string | undefined {
  return "id" in source ? `${source.type}:${source.id}` : undefined;
}

function fiscalYearOf(data: DB, date: string): FiscalYear | undefined {
  return data.fiscalYears.find((f) => f.startDate <= date && date <= f.endDate);
}

/** Företagets momsperiodicitet, med samma standard som fiscal.vatPeriodicity. */
function periodicityOf(data: DB): VatPeriodicity {
  const chosen = data.settings.vatPeriodicity;
  return isVatPeriodicity(chosen) ? chosen : "kvartal";
}

function kr(amount: number): string {
  return `${amount} kr`;
}

/* --------------------- (a) Debet lika med kredit ------------------------- */

export function checkBalancedVerifications(data: DB): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const v of data.verifications) {
    const debit = v.entries.reduce((s, e) => s + e.debit, 0);
    const credit = v.entries.reduce((s, e) => s + e.credit, 0);
    if (debit !== credit) {
      violations.push({
        invariant: "verifikation_balanserar",
        severity: "brott",
        message: `${label(v)} ${v.description} balanserar inte: debet ${kr(debit)}, kredit ${kr(credit)}.`,
        verificationIds: [v.id],
      });
    }
    for (const e of v.entries) {
      if (!Number.isInteger(e.debit) || !Number.isInteger(e.credit) || e.debit < 0 || e.credit < 0) {
        violations.push({
          invariant: "verifikation_balanserar",
          severity: "brott",
          message: `${label(v)} har ett ogiltigt belopp på konto ${e.account} ${accountName(e.account)}: debet ${e.debit}, kredit ${e.credit}. Bokföringen är i hela kronor och aldrig negativ.`,
          verificationIds: [v.id],
          account: e.account,
        });
      }
    }
  }
  return violations;
}

/* -------------------- (b) Obruten nummerserie ---------------------------- */

/**
 * Numren inom en serie får inte ha hål eller dubbletter. Serien är obruten per
 * företag och inte per räkenskapsår (ADR-3 i README: en löpande serie A över
 * årsgränsen, SIE-exporten kräver bara unika nummer inom serien). Det som
 * kontrolleras per räkenskapsår är därför att varje verifikation ligger i det
 * år dess bokföringsdatum faller i: ett nummer som är bokfört på fel år
 * försvinner ur årets bokslut och SIE-fil utan att lämna ett hål i serien.
 */
export function checkVerificationNumbering(data: DB): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const perSeries = new Map<string, Verification[]>();
  for (const v of data.verifications) {
    const series = v.series ?? "A";
    const list = perSeries.get(series);
    if (list) list.push(v);
    else perSeries.set(series, [v]);
  }

  for (const [series, list] of [...perSeries.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sorted = [...list].sort((a, b) => a.number - b.number);
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (current.number === previous.number) {
        violations.push({
          invariant: "nummerserie_obruten",
          severity: "brott",
          message: `Nummer ${series}${current.number} används av två verifikationer: ${previous.description} och ${current.description}.`,
          verificationIds: [previous.id, current.id],
        });
      } else if (current.number !== previous.number + 1) {
        const saknade = current.number - previous.number - 1;
        violations.push({
          invariant: "nummerserie_obruten",
          severity: "brott",
          message: `Hål i serie ${series} mellan ${series}${previous.number} och ${series}${current.number}: ${saknade} nummer saknas.`,
          verificationIds: [previous.id, current.id],
        });
      }
    }
  }

  for (const v of data.verifications) {
    if (!v.fiscalYearId) continue;
    const fy = data.fiscalYears.find((f) => f.id === v.fiscalYearId);
    const belongsTo = fiscalYearOf(data, vDate(v));
    if (!fy) {
      violations.push({
        invariant: "nummerserie_obruten",
        severity: "brott",
        message: `${label(v)} pekar på ett räkenskapsår som inte finns (${v.fiscalYearId}).`,
        verificationIds: [v.id],
      });
    } else if (belongsTo && belongsTo.id !== fy.id) {
      violations.push({
        invariant: "nummerserie_obruten",
        severity: "brott",
        message: `${label(v)} är bokförd ${vDate(v)} men ligger i räkenskapsåret ${fy.label} i stället för ${belongsTo.label}.`,
        verificationIds: [v.id],
      });
    }
  }
  return violations;
}

/* ------------- (c) Bokförd verifikation är oförändrad -------------------- */

/**
 * Kanoniskt hash av det som är låst i en bokförd verifikation: serie, nummer,
 * datum, beskrivning, rader, underlag och förklaring. Fält som får fyllas på
 * efteråt (bilaga, rättelselänkar) ingår inte.
 *
 * Funktionen är avsedd att användas på två ställen: här, för att upptäcka en
 * ändring, och i bokföringsmotorn, för att lagra hashen när verifikationen
 * bokförs. Det andra steget finns inte ännu, se `checkPostedVerificationsUnchanged`.
 */
export function verificationContentHash(v: Verification): string {
  const canonical = JSON.stringify({
    series: v.series,
    number: v.number,
    date: v.date,
    transactionDate: v.transactionDate,
    description: v.description,
    entries: v.entries.map((e) => ({
      account: e.account,
      debit: e.debit,
      credit: e.credit,
      vatCode: e.vatCode,
      note: e.note,
    })),
    source: v.source,
    explanation: v.explanation,
    correctsVerificationId: v.correctsVerificationId,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Hashen som lagrades när verifikationen bokfördes, om den finns. Läses
 * defensivt: fältet finns inte i Verification i dag, och kontrollen ska kunna
 * köras både före och efter att motorn börjar lagra det.
 */
export function storedPostingHash(v: Verification): string | undefined {
  const carrier = v as Verification & { postedHash?: unknown; contentHash?: unknown };
  const value = carrier.postedHash ?? carrier.contentHash;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Jämför varje bokförd verifikation med hashen som lagrades vid bokföringen.
 *
 * Verifikationer utan lagrad hash kan inte kontrolleras. De rapporteras som
 * `ej_verifierbar` i stället för att tigande passera: en kontroll som alltid
 * säger ja är värre än ingen kontroll. Att lagra hashen kräver en ändring i
 * postVerification (engine.ts) och ligger utanför den här modulen.
 */
export function checkPostedVerificationsUnchanged(data: DB): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const utanHash: Verification[] = [];
  for (const v of data.verifications) {
    const stored = storedPostingHash(v);
    if (!stored) {
      utanHash.push(v);
      continue;
    }
    const current = verificationContentHash(v);
    if (current !== stored) {
      violations.push({
        invariant: "bokford_verifikation_oforandrad",
        severity: "brott",
        message: `${label(v)} ${v.description} har ändrats efter bokföringen: innehållet hashar till ${current.slice(0, 12)} men ${stored.slice(0, 12)} lagrades när den bokfördes.`,
        verificationIds: [v.id],
      });
    }
  }
  if (utanHash.length > 0) {
    violations.push({
      invariant: "bokford_verifikation_oforandrad",
      severity: "ej_verifierbar",
      message: `${utanHash.length} bokförda verifikationer saknar en hash från bokföringstillfället, så en ändring i efterhand går inte att upptäcka. Hashen behöver lagras av postVerification när verifikationen bokförs.`,
      verificationIds: utanHash.map((v) => v.id),
    });
  }
  return violations;
}

/* --------------- (d) Momsrutor mot 26xx-kontona ------------------------- */

interface VatLedgerPeriod {
  /** Belopp per deklarationsruta, räknat ur verifikationsraderna. */
  boxes: Map<string, number>;
  utgaende: number;
  ingaende: number;
  /** Kredit minus debet på alla 26xx-konton i perioden. */
  momskontoNetto: number;
  /** 26xx-konton utan momskod, med sitt netto. De syns i ingen ruta. */
  utanMomskod: Map<number, number>;
}

/**
 * Momsen i en period, räknad ur verifikationsraderna på samma sätt som
 * computeVatPosition men över ett givet tillstånd.
 *
 * Periodens avräkning räknas inte med: momsomföringen till 2650 (source moms)
 * och överföringen till skattekontot (source skattekonto) bokförs på periodens
 * sista dag och skulle annars nolla ut precis den momsaktivitet rutorna ska
 * visa.
 */
function vatLedgerFor(data: DB, period: Period): VatLedgerPeriod {
  const boxes = new Map<string, number>();
  const utanMomskod = new Map<number, number>();
  let utgaende = 0;
  let ingaende = 0;
  let momskontoNetto = 0;

  const addBox = (code: string, amount: number) => boxes.set(code, (boxes.get(code) ?? 0) + amount);

  for (const v of data.verifications) {
    const d = vDate(v);
    if (d < period.start || d > period.end) continue;
    if (v.source.type === "moms" || v.source.type === "skattekonto") continue;
    for (const e of v.entries) {
      const def = vatCodeForAccount(e.account);
      if (def) {
        if (def.kind === "forsaljning") addBox(def.box, e.credit - e.debit);
        else if (def.kind === "inkop") addBox(def.box, e.debit - e.credit);
        else if (def.kind === "utgaende") {
          addBox(def.box, e.credit - e.debit);
          utgaende += e.credit - e.debit;
        } else {
          addBox(def.box, e.debit - e.credit);
          ingaende += e.debit - e.credit;
        }
      }
      if (e.account >= MOMSKONTO_FRAN && e.account <= MOMSKONTO_TILL) {
        momskontoNetto += e.credit - e.debit;
        if (!def) utanMomskod.set(e.account, (utanMomskod.get(e.account) ?? 0) + e.credit - e.debit);
      }
    }
  }
  addBox("49", utgaende - ingaende);
  return { boxes, utgaende, ingaende, momskontoNetto, utanMomskod };
}

export function checkVatBoxesAgainstVatAccounts(data: DB): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const periodicity = periodicityOf(data);

  for (const fy of [...data.fiscalYears].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    for (const period of vatPeriodsOf(fy, periodicity)) {
      const ledger = vatLedgerFor(data, period);
      const attBetala = ledger.utgaende - ledger.ingaende;
      const periodRef = { start: period.start, end: period.end };

      // Moms att betala är hela förändringen på momskontona. Går de isär står
      // det moms på ett 26xx-konto som ingen ruta räknar med.
      if (ledger.momskontoNetto !== attBetala) {
        const okanda = [...ledger.utanMomskod.entries()]
          .filter(([, net]) => net !== 0)
          .map(([account, net]) => `${account} ${accountName(account)} (${kr(net)})`);
        violations.push({
          invariant: "momsrutor_mot_momskonton",
          severity: "brott",
          message:
            `${period.label}: ruta 49 säger ${kr(attBetala)} men momskontona 26xx ändrades ${kr(ledger.momskontoNetto)}.` +
            (okanda.length ? ` Utan momskod: ${okanda.join(", ")}.` : ""),
          period: periodRef,
        });
      }

      const report = data.vatReports.find((r) => r.periodStart === period.start && r.periodEnd === period.end);
      if (!report) continue;

      // En genererad eller deklarerad rapport bär frysta siffror. De ska vara
      // samma tal som huvudboken visar för perioden.
      if (report.utgaende !== ledger.utgaende || report.ingaende !== ledger.ingaende || report.attBetala !== attBetala) {
        violations.push({
          invariant: "momsrutor_mot_momskonton",
          severity: "brott",
          message: `Momsrapporten för ${report.label} säger utgående ${kr(report.utgaende)}, ingående ${kr(report.ingaende)}, att betala ${kr(report.attBetala)}. Huvudboken säger ${kr(ledger.utgaende)}, ${kr(ledger.ingaende)}, ${kr(attBetala)}.`,
          period: periodRef,
        });
      }
      const koder = new Set<string>([...ledger.boxes.keys(), ...report.boxes.map((b) => b.code)]);
      for (const code of [...koder].sort()) {
        const iRapporten = report.boxes.find((b) => b.code === code)?.amount ?? 0;
        const iHuvudboken = ledger.boxes.get(code) ?? 0;
        if (iRapporten !== iHuvudboken) {
          violations.push({
            invariant: "momsrutor_mot_momskonton",
            severity: "brott",
            message: `Ruta ${code} för ${report.label}: rapporten säger ${kr(iRapporten)}, huvudboken ${kr(iHuvudboken)}.`,
            period: periodRef,
          });
        }
      }
    }
  }
  return violations;
}

/* -------------------- (e) Skattekontots saldo --------------------------- */

/**
 * Saldot på 1630 ska vara ingående balans plus rörelserna från de vägar som
 * äger skattekontot. Det finns exakt två, och båda är avsiktliga:
 *
 *   1. tax-account.ts, som märker verifikationen med source.type skattekonto
 *      (moms, arbetsgivaravgifter, personalskatt, F-skatt, inbetalningar).
 *   2. bankens egen överföring till eller från kontot, kinderna skattekonto och
 *      skatteaterbetalning i banking/bank-kinds.ts. De bokförs som
 *      banktransaktion och flyttar bara pengar mellan 1630 och företagskontot.
 *      Fas 1.1 Skattekontomodellen i cursor-prompt-bokforing.md pekar ut just
 *      den konteringen som referensen för inbetalningar.
 *
 * Allt annat som rör 1630 (en manuell verifikation, en kundfaktura, en import)
 * ger skattekontosidan ett saldo som dess egna rader inte förklarar.
 *
 * Kontrollen är tom så länge ingenting alls rör 1630. Demoseedet bokför
 * preliminärskatten med entriesTaxPayment (2510/1930) och når därför aldrig
 * kontot; först när seeden lägger F-skatten som 2518/1630 med source
 * skattekonto (samma fas) blir det den här kontrollen som avgör om skattekontot
 * stämmer.
 */
function rorSkattekontotPaDokumenteradVag(v: Verification): boolean {
  if (v.source.type === "skattekonto") return true;
  if (v.source.type !== "banktransaktion") return false;
  return v.entries.every((e) => e.account === SKATTEKONTO || (e.account >= 1900 && e.account <= 1999));
}

export function checkTaxAccountBalance(data: DB): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const ib = data.fiscalYears.reduce((s, fy) => s + (fy.openingBalances[String(SKATTEKONTO)] ?? 0), 0);

  let alla = 0;
  let franSkattekontot = 0;
  const frammande: Verification[] = [];
  for (const v of data.verifications) {
    if (!v.entries.some((e) => e.account === SKATTEKONTO)) continue;
    alla += netOn(v, SKATTEKONTO);
    if (rorSkattekontotPaDokumenteradVag(v)) franSkattekontot += netOn(v, SKATTEKONTO);
    else frammande.push(v);
  }

  if (alla !== franSkattekontot) {
    for (const v of frammande) {
      violations.push({
        invariant: "skattekonto_harleds_ur_rorelserna",
        severity: "brott",
        message: `${label(v)} ${v.description} rör konto ${SKATTEKONTO} ${accountName(SKATTEKONTO)} med ${kr(netOn(v, SKATTEKONTO))} men är bokförd som ${v.source.type}, varken via skattekontot eller som en banköverföring till kontot.`,
        verificationIds: [v.id],
        account: SKATTEKONTO,
      });
    }
    violations.push({
      invariant: "skattekonto_harleds_ur_rorelserna",
      severity: "brott",
      message: `Saldot på ${SKATTEKONTO} är ${kr(ib + alla)} men skattekontots och bankens egna rörelser plus ingående balans ger ${kr(ib + franSkattekontot)}. Skillnaden ${kr(alla - franSkattekontot)} kommer från bokningar utanför de två vägarna.`,
      account: SKATTEKONTO,
    });
  }
  return violations;
}

/* ------------------- (f) Låst period är oförändrad ---------------------- */

/**
 * Efter att bokföringen låsts till och med ett datum får inga nya
 * verifikationer tillkomma i den perioden. Tidpunkten för låset läses ur audit
 * trailen (åtgärden period_last), som aldrig rensas. Saknas den går kontrollen
 * inte att utföra, och det rapporteras som just det.
 */
export function checkLockedPeriodsUnchanged(data: DB): InvariantViolation[] {
  const lock = data.accounting.lockedThrough;
  if (!lock) return [];

  const lasHandelser = data.auditTrail
    .filter((e) => e.action === "period_last" && e.details.includes(lock))
    .sort((a, b) => a.at.localeCompare(b.at));
  const satt = lasHandelser[0]?.at;
  if (!satt) {
    return [
      {
        invariant: "last_period_oforandrad",
        severity: "ej_verifierbar",
        message: `Bokföringen är låst till och med ${lock} men audit trailen saknar händelsen där låset sattes, så det går inte att avgöra vilka verifikationer som fanns då.`,
      },
    ];
  }

  const violations: InvariantViolation[] = [];
  for (const v of data.verifications) {
    if (vDate(v) > lock) continue;
    const bokfordAt = v.postedAt ?? v.createdAt;
    if (bokfordAt <= satt) continue;
    if (KALLOR_MED_LASUNDANTAG.includes(v.source.type)) continue;
    violations.push({
      invariant: "last_period_oforandrad",
      severity: "brott",
      message: `${label(v)} ${v.description} har bokföringsdatum ${vDate(v)} i den låsta perioden men bokfördes ${bokfordAt}, efter att låset till och med ${lock} sattes ${satt}.`,
      verificationIds: [v.id],
    });
  }
  return violations;
}

/* ------------------ (g) Balansrapporten balanserar ---------------------- */

interface Balansdelar {
  tillgangar: number;
  egetKapital: number;
  skulder: number;
  beraknatResultat: number;
}

/** Utgående saldo per konto för ett räkenskapsår: IB plus årets rörelser. */
function ubPerAccount(data: DB, fy: FiscalYear | undefined): Map<number, number> {
  const per = new Map<number, number>();
  const add = (account: number, amount: number) => per.set(account, (per.get(account) ?? 0) + amount);
  if (fy) {
    for (const [account, amount] of Object.entries(fy.openingBalances)) {
      if (amount !== 0) add(Number(account), amount);
    }
  }
  for (const v of data.verifications) {
    const d = vDate(v);
    if (fy && (d < fy.startDate || d > fy.endDate)) continue;
    for (const e of v.entries) add(e.account, e.debit - e.credit);
  }
  return per;
}

/** Samma indelning som balansrapport() i ledger.ts, räknad över ett tillstånd. */
function balansdelar(data: DB, fy: FiscalYear | undefined): Balansdelar {
  let tillgangar = 0;
  let egetKapital = 0;
  let skulder = 0;
  let resultatEffekt = 0;
  for (const [account, ub] of ubPerAccount(data, fy)) {
    if (ub === 0) continue;
    switch (accountType(account)) {
      case "tillgang":
        tillgangar += ub;
        break;
      case "eget_kapital":
        egetKapital += -ub;
        break;
      case "skuld":
        skulder += -ub;
        break;
      default:
        // Resultatkonton, och 8999 tills det är omfört, blir beräknat resultat.
        resultatEffekt += ub;
    }
  }
  return { tillgangar, egetKapital, skulder, beraknatResultat: -resultatEffekt };
}

export function checkBalanceSheetBalances(data: DB): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  // Ingående balanser summerar alltid till noll. Gör de inte det är
  // balansräkningen skev innan en enda verifikation är bokförd.
  for (const fy of data.fiscalYears) {
    const sum = Object.values(fy.openingBalances).reduce((s, n) => s + n, 0);
    if (sum !== 0) {
      violations.push({
        invariant: "balansrapporten_balanserar",
        severity: "brott",
        message: `Ingående balans för ${fy.label} summerar till ${kr(sum)} i stället för 0 kr.`,
      });
    }
  }

  // Utan räkenskapsår finns ingen årsindelning att läsa balansen per: då
  // kontrolleras hela bokföringen i ett svep.
  const arAttKontrollera: (FiscalYear | undefined)[] = data.fiscalYears.length ? [...data.fiscalYears] : [undefined];
  for (const fy of arAttKontrollera) {
    const delar = balansdelar(data, fy);
    const differens = delar.tillgangar - delar.egetKapital - delar.beraknatResultat - delar.skulder;
    if (differens !== 0) {
      violations.push({
        invariant: "balansrapporten_balanserar",
        severity: "brott",
        message: `Balansrapporten ${fy ? `för ${fy.label}` : "för hela bokföringen"} går inte ihop: tillgångar ${kr(delar.tillgangar)} mot eget kapital ${kr(delar.egetKapital)} plus beräknat resultat ${kr(delar.beraknatResultat)} plus skulder ${kr(delar.skulder)}. Differens ${kr(differens)}.`,
      });
    }
  }
  return violations;
}

/* ---------------- (h) Ett underlag, en verifikation --------------------- */

/**
 * Ett underlag bokförs en gång. Underlaget är source.id, så samma faktura,
 * kvitto eller banktransaktion får inte ligga bakom två verifikationer:
 * dubbelbokföringen syns annars som dubbla kostnader och dubbel moms.
 * Manuella verifikationer har inget underlag i systemet och kontrolleras inte.
 */
export function checkOneVerificationPerSource(data: DB): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const perSource = new Map<string, Verification[]>();
  for (const v of data.verifications) {
    if (KALLOR_MED_FLERA_VERIFIKATIONER.includes(v.source.type)) continue;
    const key = sourceKey(v.source);
    if (!key) continue;
    const list = perSource.get(key);
    if (list) list.push(v);
    else perSource.set(key, [v]);
  }
  for (const [key, list] of [...perSource.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.number - b.number);
    violations.push({
      invariant: "ett_underlag_en_verifikation",
      severity: "brott",
      message: `Underlaget ${key} har ${sorted.length} verifikationer: ${sorted.map((v) => `${label(v)} ${v.description}`).join(", ")}.`,
      verificationIds: sorted.map((v) => v.id),
    });
  }
  return violations;
}

/* ------------------------------ Registret ------------------------------- */

export const INVARIANTS: Invariant[] = [
  {
    key: "verifikation_balanserar",
    label: "Varje verifikation har debet lika med kredit",
    check: checkBalancedVerifications,
  },
  {
    key: "nummerserie_obruten",
    label: "Verifikationsnumren är obrutna per serie och ligger i rätt räkenskapsår",
    check: checkVerificationNumbering,
  },
  {
    key: "bokford_verifikation_oforandrad",
    label: "Ingen bokförd verifikation har ändrats efter bokföringen",
    check: checkPostedVerificationsUnchanged,
  },
  {
    key: "momsrutor_mot_momskonton",
    label: "Momsens rutor för en period stämmer med rörelserna på momskontona",
    check: checkVatBoxesAgainstVatAccounts,
  },
  {
    key: "skattekonto_harleds_ur_rorelserna",
    label: "Saldot på 1630 är ingående balans plus rörelserna via skattekontot och banken",
    check: checkTaxAccountBalance,
  },
  {
    key: "last_period_oforandrad",
    label: "En låst period har inte fått nya verifikationer efter att låset sattes",
    check: checkLockedPeriodsUnchanged,
  },
  {
    key: "balansrapporten_balanserar",
    label: "Tillgångar är lika med eget kapital plus beräknat resultat plus skulder",
    check: checkBalanceSheetBalances,
  },
  {
    key: "ett_underlag_en_verifikation",
    label: "Varje underlag har högst en verifikation",
    check: checkOneVerificationPerSource,
  },
];

export function invariantLabel(key: InvariantKey): string {
  return INVARIANTS.find((i) => i.key === key)?.label ?? key;
}

/** Kör alla invarianter (eller ett urval) mot ett laddat tillstånd. */
export function checkInvariants(data: DB, opts?: { only?: InvariantKey[] }): InvariantReport {
  const perInvariant = {} as Record<InvariantKey, InvariantViolation[]>;
  const violations: InvariantViolation[] = [];
  for (const invariant of INVARIANTS) {
    const skaKoras = !opts?.only || opts.only.includes(invariant.key);
    const found = skaKoras ? invariant.check(data) : [];
    perInvariant[invariant.key] = found;
    violations.push(...found);
  }
  const brott = violations.filter((v) => v.severity === "brott");
  return {
    violations,
    brott,
    ejVerifierbara: violations.filter((v) => v.severity === "ej_verifierbar"),
    perInvariant,
    ok: brott.length === 0,
  };
}
