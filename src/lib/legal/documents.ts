/**
 * Juridiska dokument (spec §7): allmänna villkor, integritetspolicy och
 * personuppgiftsbiträdesavtal med säkerhetsbilaga. Innehållet genereras från
 * det centrala registret (avtalspart ur env, aktiva leverantörer), så att
 * sidorna aldrig visar ett påhittat bolagsnamn eller en leverantör som inte
 * används.
 *
 * Versionering: `version` är "major.minor". En höjd major är en väsentlig
 * ändring och kräver nytt aktivt godkännande av alla användare (grinden i
 * appen). Minor ändrar bara text/förtydliganden. `effectiveFrom` är det datum
 * texten gäller från.
 *
 * Texterna är UTKAST som måste granskas juridiskt före produktion – se
 * LEGAL_DRAFT_NOTICE och GO_LIVE_CHECKLIST.md.
 */
import { PLAN } from "../billing/state";
import { legalEntityLabel, type LegalEntityStatus } from "./entity";
import type { ProviderEntry } from "./providers";

export type LegalDocumentId = "villkor" | "integritet" | "dpa";

export interface LegalDocumentMeta {
  id: LegalDocumentId;
  title: string;
  path: string;
  /** "major.minor" – major kräver nytt godkännande. */
  version: string;
  effectiveFrom: string;
  /** Kort ändringsnotis som visas när användaren ska godkänna igen. */
  changeSummary: string;
}

export const LEGAL_DOCUMENTS: Record<LegalDocumentId, LegalDocumentMeta> = {
  villkor: {
    id: "villkor",
    title: "Allmänna villkor",
    path: "/villkor",
    version: "2.0",
    effectiveFrom: "2026-10-01",
    changeSummary:
      "Nya villkor med tydliga stödgränser, provperiod och abonnemang via Stripe, skrivskydd efter avslutad provperiod, dataexport och lagstadgad bevarandetid för bokföringsmaterial.",
  },
  integritet: {
    id: "integritet",
    title: "Integritetspolicy",
    path: "/integritet",
    version: "2.0",
    effectiveFrom: "2026-10-01",
    changeSummary:
      "Utökad beskrivning av uppgiftskategorier, rättsliga grunder, mottagare/underbiträden, lagringstider och rättigheter.",
  },
  dpa: {
    id: "dpa",
    title: "Personuppgiftsbiträdesavtal",
    path: "/bitradesavtal",
    version: "1.0",
    effectiveFrom: "2026-10-01",
    changeSummary: "Första versionen.",
  },
};

export const LEGAL_DRAFT_NOTICE =
  "Utkast: texten är framtagen för granskning och måste godkännas av jurist innan den används i produktion.";

/** Aktuell villkorsversion som användare måste ha godkänt. */
export const TERMS_VERSION = LEGAL_DOCUMENTS.villkor.version;

export function majorOf(version: string | null | undefined): number {
  if (!version) return 0;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(version.trim());
  return m ? Number(m[1]) : 0;
}

/** Måste användaren godkänna igen? Endast major-ändringar kräver det. */
export function needsReacceptance(acceptedVersion: string | null | undefined, current = TERMS_VERSION): boolean {
  return majorOf(acceptedVersion) < majorOf(current);
}

export interface LegalSection {
  title: string;
  body: string[];
  bullets?: string[];
}

export function formatSwedishDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "januari",
    "februari",
    "mars",
    "april",
    "maj",
    "juni",
    "juli",
    "augusti",
    "september",
    "oktober",
    "november",
    "december",
  ];
  if (!y || !m || !d) return iso;
  return `${d} ${months[m - 1]} ${y}`;
}

/* --------------------------------- Villkor --------------------------------- */

export function termsSections(status: LegalEntityStatus): LegalSection[] {
  const part = legalEntityLabel(status);
  const contact = status.entity?.contactEmail ?? "[kontaktadress ej konfigurerad]";
  return [
    {
      title: "1. Avtalspart och tjänsten",
      body: [
        `Dessa villkor gäller mellan dig som kund (företaget) och ${part}, nedan "Ferva" eller "vi". Ferva är en webbtjänst för små aktiebolag som samlar offerter, kunder, uppdrag, fakturor, kvitton, bankhändelser och bokföringsunderlag på ett ställe, med stöd för att ta fram deklarationsunderlag.`,
        "Tjänsten tillhandahålls som den är och utvecklas löpande. Vilka fall tjänsten stödjer beskrivs i supportmatrisen i tjänsten (Hjälp → Vad Ferva stödjer). Sådant som ligger utanför matrisen ska inte bokföras eller deklareras via Ferva utan stöd av redovisningskonsult.",
      ],
    },
    {
      title: "2. Stödgränser",
      body: [
        "Ferva är i den här versionen avsett för svenska aktiebolag som redovisar enligt K2, med verksamhet i Sverige och redovisning i SEK. Tjänsten stödjer svensk kundfakturering med 0, 6, 12 och 25 procent moms, ROT/RUT-avdrag, enkel fast månadslön inom motorns verifierade fall samt de bokföringsfall som listas i supportmatrisen.",
        "Ferva är inte anpassat för handelsbolag, enskild firma, koncernredovisning, K3, lager- eller tillverkningsföretag, utländsk moms/OSS, komplexa löneupplägg, förmåner utanför de verifierade fallen eller finansiella instrument. Försöker du registrera något sådant visar tjänsten det och stoppar eller varnar. Du ansvarar för att ditt företag ligger inom stödgränserna.",
      ],
    },
    {
      title: "3. Kundens ansvar",
      body: [
        "Du ansvarar för att uppgifterna du registrerar är riktiga och fullständiga, att verifikationer och underlag är äkta, att inloggningsuppgifter och eventuella flerfaktorsuppgifter hanteras säkert och att tjänsten används i enlighet med gällande lag, inklusive bokföringslagen, mervärdesskattelagen och skatteförfarandelagen.",
        "Du ansvarar för att granska och godkänna de bokföringsförslag, deklarationsunderlag och dokument tjänsten tar fram innan de används, bokförs eller lämnas in. Ferva ersätter inte revisor, redovisningskonsult eller juridisk rådgivare.",
      ],
    },
    {
      title: "4. Fervas ansvar",
      body: [
        "Ferva ska tillhandahålla tjänsten fackmannamässigt, skydda dina uppgifter enligt integritetspolicyn och personuppgiftsbiträdesavtalet, hålla räkenskapsinformationen oföränderlig när den bokförts och tillhandahålla export av dina uppgifter.",
        "Förslag från tjänstens regelmotor och AI-assistent är hjälpmedel. De bygger på det underlag som finns i tjänsten och kan vara fel eller ofullständiga. Ferva ansvarar inte för bokföring, deklarationer eller dokument som du godkänt eller skickat.",
      ],
    },
    {
      title: "5. Pris, provperiod och uppsägning",
      body: [
        `Nya företag får en kostnadsfri provperiod på ${PLAN.trialDays} dagar utan betalkort. Därefter kostar ${PLAN.name} ${PLAN.pricePerMonthExVat} kr per månad exklusive moms, om inte annat pris framgår i tjänsten vid tecknandet. Abonnemanget betalas månadsvis i förskott via vår betalleverantör Stripe och förnyas automatiskt.`,
        "Du kan säga upp abonnemanget när du vill i kundportalen. Uppsägningen gäller från slutet av den betalda perioden; ingen återbetalning görs för påbörjad period. Ferva kan höja priset med minst 30 dagars varsel via tjänsten eller e-post; en prishöjning gäller från nästa förnyelse efter varseltiden.",
      ],
    },
    {
      title: "6. Betalningsfel och skrivskydd",
      body: [
        "Om provperioden löper ut utan abonnemang, om en betalning misslyckas och inte rättas inom den tid Stripe anger, eller om abonnemanget sägs upp, övergår företaget till skrivskyddat läge. I skrivskyddat läge kan du logga in, läsa allt och exportera dina uppgifter, men inte registrera nya ekonomiska händelser, skicka dokument eller lämna in något.",
        "Skrivskyddet upphör så snart ett aktivt abonnemang åter finns. Inget raderas på grund av skrivskydd.",
      ],
    },
    {
      title: "7. Support",
      body: [
        "Support ges via supportfunktionen i tjänsten på svenska under kontorstid på vardagar. Supporten hjälper med tjänstens funktioner, inte med redovisnings-, skatte- eller juridisk rådgivning. Med ditt uttryckliga medgivande kan supporten tillfälligt öppna en spårad supportsession i ditt företag; alla sådana åtgärder loggas och visas för dig.",
      ],
    },
    {
      title: "8. Dina uppgifter, export och bevarande",
      body: [
        "Uppgifterna du registrerar är dina. Du kan när som helst exportera bokföringen (SIE), dokument och dina kontouppgifter från tjänsten. Ferva använder dina uppgifter bara för att tillhandahålla tjänsten enligt integritetspolicyn.",
        "Räkenskapsinformation (verifikationer, bokförda underlag, utfärdade fakturor, bokslut) måste enligt bokföringslagen bevaras i sju år efter utgången av det kalenderår då räkenskapsåret avslutades. Sådan information kan därför inte raderas i förtid, även om du stänger kontot. När du stänger kontot inaktiveras företaget, personuppgifter som inte behöver bevaras raderas eller anonymiseras, och räkenskapsinformationen bevaras skrivskyddad under bevarandetiden innan den raderas.",
      ],
    },
    {
      title: "9. Kontoavslut",
      body: [
        "Du kan begära att kontot stängs via Inställningar → Konto eller supporten. Vi bekräftar avslutet, inaktiverar företaget och hanterar uppgifterna enligt punkt 8. Ferva kan stänga av ett konto vid väsentligt avtalsbrott, missbruk eller om betalning inte sker, efter påminnelse där det är rimligt.",
      ],
    },
    {
      title: "10. Ändringar av villkoren",
      body: [
        "Vi kan ändra dessa villkor när tjänsten, lagen eller våra leverantörer förändras. Väsentliga ändringar (ny huvudversion) meddelas minst 30 dagar innan de börjar gälla och kräver att du aktivt godkänner dem i tjänsten innan du fortsätter använda den. Förtydliganden och språkliga ändringar kan göras utan nytt godkännande. Aktuell version och giltighetsdatum visas alltid på den här sidan.",
      ],
    },
    {
      title: "11. Ansvarsbegränsning",
      body: [
        "Ferva ansvarar inte för indirekta skador såsom utebliven vinst, skattetillägg, förseningsavgifter eller följdskador, om inte skadan orsakats av grov vårdslöshet eller uppsåt. Fervas sammanlagda ansvar per kalenderår är begränsat till vad du betalat för tjänsten under de senaste tolv månaderna. Begränsningen gäller inte ansvar som inte kan begränsas enligt tvingande lag.",
        "Vi strävar efter hög tillgänglighet men garanterar inte att tjänsten är fri från avbrott eller fel. Planerade avbrott meddelas i tjänsten när det är möjligt.",
      ],
    },
    {
      title: "12. Tillämplig lag och tvist",
      body: ["Svensk lag gäller för avtalet. Tvist ska i första hand lösas genom dialog och annars i svensk allmän domstol."],
    },
    {
      title: "13. Kontakt",
      body: [`Frågor om villkoren: ${contact}. Avtalspart: ${part}${status.entity ? `, ${status.entity.address}` : ""}.`],
    },
  ];
}

/* ------------------------------- Integritet -------------------------------- */

export function privacySections(status: LegalEntityStatus, providers: ProviderEntry[]): LegalSection[] {
  const part = legalEntityLabel(status);
  const privacyContact = status.entity?.privacyEmail ?? "[dataskyddskontakt ej konfigurerad]";
  return [
    {
      title: "1. Personuppgiftsansvarig och biträde",
      body: [
        `${part} är personuppgiftsansvarig för uppgifter om dig som användare (konto, inloggning, support, betalning) och för driften av tjänsten.`,
        "För uppgifter som ditt företag registrerar om sina kunder, anställda, leverantörer och andra (offerter, fakturor, kvitton, löner, bokföring) är ditt företag personuppgiftsansvarigt och Ferva personuppgiftsbiträde enligt personuppgiftsbiträdesavtalet.",
      ],
    },
    {
      title: "2. Kategorier av registrerade och uppgifter",
      body: ["Vi behandlar uppgifter om följande kategorier av personer:"],
      bullets: [
        "Användare (företagare, medarbetare, redovisningskonsulter): e-postadress, telefonnummer, lösenord (hashat), eventuella MFA-faktorer, inloggningstider, IP-adress i säkerhetsloggar, godkända villkorsversioner.",
        "Företagets kunder: namn, adress, e-post, telefon, personnummer när ROT/RUT-avdrag begärs, fastighetsbeteckning, offert- och fakturahistorik.",
        "Företagets anställda och ägare: namn, personnummer, lön och skatteuppgifter i den utsträckning lönefunktionen används.",
        "Leverantörer och betalningsmottagare: namn, kontonummer, fakturauppgifter.",
        "Kontaktpersoner på företag som skickar mejl till inkorgen: avsändaradress och innehåll.",
        "Supportkontakter: det du skriver i ärenden och bifogade skärmbilder.",
      ],
    },
    {
      title: "3. Ändamål och rättslig grund",
      body: ["Vi behandlar uppgifterna för att:"],
      bullets: [
        "Tillhandahålla tjänsten och fullgöra avtalet med dig (avtal, art. 6.1 b).",
        "Följa bokföringslagen, skattelagstiftningen och penningtvättsregler (rättslig förpliktelse, art. 6.1 c).",
        "Hantera abonnemang och betalning via Stripe (avtal).",
        "Skydda tjänsten: säkerhetsloggar, missbruksskydd, felövervakning med skrubbade rapporter (berättigat intresse, art. 6.1 f).",
        "Ge support och besvara frågor (avtal/berättigat intresse).",
        "Skicka nödvändiga meddelanden om kontot, villkorsändringar och driftstörningar (avtal). Vi skickar ingen marknadsföring utan samtycke och säljer aldrig uppgifter.",
      ],
    },
    {
      title: "4. Mottagare och underbiträden",
      body: [
        "Uppgifter delas bara med de leverantörer som behövs för driften. Den aktuella listan med ändamål, region och avtal finns på /underbitraden och härleds automatiskt från vilka leverantörer som faktiskt är påslagna. Just nu används:",
      ],
      bullets: providers.map((p) => `${p.name} – ${p.purpose} (${p.region})`),
    },
    {
      title: "5. Överföring utanför EU/EES",
      body: [
        "Vi väljer EU-regioner där leverantören erbjuder det. När en leverantör med säte i USA används (till exempel Vercel, Supabase, Resend, Stripe, OpenRouter eller Sentry) sker överföringen med stöd av EU-kommissionens standardavtalsklausuler och, där leverantören är certifierad, EU–US Data Privacy Framework, tillsammans med kryptering under överföring och i vila. Detaljer per leverantör finns på /underbitraden.",
      ],
    },
    {
      title: "6. Lagringstid",
      body: ["Hur länge uppgifterna sparas beror på kategori:"],
      bullets: [
        "Kontouppgifter: så länge kontot är aktivt och därefter upp till 12 månader, om inte annan lagringstid gäller.",
        "Räkenskapsinformation (verifikationer, bokförda underlag, fakturor, lönebesked, bokslut): 7 år efter utgången av det kalenderår då räkenskapsåret avslutades (bokföringslagen 7 kap.). Kan inte raderas i förtid.",
        "Offerter som inte lett till avtal och utkast: raderas när du tar bort dem, annars 24 månader efter senaste ändring.",
        "Inkorg (inkommande mejl och bilagor som inte bokförts): 24 månader.",
        "Supportärenden: 24 månader efter avslut.",
        "Säkerhets- och åtkomstloggar: 12 månader. Adminåtgärdslogg: bevaras under kontots livstid plus 7 år.",
        "Felrapporter (skrubbade): 90 dagar hos övervakningsleverantören.",
        "Bankkoppling: transaktioner sparas som räkenskapsinformation; samtycket hos banken kan du återkalla när som helst.",
        "Publik demo: raderas automatiskt inom ett dygn.",
      ],
    },
    {
      title: "7. Dina rättigheter",
      body: [
        "Du har rätt att få tillgång till dina uppgifter, få dem rättade eller raderade, begära begränsning, invända mot behandling som grundas på berättigat intresse och få ut dina uppgifter i maskinläsbart format (dataportabilitet). Din kontoexport hittar du under Inställningar → Konto. Rätten till radering gäller inte uppgifter vi måste bevara enligt lag, till exempel räkenskapsinformation – de bevaras skrivskyddade under lagstadgad tid och raderas därefter.",
        "Gäller din begäran uppgifter som ditt företag (eller ett företag du är kund hos) registrerat vänder du dig i första hand till företaget, som är personuppgiftsansvarigt. Vi hjälper företaget att uppfylla begäran.",
      ],
    },
    {
      title: "8. Klagomål",
      body: [
        "Du har rätt att lämna klagomål till Integritetsskyddsmyndigheten (IMY), Box 8114, 104 20 Stockholm, imy@imy.se, www.imy.se, om du anser att vi behandlar dina uppgifter i strid med dataskyddsförordningen.",
      ],
    },
    {
      title: "9. Säkerhet",
      body: [
        "Uppgifterna skyddas med kryptering under överföring och i vila, radnivåsäkerhet per företag i databasen, tvingande flerfaktorsautentisering för all plattformsadministration, oföränderliga bokförings- och auditloggar, skrubbad felövervakning samt dokumenterade rutiner för incidenter, nyckelrotation och återställning. Säkerhetsbilagan till personuppgiftsbiträdesavtalet beskriver åtgärderna i detalj.",
      ],
    },
    {
      title: "10. Kontakt",
      body: [
        `Dataskyddsfrågor: ${privacyContact}. Personuppgiftsansvarig: ${part}${status.entity ? `, ${status.entity.address}` : ""}.`,
      ],
    },
  ];
}

/* ----------------------------------- DPA ----------------------------------- */

export function dpaSections(status: LegalEntityStatus, providers: ProviderEntry[]): LegalSection[] {
  const part = legalEntityLabel(status);
  return [
    {
      title: "1. Parter och bakgrund",
      body: [
        `Detta personuppgiftsbiträdesavtal ("Biträdesavtalet") gäller mellan kunden (företaget som tecknat Ferva, "den Ansvarige") och ${part} ("Biträdet") och utgör en del av de allmänna villkoren. Biträdesavtalet reglerar Biträdets behandling av personuppgifter för den Ansvariges räkning enligt artikel 28 i dataskyddsförordningen (GDPR).`,
      ],
    },
    {
      title: "2. Behandlingens föremål, art och ändamål",
      body: [
        "Biträdet behandlar personuppgifter för att tillhandahålla tjänsten Ferva: lagring, visning, beräkning, dokumentgenerering, utskick och inlämning av offerter, fakturor, kvitton, bankhändelser, löner, bokföring och deklarationsunderlag samt support på den Ansvariges begäran.",
      ],
    },
    {
      title: "3. Kategorier av registrerade och uppgifter",
      body: ["Registrerade: den Ansvariges kunder, anställda, ägare, leverantörer och kontaktpersoner."],
      bullets: [
        "Identitets- och kontaktuppgifter (namn, adress, e-post, telefon).",
        "Personnummer när det krävs för ROT/RUT-avdrag, lön eller kontrolluppgifter.",
        "Ekonomiska uppgifter (fakturor, betalningar, lön, kontonummer, transaktioner).",
        "Fastighetsuppgifter och innehåll i uppdrag och kommunikation.",
      ],
    },
    {
      title: "4. Biträdets skyldigheter",
      body: ["Biträdet ska:"],
      bullets: [
        "Behandla personuppgifter endast enligt den Ansvariges dokumenterade instruktioner, där tjänstens funktioner och dessa villkor utgör instruktionerna, om inte lag kräver annat.",
        "Säkerställa att personer med åtkomst omfattas av sekretess och att åtkomst till kunddata av Biträdets personal bara sker via spårade supportsessioner med den Ansvariges medgivande eller vid incidenthantering, och alltid loggas.",
        "Vidta de tekniska och organisatoriska åtgärderna i säkerhetsbilagan.",
        "Bistå den Ansvarige med att svara på registrerades begäranden, konsekvensbedömningar och kontakter med tillsynsmyndighet.",
        "Underrätta den Ansvarige utan onödigt dröjsmål, och senast inom 48 timmar, efter att ha fått kännedom om en personuppgiftsincident som rör den Ansvariges uppgifter, med den information som krävs för anmälan enligt artikel 33.",
        "På den Ansvariges begäran tillhandahålla den information som krävs för att visa att skyldigheterna följs och medge granskning på skäliga villkor, i första hand genom dokumentation och tredjepartsintyg från underbiträden.",
      ],
    },
    {
      title: "5. Underbiträden",
      body: [
        "Den Ansvarige lämnar ett allmänt förhandsgodkännande till att Biträdet anlitar underbiträden. Aktuell lista med ändamål, region och avtalslänk publiceras på /underbitraden och härleds från Biträdets leverantörsregister. Biträdet meddelar planerade byten eller tillägg minst 30 dagar i förväg via tjänsten eller e-post; den Ansvarige kan invända på sakliga grunder och har då rätt att säga upp tjänsten innan ändringen träder i kraft. Biträdet ålägger varje underbiträde motsvarande skyldigheter genom skriftligt avtal och ansvarar fullt ut för underbiträdets behandling.",
        "Underbiträden vid Biträdesavtalets ikraftträdande:",
      ],
      bullets: providers.filter((p) => p.role !== "självständigt ansvarig").map((p) => `${p.name} – ${p.purpose} (${p.region})`),
    },
    {
      title: "6. Överföring till tredjeland",
      body: [
        "Behandling sker inom EU/EES där leverantören erbjuder det. Överföring till tredjeland sker endast med stöd av kapitel V GDPR – EU-kommissionens standardavtalsklausuler, kompletterande skyddsåtgärder (kryptering, pseudonymisering) och där tillämpligt EU–US Data Privacy Framework – enligt uppgifterna på /underbitraden.",
      ],
    },
    {
      title: "7. Radering och återlämnande",
      body: [
        "När tjänsten upphör återlämnar Biträdet personuppgifterna genom export (SIE, dokument, JSON) och raderar eller anonymiserar därefter de uppgifter som inte måste bevaras enligt lag. Räkenskapsinformation som Biträdet är skyldigt att bevara enligt bokföringslagen, eller som den Ansvarige uttryckligen begär att Biträdet fortsätter bevara, hålls skrivskyddad och raderas när bevarandetiden löpt ut.",
      ],
    },
    {
      title: "8. Ansvar och avtalstid",
      body: [
        "Ansvarsbegränsningen i de allmänna villkoren gäller även Biträdesavtalet, i den utsträckning tvingande lag medger. Biträdesavtalet gäller så länge Biträdet behandlar personuppgifter för den Ansvariges räkning.",
      ],
    },
    {
      title: "Säkerhetsbilaga – tekniska och organisatoriska åtgärder",
      body: ["Biträdet upprätthåller minst följande åtgärder:"],
      bullets: [
        "Åtkomstkontroll: individuella konton, verifierad e-post, tvingande TOTP-flerfaktorsautentisering för all plattformsadministration, roller och behörigheter per företag, radnivåsäkerhet (RLS) i databasen så att ett företag aldrig kan läsa ett annat företags data.",
        "Kryptering: TLS för all trafik, kryptering i vila hos databas- och lagringsleverantör, hemligheter enbart i servermiljö – aldrig i klientkod eller mobilpaket.",
        "Integritet och spårbarhet: oföränderliga verifikationer, bokföringsposter, fakturaögonblicksbilder och auditloggar (databastriggrar), auditerad supportåtkomst, versionshistorik för dokument.",
        "Loggning och övervakning: felövervakning med skrubbning av personnummer, tokens, mejl- och dokumentinnehåll; hälsokontroller; larm vid webhook-, cron- och integrationsfel.",
        "Tillgänglighet och återställning: dagliga säkerhetskopior och punkt-i-tid-återställning hos databasleverantören, dokumenterad återställningsrutin som övas och registreras, mål för RPO/RTO redovisas i adminvyn.",
        "Leverantörsstyrning: centralt leverantörsregister, DPA med varje underbiträde, val av EU-region där det erbjuds.",
        "Incidenthantering: dokumenterad runbook för incidenter, nyckelrotation, e-post-, bank-, betalnings- och inlämningsstopp; underrättelse till den Ansvarige inom 48 timmar.",
        "Dataminimering: personnummer och känsliga fält visas maskerade i admin, avslöjande loggas; AI-leverantör får bara den text som behövs för tolkningen.",
        "Utveckling: kodgranskning, automatiska tester av behörighet, oföränderlighet och skrubbning i varje byggkedja; separata test- och produktionsmiljöer.",
      ],
    },
  ];
}
