import { db } from "../store";
import type { AnnualReport, AnnualReportContent, ReportRow } from "../types";
import { fiscalYears } from "./fiscal";
import { escapeXml, FilingDataError, orgNumber10 } from "./filing-format";

/**
 * Årsredovisningen som iXBRL enligt Bolagsverkets K2-taxonomi.
 *
 * Filen är ett XHTML-dokument som både går att läsa som en årsredovisning och
 * att maskinläsa: varje siffra och varje text som betyder något bär en
 * inline-XBRL-tagg med taxonomins begrepp. Den laddas upp i Bolagsverkets
 * e-tjänst "Lämna in årsredovisningen digitalt", som validerar och sedan låter
 * en företrädare skriva under med BankID. Driva lämnar inte in någonting.
 *
 * Reglerna kommer från Bolagsverkets "Tillämpningsanvisning för
 * årsredovisningar i iXBRL-format" (TA) och taxonomier.se:
 *
 * - iXBRL 1.1, giltig XHTML, UTF-8, ett instansdokument per fil (TA 3.1–3.3).
 * - Inga script, inga externa referenser, all CSS i dokumentet (TA 3.4, 3.7).
 * - Inlämning av enbart årsredovisning: kontexten får varken segment eller
 *   scenario (TA 2.3.1). Segmenten behövs först i en koncernredovisning.
 * - Belopp i hela kronor: decimals "INF" och scale "0" (TA 2.9.2). Negativa
 *   belopp skrivs med attributet sign (TA 2.9.6).
 * - Kontexterna heter period0/balans0 för året och period1/balans1 för
 *   jämförelseåret (TA 2.15.5, 2.15.7).
 * - Samma begrepp i samma kontext måste bära samma värde (TA 2.6.1). Därför
 *   taggas t.ex. personalkostnaderna i noten inte om noten skriver dem med
 *   annat tecken än resultaträkningen.
 *
 * Det som inte går att tagga tigs inte bort: `warnings` säger vad som lämnades
 * otaggat, så användaren vet vad Bolagsverkets validering kan invända mot.
 */

/* ------------------------------- Taxonomin -------------------------------- */

/**
 * Rapporttaxonomin: årsredovisning för aktiebolag med resultaträkning och
 * balansräkning (uppställningsform "risbs"). Driva upprättar aldrig en
 * förkortad uppställning, så det är den enda ingången som behövs.
 */
const AR_SCHEMA = "http://xbrl.taxonomier.se/se/fr/gaap/k2-all/ab/risbs/2024-09-12/se-k2-ab-risbs-2024-09-12.xsd";

/** Fastställelseintyget är en egen rapporttaxonomi och tas bara med när intyget finns. */
const INTYG_SCHEMA = "http://xbrl.taxonomier.se/se/fr/gaap/coa/rplc/2020-12-01/se-coa-rplc-2020-12-01.xsd";

/**
 * Prefix → namnrymd. K2-generationen 2024-09-12 använder fortfarande
 * baskoncepten från 2021-10-31. Namnrymder som inte används skrivs inte ut
 * (TA 2.16.1), så listan hålls till dem den här filen faktiskt taggar med.
 */
const NAMESPACES: Record<string, string> = {
  ix: "http://www.xbrl.org/2013/inlineXBRL",
  xbrli: "http://www.xbrl.org/2003/instance",
  link: "http://www.xbrl.org/2003/linkbase",
  xlink: "http://www.w3.org/1999/xlink",
  ixt: "http://www.xbrl.org/inlineXBRL/transformation/2010-04-20",
  iso4217: "http://www.xbrl.org/2003/iso4217",
  "se-gen-base": "http://www.taxonomier.se/se/fr/gen-base/2021-10-31",
  "se-cd-base": "http://www.taxonomier.se/se/fr/cd-base/2021-10-31",
  "se-mem-base": "http://www.taxonomier.se/se/fr/mem-base/2021-10-31",
  "se-bol-base": "http://www.bolagsverket.se/se/fr/comp-base/2020-12-01",
  "se-k2type": "http://www.taxonomier.se/se/fr/k2/datatype",
};

/**
 * Begrepp som inte ligger i se-gen-base. Företagsuppgifterna och vallistorna
 * hör till de gemensamma dokumentbegreppen (se-cd-base) och
 * fastställelseintyget till Bolagsverkets egen taxonomi (se-bol-base).
 */
const PREFIX_BY_CONCEPT: Record<string, string> = {
  ForetagetsNamn: "se-cd-base",
  Organisationsnummer: "se-cd-base",
  RakenskapsarForstaDag: "se-cd-base",
  RakenskapsarSistaDag: "se-cd-base",
  SprakHandlingUpprattadList: "se-cd-base",
  LandForetagetsSateList: "se-cd-base",
  RedovisningsvalutaHandlingList: "se-cd-base",
  BeloppsformatList: "se-cd-base",
  FinansiellRapportList: "se-cd-base",
  ArsstammaIntygande: "se-bol-base",
  FaststallelseResultatBalansrakning: "se-bol-base",
  Arsstamma: "se-bol-base",
  ArsstammaResultatDispositionGodkannaStyrelsensForslag: "se-bol-base",
  IntygandeOriginalInnehall: "se-bol-base",
  UnderskriftFaststallelseintygForetradareTilltalsnamn: "se-bol-base",
  UnderskriftFaststallelseintygForetradareEfternamn: "se-bol-base",
  UnderskriftFaststallelseintygForetradareForetradarroll: "se-bol-base",
  UnderskriftFastallelseintygDatum: "se-bol-base",
};

function qname(concept: string): string {
  return `${PREFIX_BY_CONCEPT[concept] ?? "se-gen-base"}:${concept}`;
}

/**
 * Resultaträkningens rader → taxonomibegrepp. Nyckeln är radens etikett i
 * årsredovisningen: uppställningen byggs av Driva och etiketterna är därför
 * kända, men en rad som byter namn tappar sin tagg och hamnar i `warnings`
 * i stället för att tystna.
 */
export const RESULTAT_CONCEPT: Record<string, string> = {
  Nettoomsättning: "Nettoomsattning",
  "Övriga rörelseintäkter": "OvrigaRorelseintakter",
  "Råvaror och förnödenheter": "RavarorFornodenheterKostnader",
  "Övriga externa kostnader": "OvrigaExternaKostnader",
  Personalkostnader: "Personalkostnader",
  "Avskrivningar av materiella anläggningstillgångar":
    "AvskrivningarNedskrivningarMateriellaImmateriellaAnlaggningstillgangar",
  "Övriga rörelsekostnader": "OvrigaRorelsekostnader",
  Rörelseresultat: "Rorelseresultat",
  "Ränteintäkter och liknande resultatposter": "OvrigaRanteintakterLiknandeResultatposter",
  "Räntekostnader och liknande resultatposter": "RantekostnaderLiknandeResultatposter",
  "Resultat efter finansiella poster": "ResultatEfterFinansiellaPoster",
  Bokslutsdispositioner: "Bokslutsdispositioner",
  "Resultat före skatt": "ResultatForeSkatt",
  "Skatt på årets resultat": "SkattAretsResultat",
  "Årets resultat": "AretsResultat",
};

/** Balansräkningens rader → taxonomibegrepp. Posterna är K2:s summanivå. */
export const BALANS_CONCEPT: Record<string, string> = {
  "Immateriella anläggningstillgångar": "ImmateriellaAnlaggningstillgangar",
  "Inventarier, verktyg och installationer": "InventarierVerktygInstallationer",
  "Finansiella anläggningstillgångar": "FinansiellaAnlaggningstillgangar",
  Varulager: "VarulagerMm",
  "Kortfristiga fordringar": "KortfristigaFordringar",
  "Kassa och bank": "KassaBank",
  "Summa tillgångar": "Tillgangar",
  Aktiekapital: "Aktiekapital",
  "Balanserat resultat": "BalanseratResultat",
  "Årets resultat": "AretsResultatEgetKapital",
  "Summa eget kapital": "EgetKapital",
  "Obeskattade reserver": "ObeskattadeReserver",
  Avsättningar: "Avsattningar",
  "Långfristiga skulder": "LangfristigaSkulder",
  "Kortfristiga skulder": "KortfristigaSkulder",
  "Summa eget kapital och skulder": "EgetKapitalSkulder",
};

/* ------------------------------ Faktabyggaren ------------------------------ */

interface Context {
  id: string;
  start?: string;
  instant?: string;
  end?: string;
}

/** Faktumets plats i en tuple: vilken rad, och i vilken ordning (TA 2.4.11). */
interface TupleRef {
  id: string;
  order: string;
}

function tupleAttrs(tuple: TupleRef | undefined): string {
  return tuple ? ` tupleRef="${tuple.id}" order="${tuple.order}"` : "";
}

type UnitId = "SEK" | "procent" | "antal-anstallda";

/**
 * Samlar kontexter, enheter och dolda fakta medan dokumentet skrivs, och
 * lämnar tillbaka XHTML-fragmenten för varje faktum. Kontexterna registreras
 * när de används, så ett dokument utan jämförelseår inte får en tom period1.
 */
class FactWriter {
  private readonly contexts = new Map<string, Context>();
  private readonly units = new Set<UnitId>();
  private readonly hidden: string[] = [];
  readonly warnings: string[] = [];

  constructor(private readonly orgNr: string) {}

  duration(id: string, start: string, end: string): string {
    this.contexts.set(id, { id, start, end });
    return id;
  }

  instant(id: string, date: string): string {
    this.contexts.set(id, { id, instant: date });
    return id;
  }

  /**
   * Kontexten för en period respektive en balansdag, återanvänd när den redan
   * finns. Flerårsöversikten går längre bak än jämförelseåret och namnger inte
   * sina kontexter själv: två år får aldrig dela id, och samma år får aldrig
   * två kontexter (TA 2.3.1).
   */
  durationFor(start: string, end: string): string {
    for (const c of this.contexts.values()) if (c.start === start && c.end === end) return c.id;
    return this.duration(`period${this.freeIndex("period")}`, start, end);
  }

  instantFor(date: string): string {
    for (const c of this.contexts.values()) if (c.instant === date) return c.id;
    return this.instant(`balans${this.freeIndex("balans")}`, date);
  }

  private freeIndex(prefix: string): number {
    let n = 0;
    while (this.contexts.has(`${prefix}${n}`)) n++;
    return n;
  }

  /**
   * Belopp i hela kronor. Talet skrivs som läsaren ser det – med tusenmellanslag
   * och utan minustecken – och tecknet bärs av attributet sign (TA 2.9.6).
   */
  money(concept: string, contextRef: string, amount: number): string {
    this.units.add("SEK");
    const rounded = Math.round(amount);
    return this.nonFraction(concept, contextRef, "SEK", groupDigits(Math.abs(rounded)), {
      decimals: "INF",
      scale: "0",
      sign: rounded < 0 ? "-" : undefined,
    });
  }

  /** Procenttal. Värdet skrivs i procent och scale –2 gör om det till en andel (TA 2.11.1). */
  percent(concept: string, contextRef: string, value: number): string {
    this.units.add("procent");
    return this.nonFraction(concept, contextRef, "procent", groupDigits(Math.abs(value)), {
      decimals: "2",
      scale: "-2",
      sign: value < 0 ? "-" : undefined,
    });
  }

  /** Medelantal anställda: eget enhetsbegrepp med en decimal (TA 2.13.1, 2.15.4). */
  antalAnstallda(concept: string, contextRef: string, value: number): string {
    this.units.add("antal-anstallda");
    return this.nonFraction(concept, contextRef, "antal-anstallda", value.toFixed(1).replace(".", ","), {
      decimals: "1",
      scale: "0",
    });
  }

  text(concept: string, contextRef: string, value: string, tuple?: TupleRef): string {
    return `<ix:nonNumeric name="${qname(concept)}" contextRef="${contextRef}"${tupleAttrs(tuple)}>${escapeXml(value)}</ix:nonNumeric>`;
  }

  /** Text som får innehålla andra fakta, t.ex. intygandet med stämmodatumet i. */
  wrapper(concept: string, contextRef: string, inner: string): string {
    return `<ix:nonNumeric name="${qname(concept)}" contextRef="${contextRef}">${inner}</ix:nonNumeric>`;
  }

  /** ISO-datum behöver ingen transformation: formen är redan den XBRL vill ha. */
  date(concept: string, contextRef: string, isoDate: string, tuple?: TupleRef): string {
    return this.text(concept, contextRef, isoDate.slice(0, 10), tuple);
  }

  /** Vallista enligt Extensible Enumerations: värdet är medlemmens QName (TA 2.14.1). */
  hiddenEnum(concept: string, contextRef: string, member: string): void {
    this.hidden.push(this.text(concept, contextRef, member));
  }

  hiddenDate(concept: string, contextRef: string, isoDate: string): void {
    this.hidden.push(this.date(concept, contextRef, isoDate));
  }

  hiddenAntalAnstallda(concept: string, contextRef: string, value: number): void {
    this.hidden.push(this.antalAnstallda(concept, contextRef, value));
  }

  /** ix:header med schemareferenser, kontexter, enheter och dolda fakta. */
  header(schemaRefs: string[]): string {
    const refs = schemaRefs
      .map((href) => `<link:schemaRef xlink:type="simple" xlink:href="${escapeXml(href)}" />`)
      .join("\n        ");
    const contexts = [...this.contexts.values()]
      .map((ctx) => {
        const period = ctx.instant
          ? `<xbrli:instant>${ctx.instant}</xbrli:instant>`
          : `<xbrli:startDate>${ctx.start}</xbrli:startDate><xbrli:endDate>${ctx.end}</xbrli:endDate>`;
        // Varken segment eller scenario: inlämningen avser bara årsredovisningen (TA 2.3.1).
        return [
          `<xbrli:context id="${ctx.id}">`,
          `<xbrli:entity><xbrli:identifier scheme="http://www.bolagsverket.se">${this.orgNr}</xbrli:identifier></xbrli:entity>`,
          `<xbrli:period>${period}</xbrli:period>`,
          "</xbrli:context>",
        ].join("");
      })
      .join("\n        ");
    const units = [...this.units]
      .map((unit) => `<xbrli:unit id="${unit}"><xbrli:measure>${UNIT_MEASURE[unit]}</xbrli:measure></xbrli:unit>`)
      .join("\n        ");
    return [
      '<div style="display:none">',
      "  <ix:header>",
      `    <ix:hidden>\n        ${this.hidden.join("\n        ")}\n    </ix:hidden>`,
      `    <ix:references>\n        ${refs}\n    </ix:references>`,
      `    <ix:resources>\n        ${contexts}\n        ${units}\n    </ix:resources>`,
      "  </ix:header>",
      "</div>",
    ].join("\n");
  }

  private nonFraction(
    concept: string,
    contextRef: string,
    unitRef: UnitId,
    written: string,
    opts: { decimals: string; scale: string; sign?: string }
  ): string {
    const attrs = [
      `name="${qname(concept)}"`,
      `contextRef="${contextRef}"`,
      `unitRef="${unitRef}"`,
      `decimals="${opts.decimals}"`,
      `scale="${opts.scale}"`,
      'format="ixt:numspacecomma"',
      ...(opts.sign ? [`sign="${opts.sign}"`] : []),
    ].join(" ");
    return `<ix:nonFraction ${attrs}>${written}</ix:nonFraction>`;
  }
}

const UNIT_MEASURE: Record<UnitId, string> = {
  SEK: "iso4217:SEK",
  procent: "xbrli:pure",
  "antal-anstallda": "se-k2type:AntalAnstallda",
};

/** Tusenmellanslag med vanligt blanksteg – ixt:numspacecomma läser inte hårda mellanslag. */
function groupDigits(value: number): string {
  return String(Math.round(Math.abs(value))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Beloppet som en läsare ser det, med minustecken. För rader utan tagg. */
function written(amount: number): string {
  return `${amount < 0 ? "-" : ""}${groupDigits(amount)}`;
}

/* -------------------------------- Dokumentet ------------------------------- */

export interface IxbrlFile {
  filename: string;
  /** XHTML-dokumentet. Kodas till UTF-8 med `ixbrlBytes`. */
  xhtml: string;
  /**
   * Innehåll som lämnades otaggat, och därför bara syns för en läsare. Visas
   * för användaren: Bolagsverkets validering kan invända mot det.
   */
  warnings: string[];
}

/**
 * Bygg iXBRL-filen för en upprättad årsredovisning.
 *
 * Siffrorna tas ur den sparade rapporten, inte ur huvudboken: det är rapporten
 * som är handlingen, och en fil som visar något annat än den undertecknade
 * årsredovisningen vore fel även om huvudboken hunnit ändras.
 */
export function ixbrlForAnnualReport(reportId: string): IxbrlFile {
  const report = db().annualReports.find((r) => r.id === reportId);
  if (!report) throw new FilingDataError("Årsredovisningen finns inte.");
  const c = report.content;
  if (!c.companyName.trim()) throw new FilingDataError("Företagsnamnet saknas i inställningarna.", ["name"]);
  const orgNr = orgNumber10(c.orgNumber);

  const w = new FactWriter(orgNr.replace("-", ""));
  const period0 = w.duration("period0", c.periodStart, c.periodEnd);
  const balans0 = w.instant("balans0", c.periodEnd);
  const jamforelse = comparativePeriod(c);
  const period1 = jamforelse ? w.duration("period1", jamforelse.start, jamforelse.end) : undefined;
  const balans1 = jamforelse ? w.instant("balans1", jamforelse.end) : undefined;

  // Allmän information måste vara taggad i sin helhet (TA 2.8.1). Den hör inte
  // till uppställningarna, så den ligger dold – utom namnet och
  // organisationsnummret, som står i dokumentets huvud.
  w.hiddenEnum("SprakHandlingUpprattadList", period0, "se-mem-base:SprakSvenskaMember");
  w.hiddenEnum("LandForetagetsSateList", period0, "se-mem-base:LandSverigeMember");
  w.hiddenEnum("RedovisningsvalutaHandlingList", period0, "se-mem-base:ValutaSvenskaKronorMember");
  w.hiddenEnum("BeloppsformatList", period0, "se-mem-base:BeloppsformatNormalformMember");
  w.hiddenEnum("FinansiellRapportList", period0, "se-mem-base:FinansiellRapportStyrelsenAvgerArsredovisningMember");
  w.hiddenDate("RakenskapsarForstaDag", period0, c.periodStart);
  w.hiddenDate("RakenskapsarSistaDag", period0, c.periodEnd);

  const sections: string[] = [];

  sections.push(
    tag("div", { class: "identitet" }, [
      tag("p", {}, w.text("ForetagetsNamn", period0, c.companyName)),
      tag("p", {}, `Org.nr ${w.text("Organisationsnummer", period0, c.orgNumber)}`),
      tag("h1", {}, esc(`Årsredovisning för räkenskapsåret ${c.periodStart} – ${c.periodEnd}`)),
      tag("p", {}, esc("Styrelsen avger följande årsredovisning.")),
    ].join("\n"))
  );

  sections.push(forvaltningsberattelse(w, c, { period0, balans0, balans1 }));
  sections.push(
    amountTable(w, {
      heading: "Resultaträkning",
      columns: [`${c.periodStart} – ${c.periodEnd}`, jamforelse ? `${jamforelse.start} – ${jamforelse.end}` : ""],
      rows: c.resultatrakning,
      concepts: RESULTAT_CONCEPT,
      current: period0,
      previous: period1,
      what: "resultaträkningen",
    })
  );
  sections.push(
    amountTable(w, {
      heading: "Balansräkning",
      subheading: "Tillgångar",
      columns: [c.periodEnd, jamforelse ? jamforelse.end : ""],
      rows: c.balansrakningTillgangar,
      concepts: BALANS_CONCEPT,
      current: balans0,
      previous: balans1,
      what: "balansräkningen",
    })
  );
  sections.push(
    amountTable(w, {
      subheading: "Eget kapital och skulder",
      columns: [c.periodEnd, jamforelse ? jamforelse.end : ""],
      rows: c.balansrakningEgetKapitalSkulder,
      concepts: BALANS_CONCEPT,
      current: balans0,
      previous: balans1,
      what: "balansräkningen",
    })
  );
  sections.push(noter(w, c, period0));
  sections.push(underskrifter(w, c, period0));
  const intyg = faststallelseintyg(w, c, { period0, balans0 });
  if (intyg) sections.push(intyg);

  const schemaRefs = intyg ? [AR_SCHEMA, INTYG_SCHEMA] : [AR_SCHEMA];
  const title = `Årsredovisning ${c.companyName} ${c.orgNumber} räkenskapsåret ${c.periodStart} – ${c.periodEnd}`;

  const xhtml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE html>\n' +
    `<html xmlns="http://www.w3.org/1999/xhtml" ${Object.entries(NAMESPACES)
      .map(([prefix, uri]) => `xmlns:${prefix}="${uri}"`)
      .join("\n      ")} xml:lang="sv">\n` +
    tag("head", {}, [
      tag("title", {}, esc(title)),
      selfClosing("meta", { "http-equiv": "Content-Type", content: "application/xhtml+xml; charset=UTF-8" }),
      // TA 3.8.2: dokumentet ska berätta vilket program som skapade det.
      selfClosing("meta", { name: "generator", content: "Driva" }),
      tag("style", { type: "text/css" }, CSS),
    ].join("\n")) +
    "\n" +
    tag("body", {}, [w.header(schemaRefs), tag("div", { class: "ar" }, sections.join("\n"))].join("\n")) +
    "\n</html>\n";

  return {
    filename: `arsredovisning-${c.fiscalLabel}-ixbrl.xhtml`,
    xhtml,
    warnings: w.warnings,
  };
}

/** Filens byte-innehåll i UTF-8, som Bolagsverket kräver (TA 3.2.3). */
export function ixbrlBytes(file: IxbrlFile): Uint8Array {
  return new TextEncoder().encode(file.xhtml);
}

/**
 * Vad som saknas för att filen ska gå att lämna in. Tas fram före
 * nedladdningen: Bolagsverket avvisar en årsredovisning utan underskrifter,
 * och det är bättre att säga det här än att låta e-tjänsten göra det.
 */
export function ixbrlBlockers(report: AnnualReport): string[] {
  const out: string[] = [];
  const c = report.content;
  const signatories = (c.underskrifter ?? []).filter((s) => s.name.trim());
  if (signatories.length === 0) {
    out.push("Årsredovisningen saknar underskrifter. Ange styrelsen innan filen lämnas in.");
  }
  if (signatories.some((s) => !s.signedAt)) {
    out.push("Varje företrädare måste ha ett datum för undertecknandet – signera årsredovisningen först.");
  }
  if (!c.fastallelseintyg?.stammaDate) {
    out.push(
      "Fastställelseintyget saknar datum för årsstämman. Utan intyg tar Bolagsverket bara emot årsredovisningen som en oavslutad handling."
    );
  }
  if (report.supersededAt) {
    out.push("Årsredovisningen är ersatt: räkenskapsåret öppnades igen efter att den upprättades.");
  }
  return out;
}

/* ------------------------------- Delrapporter ------------------------------ */

function forvaltningsberattelse(
  w: FactWriter,
  c: AnnualReportContent,
  ctx: { period0: string; balans0: string; balans1?: string }
): string {
  const fb = c.forvaltningsberattelse;
  const parts: string[] = [tag("h2", {}, "Förvaltningsberättelse"), tag("h3", {}, "Verksamheten")];
  parts.push(tag("p", {}, w.text("AllmantVerksamheten", ctx.period0, fb.verksamhet)));
  parts.push(tag("h3", {}, esc("Väsentliga händelser under räkenskapsåret")));
  parts.push(tag("p", {}, w.text("VasentligaHandelserRakenskapsaret", ctx.period0, fb.vasentligaHandelser)));

  // Flerårsöversikten går längre bak än jämförelseåret, så varje år får en egen
  // kontext. Åren identifieras av sin etikett och datumen hämtas ur
  // räkenskapsårsregistret – ett år Driva inte har bokföring för kan inte taggas.
  const years = new Map(fiscalYears().map((f) => [f.label, f]));
  const overviewRows = fb.flerarsoversikt.map((row) => {
    const fy = years.get(row.label);
    if (!fy || row.ofullstandig) {
      if (!fy) w.warnings.push(`Flerårsöversiktens rad ${row.label} kunde inte taggas: räkenskapsåret finns inte kvar.`);
      return tag("tr", {}, [
        tag("th", {}, esc(row.label)),
        tag("td", { class: "num" }, esc(written(row.nettoomsattning))),
        tag("td", { class: "num" }, esc(written(row.resultatEfterFinansiella))),
        tag("td", { class: "num" }, esc(`${row.soliditetProcent} %`)),
      ].join(""));
    }
    const period = w.durationFor(fy.startDate, fy.endDate);
    const balans = w.instantFor(fy.endDate);
    return tag("tr", {}, [
      tag("th", {}, esc(row.label)),
      tag("td", { class: "num" }, w.money("Nettoomsattning", period, row.nettoomsattning)),
      tag("td", { class: "num" }, w.money("ResultatEfterFinansiellaPoster", period, row.resultatEfterFinansiella)),
      tag("td", { class: "num" }, `${w.percent("Soliditet", balans, row.soliditetProcent)} %`),
    ].join(""));
  });
  parts.push(
    tag("h3", {}, esc("Flerårsöversikt (kr)")),
    tag("table", {}, [
      tag("tr", {}, [
        tag("th", {}, ""),
        tag("th", { class: "num" }, esc("Nettoomsättning")),
        tag("th", { class: "num" }, esc("Resultat efter finansiella poster")),
        tag("th", { class: "num" }, esc("Soliditet")),
      ].join("")),
      ...overviewRows,
    ].join("\n"))
  );

  const forandring = fb.egetKapitalForandring ?? [];
  if (forandring.length) {
    const rows = forandring.map((row, index) => {
      // Första raden är ingången, alltså jämförelseårets balansdag. Utan
      // jämförelseår finns bara utgången.
      const isOpening = index === 0 && forandring.length > 1;
      const balans = isOpening ? ctx.balans1 : ctx.balans0;
      if (!balans) {
        return tag("tr", {}, [
          tag("th", {}, esc(row.label)),
          ...[row.aktiekapital, row.balanseratResultat, row.aretsResultat, row.summa].map((v) =>
            tag("td", { class: "num" }, esc(written(v)))
          ),
        ].join(""));
      }
      return tag("tr", {}, [
        tag("th", {}, esc(row.label)),
        tag("td", { class: "num" }, w.money("Aktiekapital", balans, row.aktiekapital)),
        tag("td", { class: "num" }, w.money("BalanseratResultat", balans, row.balanseratResultat)),
        tag("td", { class: "num" }, w.money("AretsResultatEgetKapital", balans, row.aretsResultat)),
        tag("td", { class: "num" }, w.money("EgetKapital", balans, row.summa)),
      ].join(""));
    });
    parts.push(
      tag("h3", {}, esc("Förändringar i eget kapital (kr)")),
      tag("table", {}, [
        tag("tr", {}, [
          tag("th", {}, ""),
          tag("th", { class: "num" }, esc("Aktiekapital")),
          tag("th", { class: "num" }, esc("Balanserat resultat")),
          tag("th", { class: "num" }, esc("Årets resultat")),
          tag("th", { class: "num" }, esc("Summa")),
        ].join("")),
        ...rows,
      ].join("\n"))
    );
  }

  const rd = fb.resultatdisposition;
  const dispositionRows = [
    tag("tr", {}, tag("th", {}, esc("Till stämmans förfogande står")) +
      tag("td", { class: "num" }, w.money("FrittEgetKapital", ctx.balans0, rd.tillForfogande))),
    ...(rd.utdelning
      ? [
          tag("tr", {}, tag("th", {}, esc("Utdelning")) +
            tag("td", { class: "num" }, w.money("ForslagDispositionUtdelning", ctx.balans0, rd.utdelning))),
        ]
      : []),
    tag("tr", {}, tag("th", {}, esc("Balanseras i ny räkning")) +
      tag("td", { class: "num" }, w.money("ForslagDispositionBalanserasINyRakning", ctx.balans0, rd.balanserasINyRakning))),
    tag("tr", { class: "summa" }, tag("th", {}, esc("Summa")) +
      tag("td", { class: "num" }, w.money("ForslagDisposition", ctx.balans0, rd.tillForfogande))),
  ];
  parts.push(
    tag("h3", {}, esc("Förslag till resultatdisposition (kr)")),
    tag("table", {}, dispositionRows.join("\n"))
  );

  return tag("div", { class: "del" }, parts.join("\n"));
}

function amountTable(
  w: FactWriter,
  spec: {
    heading?: string;
    subheading?: string;
    columns: [string, string];
    rows: ReportRow[];
    concepts: Record<string, string>;
    current: string;
    previous?: string;
    what: string;
  }
): string {
  const head = tag("tr", {}, [
    tag("th", {}, ""),
    tag("th", { class: "num" }, esc(spec.columns[0])),
    tag("th", { class: "num" }, esc(spec.columns[1])),
  ].join(""));

  const body = spec.rows.map((row) => {
    const concept = spec.concepts[row.label];
    if (!concept) {
      w.warnings.push(`Raden "${row.label}" i ${spec.what} har inget begrepp i taxonomin och lämnas otaggad.`);
    }
    const label =
      esc(row.label) + (row.note ? tag("sup", {}, `<a href="#not-${row.note}">${row.note}</a>`) : "");
    const current = concept ? w.money(concept, spec.current, row.amount) : esc(written(row.amount));
    const previous =
      row.prior === undefined
        ? ""
        : concept && spec.previous
          ? w.money(concept, spec.previous, row.prior)
          : esc(written(row.prior));
    return tag("tr", row.bold ? { class: "summa" } : {}, [
      tag("th", {}, label),
      tag("td", { class: "num" }, current),
      tag("td", { class: "num" }, previous),
    ].join(""));
  });

  return tag("div", { class: "del" }, [
    ...(spec.heading ? [tag("h2", {}, esc(spec.heading))] : []),
    ...(spec.subheading ? [tag("h3", {}, esc(spec.subheading))] : []),
    tag("table", {}, [head, ...body].join("\n")),
  ].join("\n"));
}

/**
 * Noterna. Redovisningsprinciperna har ett eget begrepp och medelantalet
 * anställda är ett tal med egen enhet – de taggas. Övriga noter är
 * beskrivningar av tal som redan står taggade i uppställningarna, och att
 * tagga dem igen med samma begrepp och kontext men annat tecken vore att
 * lämna två olika svar på samma fråga (TA 2.6.1).
 */
function noter(w: FactWriter, c: AnnualReportContent, period0: string): string {
  const parts: string[] = [tag("h2", {}, "Noter")];
  for (const note of c.noter) {
    parts.push(tag("h3", { id: `not-${note.number}` }, esc(`Not ${note.number} ${note.title}`)));
    if (/redovisningsprinciper/i.test(note.title)) {
      parts.push(tag("p", {}, w.text("RedovisningsVarderingsprinciper", period0, note.body)));
      continue;
    }
    if (/medelantal/i.test(note.title)) {
      parts.push(tag("p", {}, medelantalBody(w, c, note.body, period0)));
      continue;
    }
    parts.push(tag("p", {}, esc(note.body)));
    w.warnings.push(`Not ${note.number} ${note.title} lämnas otaggad: taxonomin saknar begrepp för notens text.`);
  }
  return tag("div", { class: "del" }, parts.join("\n"));
}

/**
 * Medelantalet anställda ska vara ett taggat tal, men Drivas notext skriver det
 * i en mening. Talet taggas där det står, så presentationen och datat är samma
 * uppgift (TA 4.1.1).
 *
 * Rapporter upprättade innan Driva sparade talet separat bär det bara i
 * meningen. Då läses det därifrån: meningen är skriven av Driva och siffran i
 * den är rapportens egen, och alternativet vore en årsredovisning som inte går
 * att lämna in digitalt förrän året öppnas och stängs om.
 */
function medelantalBody(w: FactWriter, c: AnnualReportContent, body: string, period0: string): string {
  const iMeningen = /\d+(?:,\d+)?/.exec(body);
  const value = c.medelantalAnstallda ?? (iMeningen ? Number(iMeningen[0].replace(",", ".")) : undefined);
  if (value === undefined) {
    w.warnings.push("Medelantalet anställda står inte som ett tal i noten och kunde inte taggas.");
    return esc(body);
  }

  const tagga = (at: number, length: number) =>
    esc(body.slice(0, at)) +
    w.antalAnstallda("MedelantaletAnstallda", period0, value) +
    esc(body.slice(at + length));

  const written = value.toLocaleString("sv-SE");
  const at = body.indexOf(written);
  if (at !== -1) return tagga(at, written.length);
  if (iMeningen) return tagga(iMeningen.index, iMeningen[0].length);
  w.hiddenAntalAnstallda("MedelantaletAnstallda", period0, value);
  return esc(body);
}

/**
 * Underskrifterna. Varje företrädare är en rad i en tuple, och datumet för
 * undertecknandet måste finnas för var och en (TA 2.8.1). Drivas
 * underskriftsregister har ett namn i ett stycke, så det delas på sista
 * mellanslaget – taxonomin vill ha tilltalsnamn och efternamn var för sig.
 */
function underskrifter(w: FactWriter, c: AnnualReportContent, period0: string): string {
  const signatories = (c.underskrifter ?? []).filter((s) => s.name.trim());
  const parts: string[] = [tag("h2", {}, "Underskrifter")];
  const ort = signatories.find((s) => s.place)?.place ?? c.sate;
  if (ort) parts.push(tag("p", {}, w.text("UndertecknandeArsredovisningOrt", period0, ort)));

  signatories.forEach((s, index) => {
    const tupleId = `underskrift-${index + 1}`;
    const at = s.name.trim().lastIndexOf(" ");
    const first = at === -1 ? s.name.trim() : s.name.trim().slice(0, at);
    const last = at === -1 ? "" : s.name.trim().slice(at + 1);
    const facts = [
      w.text("UnderskriftHandlingTilltalsnamn", period0, first, { id: tupleId, order: "1.0" }),
      ...(last ? [w.text("UnderskriftHandlingEfternamn", period0, last, { id: tupleId, order: "2.0" })] : []),
      ...(s.role ? [w.text("UnderskriftHandlingRoll", period0, s.role, { id: tupleId, order: "3.0" })] : []),
      ...(s.signedAt ? [w.date("UndertecknandeDatum", period0, s.signedAt, { id: tupleId, order: "4.0" })] : []),
    ];
    if (!s.signedAt) {
      w.warnings.push(`${s.name} saknar datum för undertecknandet. Bolagsverket kräver ett datum per företrädare.`);
    }
    if (!last) {
      w.warnings.push(`${s.name} saknar efternamn. Taxonomin vill ha tilltalsnamn och efternamn var för sig.`);
    }
    parts.push(
      `<ix:tuple name="${qname("UnderskriftArsredovisningForetradareTuple")}" tupleID="${tupleId}" />`,
      tag("p", { class: "underskrift" }, facts.join(" "))
    );
  });

  return tag("div", { class: "del" }, parts.join("\n"));
}

/**
 * Fastställelseintyget: intygandet att stämman fastställde räkningarna och att
 * de elektroniska handlingarna stämmer med originalen. Tas bara med när
 * stämmodatum och bestyrkande företrädare finns – ett intyg om en stämma som
 * inte hållits är en osanning, inte ett tomt fält.
 */
function faststallelseintyg(
  w: FactWriter,
  c: AnnualReportContent,
  ctx: { period0: string; balans0: string }
): string | undefined {
  const intyg = c.fastallelseintyg;
  if (!intyg?.stammaDate || !intyg.certifiedByName?.trim()) return undefined;

  const at = intyg.certifiedByName.trim().lastIndexOf(" ");
  const first = at === -1 ? intyg.certifiedByName.trim() : intyg.certifiedByName.trim().slice(0, at);
  const last = at === -1 ? "" : intyg.certifiedByName.trim().slice(at + 1);

  const intygande =
    w.text(
      "FaststallelseResultatBalansrakning",
      ctx.balans0,
      "Jag intygar att resultaträkningen och balansräkningen har fastställts på årsstämma"
    ) +
    " " +
    w.date("Arsstamma", ctx.balans0, intyg.stammaDate) +
    ". " +
    w.text(
      "ArsstammaResultatDispositionGodkannaStyrelsensForslag",
      ctx.balans0,
      intyg.dispositionDecision?.trim() ||
        "Årsstämman beslöt att godkänna styrelsens förslag till resultatdisposition."
    );

  const parts = [
    tag("h2", {}, "Fastställelseintyg"),
    tag("p", {}, w.wrapper("ArsstammaIntygande", ctx.balans0, intygande)),
    tag(
      "p",
      {},
      w.text(
        "IntygandeOriginalInnehall",
        ctx.balans0,
        "Jag intygar att innehållet i dessa elektroniska handlingar överensstämmer med originalen och att originalen undertecknats av samtliga personer som enligt lag ska underteckna dessa."
      )
    ),
    tag("p", {}, [
      w.text("UnderskriftFaststallelseintygForetradareTilltalsnamn", ctx.period0, first),
      ...(last ? [w.text("UnderskriftFaststallelseintygForetradareEfternamn", ctx.period0, last)] : []),
      ...(intyg.certifiedByRole?.trim()
        ? [w.text("UnderskriftFaststallelseintygForetradareForetradarroll", ctx.period0, intyg.certifiedByRole.trim())]
        : []),
      w.date("UnderskriftFastallelseintygDatum", ctx.balans0, intyg.stammaDate),
    ].join(" ")),
  ];
  return tag("div", { class: "del" }, parts.join("\n"));
}

/* --------------------------------- XHTML ---------------------------------- */

/**
 * Jämförelseårets period. Rapporten bär jämförelsetal men inte jämförelseårets
 * datum, så de hämtas ur räkenskapsårsregistret. Utan ett tidigare år taggas
 * jämförelsekolumnen inte – ett tal utan kontext hör inte i en XBRL-fil.
 */
function comparativePeriod(c: AnnualReportContent): { start: string; end: string } | undefined {
  const previous = fiscalYears()
    .filter((f) => f.endDate < c.periodStart)
    .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  return previous ? { start: previous.startDate, end: previous.endDate } : undefined;
}

function esc(text: string): string {
  return escapeXml(text);
}

function tag(name: string, attrs: Record<string, string>, inner: string): string {
  return `<${name}${attrString(attrs)}>${inner}</${name}>`;
}

function selfClosing(name: string, attrs: Record<string, string>): string {
  return `<${name}${attrString(attrs)} />`;
}

function attrString(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join("");
}

/** All stil ligger i dokumentet: externa stylesheets är förbjudna (TA 3.7.3). */
const CSS = `
body { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; color: #111; margin: 2cm; }
h1 { font-size: 16pt; } h2 { font-size: 13pt; margin-top: 1.5em; } h3 { font-size: 11pt; }
table { border-collapse: collapse; width: 100%; margin: 0.5em 0 1em; }
th, td { text-align: left; padding: 0.25em 0.5em; border-bottom: 1px solid #ddd; font-weight: normal; }
td.num, th.num { text-align: right; white-space: nowrap; }
tr.summa th, tr.summa td { font-weight: bold; }
sup a { text-decoration: none; }
.underskrift { margin: 1.5em 0 0; }
`.trim();
