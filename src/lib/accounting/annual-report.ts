import { db, save } from "../store";
import { uid } from "../ids";
import type {
  AnnualReport,
  AnnualReportCertification,
  AnnualReportContent,
  AnnualReportSignatory,
  FiscalYear,
  MultiYearRow,
  ReportRow,
} from "../types";
import { fiscalYears, getFiscalYear } from "./fiscal";
import { resultatrapport, balansrapport, saldobalans, type Resultatrapport } from "./ledger";
import { accountSection } from "./chart";
import { logAudit } from "./audit";
import { kr } from "../format";
import { payrollRuns } from "./payroll";

/**
 * Årsredovisning för mindre aktiebolag enligt K2 (BFNAR 2016:10).
 *
 * Alla SIFFROR kommer ur motorn: resultat- och balansräkningen byggs ur det
 * stängda årets saldobalans, jämförelsetalen ur föregående års, och
 * flerårsöversikten ur varje års egna siffror. Klassificeringen följer kontots
 * K2-post i kontoregistret, inte dess nummerintervall – ett eget konto hamnar
 * därför rätt utan specialfall.
 *
 * TEXTERNA är utkast. Förvaltningsberättelsen, underskrifterna och
 * fastställelseintyget är påståenden om bolaget som bara bolaget kan göra, så
 * de går att redigera fram till att rapporten signeras.
 *
 * Ingen inlämning sker: statusen "inlamnad_markerad" är en manuell markering
 * med audit trail – aldrig ett påstående om att Bolagsverket tagit emot något.
 */

export function annualReportFor(fiscalYearId: string): AnnualReport | undefined {
  return db().annualReports.find((r) => r.fiscalYearId === fiscalYearId);
}

/* ----------------------------- Resultaträkning ----------------------------- */

/**
 * K2:s kostnadsslagsindelade uppställning. Rörelseresultat, resultat efter
 * finansiella poster och resultat före skatt är TRE OLIKA tal: de skiljer sig
 * med de finansiella posterna respektive bokslutsdispositionerna. Ett bolag med
 * banklån eller periodiseringsfond ser skillnaden direkt.
 */
/**
 * Noterna refereras med nyckel, inte med ett nummer i koden. Numret sätts när
 * det är avgjort VILKA noter årsredovisningen har – en not som utelämnas för
 * att bolaget saknar inventarier får annars lämna ett hål i numreringen och en
 * upphöjd siffra i uppställningen som pekar på ingenting.
 */
type NoteKey = "principer" | "anstallda" | "inventarier" | "obeskattade";

/** Notnummer per nyckel, eller undefined när noten inte finns i rapporten. */
type NoteNumbers = (key: NoteKey) => number | undefined;

function resultatrakningRows(rr: Resultatrapport, prior: Resultatrapport | undefined, noteFor: NoteNumbers): ReportRow[] {
  const rows: ReportRow[] = [];
  const row = (label: string, pick: (r: Resultatrapport) => number, opts: { bold?: boolean; note?: number } = {}) => {
    const amount = pick(rr);
    const priorAmount = prior ? pick(prior) : undefined;
    // Nollrader utan jämförelsetal säger ingenting och tas bort. En post som
    // fanns förra året står kvar med 0, annars ser det ut som att den försvann.
    if (amount === 0 && !priorAmount && !opts.bold) return;
    rows.push({ label, amount, prior: priorAmount, ...opts });
  };

  const bySection = (r: Resultatrapport, sections: string[], sign: 1 | -1) =>
    sign *
    [...r.intakter, ...r.kostnader, ...r.avskrivningar]
      .filter((line) => sections.includes(accountSection(line.account)))
      .reduce((s, line) => s + line.amount, 0);

  row("Nettoomsättning", (r) => bySection(r, ["nettoomsattning"], 1), { note: noteFor("principer") });
  row("Övriga rörelseintäkter", (r) => bySection(r, ["ovriga_rorelseintakter"], 1));
  row("Råvaror och förnödenheter", (r) => bySection(r, ["ravaror_och_fornodenheter"], -1));
  row("Övriga externa kostnader", (r) => bySection(r, ["ovriga_externa_kostnader"], -1));
  row("Personalkostnader", (r) => bySection(r, ["personalkostnader"], -1), { note: noteFor("anstallda") });
  row("Avskrivningar av materiella anläggningstillgångar", (r) => bySection(r, ["avskrivningar"], -1), {
    note: noteFor("inventarier"),
  });
  row("Övriga rörelsekostnader", (r) => bySection(r, ["ovriga_rorelsekostnader"], -1));
  row("Rörelseresultat", (r) => r.rorelseresultat, { bold: true });

  row("Ränteintäkter och liknande resultatposter", (r) => r.finansiellaIntakter.reduce((s, l) => s + l.amount, 0));
  row("Räntekostnader och liknande resultatposter", (r) => -r.finansiellaKostnader.reduce((s, l) => s + l.amount, 0));
  row("Resultat efter finansiella poster", (r) => r.resultatEfterFinansiellaPoster, { bold: true });

  row("Bokslutsdispositioner", (r) => r.bokslutsdispositionerNetto, { note: noteFor("obeskattade") });
  row("Resultat före skatt", (r) => r.resultatForeSkatt, { bold: true });
  row("Skatt på årets resultat", (r) => -r.skatt);
  row("Årets resultat", (r) => r.resultat, { bold: true });
  return rows;
}

/**
 * Noterna K2 kräver, i uppställningsordning. Numret sätts efter filtreringen,
 * så en utelämnad not aldrig lämnar ett hål i numreringen och de upphöjda
 * hänvisningarna i uppställningarna alltid pekar på en not som finns.
 */
function buildNotes(f: {
  medelantal: number;
  personalkostnader: number;
  avskrivningar: number;
  inventarier: number;
  obeskattadeReserver: number;
  bokslutsdispositioner: number;
}): { key: NoteKey; number: number; title: string; body: string }[] {
  const candidates: { key: NoteKey; title: string; body: string; include: boolean }[] = [
    {
      key: "principer",
      title: "Redovisningsprinciper",
      body: "Årsredovisningen är upprättad i enlighet med årsredovisningslagen och Bokföringsnämndens allmänna råd BFNAR 2016:10 (K2). Intäkter redovisas när fakturering skett. Fordringar tas upp till det belopp som beräknas inflyta. Belopp anges i hela kronor.",
      include: true,
    },
    {
      key: "anstallda",
      title: "Medelantal anställda",
      body:
        f.medelantal > 0
          ? `Medelantalet anställda under räkenskapsåret uppgick till ${f.medelantal.toLocaleString("sv-SE")}. Personalkostnaderna uppgick till ${kr(f.personalkostnader)}.`
          : "Bolaget har inte haft några anställda under räkenskapsåret. Medelantalet anställda är därmed 0.",
      // Noten lämnas inte ut när bolaget saknar anställda: att den saknas läses
      // som ett förbiseende, medan en nolla är ett svar.
      include: true,
    },
    {
      key: "inventarier",
      title: "Inventarier, verktyg och installationer",
      body: `Inventarier skrivs av linjärt över nyttjandeperioden. Årets avskrivningar uppgår till ${kr(f.avskrivningar)}. Redovisat värde vid årets slut: ${kr(f.inventarier)}.`,
      include: f.inventarier !== 0 || f.avskrivningar !== 0,
    },
    {
      key: "obeskattade",
      title: "Obeskattade reserver",
      body: `Periodiseringsfonder uppgår vid årets slut till ${kr(f.obeskattadeReserver)}. Av detta utgör ${kr(Math.round(f.obeskattadeReserver * 0.206))} uppskjuten skatt, som betalas när fonden återförs. Varje avsättning ska återföras senast sjätte året efter avsättningsåret.`,
      include: f.obeskattadeReserver !== 0 || f.bokslutsdispositioner !== 0,
    },
  ];

  return candidates
    .filter((c) => c.include)
    .map((c, i) => ({ key: c.key, number: i + 1, title: c.title, body: c.body }));
}

/* ------------------------------ Balansräkning ------------------------------ */

interface SectionSum {
  section: string;
  label: string;
  note?: NoteKey;
}

const TILLGANG_SECTIONS: SectionSum[] = [
  { section: "immateriella_anlaggningstillgangar", label: "Immateriella anläggningstillgångar" },
  { section: "materiella_anlaggningstillgangar", label: "Inventarier, verktyg och installationer", note: "inventarier" },
  { section: "finansiella_anlaggningstillgangar", label: "Finansiella anläggningstillgångar" },
  { section: "varulager", label: "Varulager" },
  { section: "kortfristiga_fordringar", label: "Kortfristiga fordringar" },
  { section: "kassa_och_bank", label: "Kassa och bank" },
];

const SKULD_SECTIONS: SectionSum[] = [
  { section: "obeskattade_reserver", label: "Obeskattade reserver", note: "obeskattade" },
  { section: "avsattningar", label: "Avsättningar" },
  { section: "langfristiga_skulder", label: "Långfristiga skulder" },
  { section: "kortfristiga_skulder", label: "Kortfristiga skulder" },
];

/** Utgående saldo per K2-post. Tecknet följer rapportens läsart. */
function sectionBalances(atDate: string, from: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of saldobalans({ from, to: atDate }).rows) {
    if (r.ub === 0) continue;
    const section = accountSection(r.account);
    // Tillgångar läses debetpositivt, eget kapital och skulder kreditpositivt.
    const sign = section.endsWith("_eget_kapital") || SKULD_SECTIONS.some((s) => s.section === section) ? -1 : 1;
    out.set(section, (out.get(section) ?? 0) + sign * r.ub);
  }
  return out;
}

/* -------------------------- Medelantal anställda --------------------------- */

/**
 * Medelantalet anställda under räkenskapsåret (ÅRL 5:20, K2 punkt 18.6).
 *
 * Räknas som antalet avlönade månader dividerat med antalet månader i året:
 * en anställd som fått lön hela året blir 1,0, en som anställdes i juli blir
 * 0,5. Bolaget lönekör en gång per månad och anställd, så lönekörningarna ÄR
 * underlaget – ingen separat tidrapportering behövs.
 */
export function averageEmployees(fy: FiscalYear): number {
  const months = new Set<string>();
  let paidMonths = 0;
  for (const run of payrollRuns()) {
    const date = `${run.month}-01`;
    if (date < fy.startDate.slice(0, 7) + "-01" || date > fy.endDate) continue;
    months.add(run.month);
    paidMonths += 1;
  }
  const monthsInYear = monthsBetween(fy.startDate, fy.endDate);
  if (monthsInYear === 0) return 0;
  return Math.round((paidMonths / monthsInYear) * 10) / 10;
}

function monthsBetween(from: string, to: string): number {
  const a = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7));
  const b = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7));
  return b - a + 1;
}

/* --------------------------- Flerårsöversikt ------------------------------- */

/**
 * Flerårsöversikt enligt ÅRL 6:1: nettoomsättning, resultat och soliditet för
 * innevarande och de tre föregående åren. Varje års tal räknas ur det årets
 * egen bokföring – aldrig ur årets siffror med förra årets etikett.
 */
export function multiYearOverview(fy: FiscalYear, years = 4): MultiYearRow[] {
  const all = fiscalYears()
    .filter((f) => f.endDate <= fy.endDate)
    .sort((a, b) => b.endDate.localeCompare(a.endDate))
    .slice(0, years);
  return all.map((f) => {
    const rr = resultatrapport({ from: f.startDate, to: f.endDate });
    const br = balansrapport(f.endDate);
    return {
      label: f.label,
      nettoomsattning: rr.omsattning,
      resultatEfterFinansiella: rr.resultatEfterFinansiellaPoster,
      soliditetProcent: br.sumTillgangar > 0 ? Math.round((br.sumEgetKapital / br.sumTillgangar) * 100) : 0,
      // Ett år som inte är stängt bär inte fastställda siffror.
      ...(f.status === "stangt" ? {} : { ofullstandig: true as const }),
    };
  });
}

/* ------------------------------ Underskrifter ------------------------------ */

/**
 * Årsredovisningen skrivs under av samtliga styrelseledamöter och av VD
 * (ÅRL 2:7). Driva känner bara företagsledaren ur löneregistret, så förslaget
 * är en utgångspunkt användaren fyller på – styrelsen är inte en uppgift
 * bokföringen kan gissa.
 */
export function defaultSignatories(): AnnualReportSignatory[] {
  const leaders = (db().employees ?? [])
    .filter((e) => e.role === "foretagsledare")
    .map((e) => ({ name: e.name, role: "Styrelseledamot" }));
  return leaders.length > 0 ? leaders : [{ name: "", role: "Styrelseledamot" }];
}

/* -------------------------------- Generering ------------------------------- */

export function generateAnnualReport(fiscalYearId: string, by: "anvandare" | "assistent"): AnnualReport {
  const data = db();
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) throw new Error("Räkenskapsåret finns inte.");
  if (data.settings.companyForm === "enskild") {
    throw new Error(
      "Enskild firma upprättar normalt ingen årsredovisning – bara ett förenklat årsbokslut. Detta stöds inte automatiskt ännu."
    );
  }
  if (fy.status !== "stangt") {
    throw new Error(
      `Räkenskapsåret ${fy.label} är inte stängt ännu. Gör klart bokslutet först – årsredovisningen bygger på de fastställda siffrorna.`
    );
  }

  const existing = annualReportFor(fiscalYearId);
  if (existing) return existing;

  const previous = previousYear(fy);
  const rr = resultatrapport({ from: fy.startDate, to: fy.endDate });
  const priorRr = previous ? resultatrapport({ from: previous.startDate, to: previous.endDate }) : undefined;
  const br = balansrapport(fy.endDate);
  const priorBr = previous ? balansrapport(previous.endDate) : undefined;

  const sections = sectionBalances(fy.endDate, fy.startDate);
  const priorSections = previous ? sectionBalances(previous.endDate, previous.startDate) : undefined;

  const medelantal = averageEmployees(fy);
  const personalkostnader = rr.kostnader
    .filter((l) => accountSection(l.account) === "personalkostnader")
    .reduce((s, l) => s + l.amount, 0);
  const avskrivningar = rr.avskrivningar.reduce((s, l) => s + l.amount, 0);
  const inventarier = sections.get("materiella_anlaggningstillgangar") ?? 0;
  const obeskattadeReserver = sections.get("obeskattade_reserver") ?? 0;

  const noter = buildNotes({
    medelantal,
    personalkostnader,
    avskrivningar,
    inventarier,
    obeskattadeReserver,
    bokslutsdispositioner: rr.bokslutsdispositionerNetto,
  });
  const noteFor: NoteNumbers = (key) => noter.find((n) => n.key === key)?.number;

  const balansrakningTillgangar = balanceRows(TILLGANG_SECTIONS, sections, priorSections, noteFor, {
    label: "Summa tillgångar",
    amount: br.sumTillgangar,
    prior: priorBr?.sumTillgangar,
  });

  const aktiekapital = -sumAccounts(fy, 2081, 2089);
  const balanserat = -sumAccounts(fy, 2090, 2098);
  const aretsResultat = -sumAccounts(fy, 2099, 2099);
  const egetKapitalRows: ReportRow[] = [
    { label: "Aktiekapital", amount: aktiekapital, prior: previous ? -sumAccounts(previous, 2081, 2089) : undefined },
    { label: "Balanserat resultat", amount: balanserat, prior: previous ? -sumAccounts(previous, 2090, 2098) : undefined },
    { label: "Årets resultat", amount: aretsResultat, prior: previous ? -sumAccounts(previous, 2099, 2099) : undefined },
    { label: "Summa eget kapital", amount: br.sumEgetKapital, prior: priorBr?.sumEgetKapital, bold: true },
  ];
  const balansrakningEgetKapitalSkulder = [
    ...egetKapitalRows,
    ...balanceRows(SKULD_SECTIONS, sections, priorSections, noteFor),
    {
      label: "Summa eget kapital och skulder",
      amount: br.sumEgetKapital + br.sumSkulder,
      prior: priorBr ? priorBr.sumEgetKapital + priorBr.sumSkulder : undefined,
      bold: true,
    },
  ];

  const tillForfogande = balanserat + aretsResultat;

  const content: AnnualReportContent = {
    companyName: data.settings.name,
    orgNumber: data.settings.orgNumber,
    fiscalLabel: fy.label,
    periodStart: fy.startDate,
    periodEnd: fy.endDate,
    sate: data.settings.sate || data.settings.city,
    forvaltningsberattelse: {
      verksamhet: `${data.settings.name} bedriver hantverks- och tjänsteverksamhet. Bolaget har sitt säte i ${data.settings.sate || data.settings.city}. (Utkast – granska och justera texten.)`,
      vasentligaHandelser:
        "Inga väsentliga händelser utöver den löpande verksamheten har inträffat under räkenskapsåret. (Utkast – granska och justera texten.)",
      flerarsoversikt: multiYearOverview(fy),
      egetKapitalForandring: [
        ...(previous
          ? [
              {
                label: `Belopp vid årets ingång`,
                aktiekapital: -sumAccounts(previous, 2081, 2089),
                balanseratResultat: -sumAccounts(previous, 2090, 2098),
                aretsResultat: -sumAccounts(previous, 2099, 2099),
                summa: priorBr?.sumEgetKapital ?? 0,
              },
            ]
          : []),
        {
          label: "Belopp vid årets utgång",
          aktiekapital,
          balanseratResultat: balanserat,
          aretsResultat,
          summa: br.sumEgetKapital,
        },
      ],
      resultatdisposition: { tillForfogande, balanserasINyRakning: tillForfogande },
    },
    resultatrakning: resultatrakningRows(rr, priorRr, noteFor),
    balansrakningTillgangar,
    balansrakningEgetKapitalSkulder,
    noter,
    underskrifter: defaultSignatories(),
    fastallelseintyg: {},
  };

  const report: AnnualReport = {
    id: uid(),
    fiscalYearId,
    status: "genererad",
    content,
    generatedAt: new Date().toISOString(),
  };
  data.annualReports.push(report);
  logAudit(by, "arsredovisning_genererad", `Årsredovisning för ${fy.label} genererades ur bokslutet.`, {
    targetType: "arsredovisning",
    targetId: report.id,
  });
  save();
  return report;
}

function balanceRows(
  spec: SectionSum[],
  sections: Map<string, number>,
  prior: Map<string, number> | undefined,
  noteFor: NoteNumbers,
  total?: ReportRow
): ReportRow[] {
  const rows: ReportRow[] = [];
  for (const s of spec) {
    const amount = sections.get(s.section) ?? 0;
    const priorAmount = prior?.get(s.section);
    if (amount === 0 && !priorAmount) continue;
    rows.push({
      label: s.label,
      amount,
      prior: prior ? (priorAmount ?? 0) : undefined,
      note: s.note ? noteFor(s.note) : undefined,
    });
  }
  if (total) rows.push({ ...total, bold: true });
  return rows;
}

function previousYear(fy: FiscalYear): FiscalYear | undefined {
  return fiscalYears()
    .filter((f) => f.endDate < fy.startDate)
    .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
}

function sumAccounts(fy: FiscalYear, from: number, to: number): number {
  return saldobalans({ from: fy.startDate, to: fy.endDate })
    .rows.filter((r) => r.account >= from && r.account <= to)
    .reduce((s, r) => s + r.ub, 0);
}

/* -------------------------------- Redigering ------------------------------- */

export interface AnnualReportEdit {
  verksamhet?: string;
  vasentligaHandelser?: string;
  /** Utdelning stämman föreslås besluta om. Resten balanseras i ny räkning. */
  utdelning?: number;
  underskrifter?: AnnualReportSignatory[];
  fastallelseintyg?: AnnualReportCertification;
}

/**
 * Redigera det som är bolagets påstående, inte motorns räkning.
 *
 * Siffrorna går aldrig att ändra här – de kommer ur den stängda bokföringen och
 * en årsredovisning som säger något annat än böckerna vore en osanning. Efter
 * att rapporten signerats är också texten låst: den är då underskriven.
 */
export function updateAnnualReport(reportId: string, edit: AnnualReportEdit, by: "anvandare"): AnnualReport {
  const report = db().annualReports.find((r) => r.id === reportId);
  if (!report) throw new Error("Årsredovisningen finns inte.");
  if (report.status === "signerad" || report.status === "inlamnad_markerad") {
    throw new Error(
      "Årsredovisningen är signerad och kan inte ändras. Skapa en ny årsredovisning om något är fel – den signerade versionen står kvar."
    );
  }

  const fb = report.content.forvaltningsberattelse;
  if (edit.verksamhet !== undefined) fb.verksamhet = edit.verksamhet.trim();
  if (edit.vasentligaHandelser !== undefined) fb.vasentligaHandelser = edit.vasentligaHandelser.trim();

  if (edit.utdelning !== undefined) {
    const utdelning = Math.max(0, Math.round(edit.utdelning));
    if (utdelning > fb.resultatdisposition.tillForfogande) {
      throw new Error(
        `Utdelningen kan inte överstiga det som står till stämmans förfogande (${kr(fb.resultatdisposition.tillForfogande)}).`
      );
    }
    fb.resultatdisposition.utdelning = utdelning || undefined;
    fb.resultatdisposition.balanserasINyRakning = fb.resultatdisposition.tillForfogande - utdelning;
  }

  if (edit.underskrifter) {
    const cleaned = edit.underskrifter
      .map((s) => ({ ...s, name: s.name.trim(), role: s.role.trim() }))
      .filter((s) => s.name !== "");
    if (cleaned.length === 0) {
      throw new Error("Årsredovisningen skrivs under av styrelsen – minst en person måste anges.");
    }
    report.content.underskrifter = cleaned;
  }

  if (edit.fastallelseintyg) {
    report.content.fastallelseintyg = { ...report.content.fastallelseintyg, ...edit.fastallelseintyg };
  }

  logAudit(by, "arsredovisning_andrad", `Årsredovisningen för ${report.content.fiscalLabel} ändrades.`, {
    targetType: "arsredovisning",
    targetId: report.id,
  });
  save();
  return report;
}

/* ---------------------------------- Status --------------------------------- */

const STATUS_ORDER: AnnualReport["status"][] = ["genererad", "granskad", "signerad", "inlamnad_markerad"];

/**
 * Vad som måste vara ifyllt innan nästa steg kan tas. Att signera en
 * årsredovisning utan underskrifter, eller markera den som inlämnad utan
 * fastställelseintyg, vore att påstå något som inte hänt.
 */
export function annualReportBlockers(report: AnnualReport, to: AnnualReport["status"]): string[] {
  const out: string[] = [];
  const content = report.content;
  if (to === "signerad") {
    const signatories = content.underskrifter ?? [];
    if (signatories.length === 0 || signatories.every((s) => !s.name.trim())) {
      out.push("Ange vilka som skriver under – årsredovisningen skrivs under av samtliga styrelseledamöter och av VD.");
    }
  }
  if (to === "inlamnad_markerad") {
    const intyg = content.fastallelseintyg;
    if (!intyg?.stammaDate) {
      out.push("Ange datumet för årsstämman. Fastställelseintyget bestyrker att stämman fastställde räkningarna.");
    }
    if (!intyg?.certifiedByName?.trim()) {
      out.push("Ange vem som bestyrker kopian – en styrelseledamot eller den verkställande direktören.");
    }
  }
  return out;
}

export function advanceAnnualReportStatus(reportId: string, to: AnnualReport["status"], by: "anvandare"): AnnualReport {
  const report = db().annualReports.find((r) => r.id === reportId);
  if (!report) throw new Error("Årsredovisningen finns inte.");
  const fromIdx = STATUS_ORDER.indexOf(report.status);
  const toIdx = STATUS_ORDER.indexOf(to);
  if (toIdx !== fromIdx + 1)
    throw new Error("Stegen tas i ordning: genererad → granskad → signerad → markerad som inlämnad.");
  const blockers = annualReportBlockers(report, to);
  if (blockers.length > 0) throw new Error(blockers.join(" "));

  report.status = to;
  const now = new Date().toISOString();
  if (to === "granskad") report.reviewedAt = now;
  if (to === "signerad") {
    report.signedAt = now;
    // Underskriftsdatumet hör till dokumentet, inte till loggen: det står på
    // den utskrivna årsredovisningen och måste därför sparas i innehållet.
    const date = now.slice(0, 10);
    report.content.underskrifter = (report.content.underskrifter ?? []).map((s) => ({
      ...s,
      signedAt: s.signedAt ?? date,
      place: s.place ?? report.content.sate,
    }));
  }
  if (to === "inlamnad_markerad") report.markedFiledAt = now;
  logAudit(
    by,
    "arsredovisning_status",
    `Årsredovisningen markerades som ${to === "inlamnad_markerad" ? "inlämnad (egen markering – Driva skickar inget till Bolagsverket)" : to}.`,
    { targetType: "arsredovisning", targetId: report.id }
  );
  save();
  return report;
}

/** Stängda räkenskapsår – kandidater för årsredovisning. */
export function annualReportCandidates(): FiscalYear[] {
  return db().fiscalYears.filter((f) => f.status === "stangt");
}
