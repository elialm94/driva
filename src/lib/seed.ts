import type {
  ActivityEvent,
  BankTransaction,
  DB,
  DocLine,
  Invoice,
  Job,
  JobWorkEntry,
  LineKind,
  PaymentFile,
  Quote,
  QuoteAcceptance,
  QuoteVersion,
  Reminder,
  SupplierInvoice,
  SupplierPayment,
  VatRate,
  Verification,
  VerificationEntry,
  VerificationSource,
} from "./types";
import { syncDocLineClassification } from "./economic-line-type";
import { getPaymentExportProvider } from "./banking/payment-export";
import {
  entriesExpense,
  entriesInvoicePaid,
  entriesInvoiceSent,
  entriesSupplierInvoicePaid,
  entriesSupplierInvoiceReceived,
  entriesTaxPayment,
} from "./bas";
import { docTotals } from "./calc";
import { quoteVersionHash } from "./hash";
import { acceptanceStatement } from "./quote-acceptance";
import { ocrForInvoice } from "./ids";
import { snapshotTaxReductionTerms } from "./tax-reduction-terms";
import { STANDARD_TERMS } from "./standard-quote-terms";

/* Datum relativt "nu" så att demon alltid känns levande. */
function d(daysAgo: number, hour = 10, minute = 0): string {
  const t = new Date(Date.now() - daysAgo * 86_400_000);
  t.setHours(hour, minute, 0, 0);
  return t.toISOString();
}

function L(kind: LineKind, description: string, qty: number, unit: string, unitPrice: number, vatRate: VatRate = 25): DocLine {
  return syncDocLineClassification({
    id: `line-${Math.random().toString(36).slice(2, 9)}`,
    kind,
    description,
    qty,
    unit,
    unitPrice,
    vatRate,
  });
}

/**
 * Företagets betalkonto i demon (pain.001-debitorn): SEB, slutar på 4512 –
 * samma konto som bankkopplingen visar. Giltigt mod-97-IBAN.
 */
const PAYER_IBAN = "SE2750000000054910004512";
const PAYER_BIC = "ESSESESS";

export function buildSeed(): DB {
  /* ------------------------------- Kunder ------------------------------- */
  const customers = [
    {
      id: "cust-anna",
      kind: "privat" as const,
      name: "Anna Andersson",
      email: "anna.andersson@gmail.com",
      phone: "070-123 45 67",
      address: "Folkungagatan 62",
      postalCode: "116 30",
      city: "Stockholm",
      personalIdentityNumber: "19850515-1234",
      workLocations: [
        {
          id: "loc-anna-hem",
          label: "Hem",
          address: "Folkungagatan 62",
          postalCode: "116 30",
          city: "Stockholm",
          propertyType: "smahus" as const,
        },
      ],
      defaultWorkLocationId: "loc-anna-hem",
      notes: "Vill helst ha sms före besök. Porten har kod 4218.",
      createdAt: d(75),
    },
    {
      id: "cust-brf",
      kind: "foretag" as const,
      name: "Brf Eken",
      contactPerson: "Maria Sandberg",
      orgNumber: "769612-3456",
      email: "styrelsen@brfeken.se",
      phone: "08-640 22 10",
      address: "Åsögatan 114",
      postalCode: "116 24",
      city: "Stockholm",
      notes: "Fakturor märks med 'Att: styrelsen'. Maria svarar snabbast på mejl.",
      createdAt: d(140),
    },
    {
      id: "cust-johan",
      kind: "privat" as const,
      name: "Johan Lindberg",
      email: "johan.lindberg@outlook.com",
      phone: "073-987 65 43",
      address: "Tantogatan 27",
      postalCode: "118 42",
      city: "Stockholm",
      notes: "",
      createdAt: d(110),
    },
    {
      id: "cust-nord",
      kind: "foretag" as const,
      name: "Nord Studio AB",
      contactPerson: "Elin Nord",
      orgNumber: "559234-5678",
      email: "elin@nordstudio.se",
      phone: "070-556 12 40",
      address: "Hornsgatan 98",
      postalCode: "117 26",
      city: "Stockholm",
      notes: "Designbyrå. Betalar alltid i tid. Etapp 2 diskuteras.",
      createdAt: d(190),
    },
    {
      id: "cust-sara",
      kind: "privat" as const,
      name: "Sara Nilsson",
      email: "sara.nilsson@gmail.com",
      phone: "072-556 71 20",
      address: "Blekingegatan 34",
      postalCode: "118 56",
      city: "Stockholm",
      notes: "",
      createdAt: d(1),
    },
    {
      id: "cust-karin",
      kind: "privat" as const,
      name: "Karin Ek",
      email: "karin.ek@icloud.com",
      phone: "070-334 82 19",
      address: "Katarina Bangata 19",
      postalCode: "116 39",
      city: "Stockholm",
      notes: "",
      createdAt: d(0, 8, 45),
    },
    {
      id: "cust-bertil",
      kind: "privat" as const,
      name: "Bertil Lindqvist",
      email: "bertil.lindqvist@telia.com",
      phone: "070-482 19 55",
      address: "Personnevägen 148",
      postalCode: "129 50",
      city: "Hägersten",
      personalIdentityNumber: "19561203-5578",
      workLocations: [
        {
          id: "loc-bertil-villa",
          label: "Villan",
          address: "Personnevägen 148",
          postalCode: "129 50",
          city: "Hägersten",
          propertyType: "smahus" as const,
          propertyDesignation: "Hägersten Ekgläntan 1:24",
        },
      ],
      defaultWorkLocationId: "loc-bertil-villa",
      notes: "Pensionerad lärare. Vill ha ROT-avdraget specificerat på fakturan.",
      createdAt: d(6, 13, 20),
    },
    {
      id: "cust-eva",
      kind: "privat" as const,
      name: "Eva Holmgren",
      email: "eva.holmgren@gmail.com",
      phone: "073-210 48 66",
      address: "Sickla Kanalgata 43",
      postalCode: "120 67",
      city: "Stockholm",
      notes: "Trappräcket klart – nöjd kund, kan användas som referens.",
      createdAt: d(34),
    },
    {
      id: "cust-glantan",
      kind: "foretag" as const,
      name: "Restaurang Gläntan AB",
      contactPerson: "Amir Haddad",
      orgNumber: "559481-2235",
      email: "amir@restaurangglantan.se",
      phone: "08-702 45 90",
      address: "Nytorgsgatan 28",
      postalCode: "116 40",
      city: "Stockholm",
      notes: "Allt arbete måste vara klart före kl 11 när köket öppnar.",
      createdAt: d(58),
    },
  ];

  /* ------------------------------ Offerter ------------------------------ */

  const quotes: Quote[] = [];
  const quoteVersions: QuoteVersion[] = [];

  function addQuote(q: {
    id: string;
    number: number;
    customerId: string;
    jobId?: string;
    status: Quote["status"];
    token: string;
    createdAt: string;
    sentAt?: string;
    viewedAt?: string;
    decidedAt?: string;
    followUps?: string[];
    version: Omit<QuoteVersion, "id" | "quoteId" | "version" | "createdAt"> & { createdAt?: string };
    locked?: boolean;
  }) {
    const versionId = `${q.id}-v1`;
    const version: QuoteVersion = {
      id: versionId,
      quoteId: q.id,
      version: 1,
      createdAt: q.version.createdAt ?? q.createdAt,
      title: q.version.title,
      intro: q.version.intro,
      lines: q.version.lines,
      rot: q.version.rot,
      paymentPlan: q.version.paymentPlan,
      paymentTermsDays: q.version.paymentTermsDays,
      lateInterestRate: q.version.lateInterestRate ?? 10,
      validUntil: q.version.validUntil,
      terms: q.version.terms,
      richText: q.version.richText,
      taxReductionTerms: q.version.taxReductionTerms,
    };
    if (q.locked && q.decidedAt) {
      version.lockedAt = q.decidedAt;
      version.contentHash = quoteVersionHash(version);
    }
    quoteVersions.push(version);
    quotes.push({
      id: q.id,
      number: q.number,
      customerId: q.customerId,
      jobId: q.jobId,
      status: q.status,
      currentVersionId: versionId,
      token: q.token,
      sentAt: q.sentAt,
      viewedAt: q.viewedAt,
      decidedAt: q.decidedAt,
      followUps: q.followUps ?? [],
      createdAt: q.createdAt,
    });
  }

  const standardTerms = STANDARD_TERMS;

  addQuote({
    id: "quote-nord1",
    number: 106,
    customerId: "cust-nord",
    status: "godkand",
    token: "demo-nord-etapp1",
    createdAt: d(60),
    sentAt: d(58, 9, 30),
    viewedAt: d(57, 12, 10),
    decidedAt: d(55, 15, 4),
    locked: true,
    version: {
      title: "Kontorsinredning – etapp 1",
      intro:
        "Platsbyggd förvaring och akustikpanel i ek till ert kontor på Hornsgatan, enligt vårt möte den 25 juni.",
      lines: [
        L("arbete", "Snickeri och montering", 40, "tim", 580),
        L("material", "Ekfanér, stommar och akustikpanel", 1, "st", 13600),
      ],
      rot: null,
      paymentPlan: [{ label: "Betalning när arbetet är klart", percent: 100 }],
      paymentTermsDays: 30,
      validUntil: d(28),
      terms: standardTerms,
    },
  });

  addQuote({
    id: "quote-kok",
    number: 110,
    customerId: "cust-anna",
    jobId: "job-kok",
    status: "godkand",
    token: "demo-anna-kok",
    createdAt: d(28),
    sentAt: d(27, 9, 15),
    viewedAt: d(26, 19, 42),
    decidedAt: d(24, 14, 32),
    locked: true,
    version: {
      title: "Köksrenovering",
      intro:
        "Renovering av kök på Folkungagatan 62 enligt vårt hembesök: nya luckor och stommar, bänkskiva i ek samt ny belysning under överskåpen.",
      lines: [
        L("arbete", "Snickeriarbete: rivning, stomjustering och montering", 96, "tim", 550),
        L("material", "Luckor, stommar och bänkskiva i ek", 1, "st", 15200),
      ],
      rot: null,
      paymentPlan: [
        { label: "Vid arbetets start", percent: 30 },
        { label: "När arbetet är klart och godkänt", percent: 70 },
      ],
      paymentTermsDays: 10,
      validUntil: d(-3),
      terms: standardTerms,
    },
  });

  addQuote({
    id: "quote-altan",
    number: 111,
    customerId: "cust-johan",
    jobId: "job-altan",
    status: "godkand",
    token: "demo-johan-altan",
    createdAt: d(26),
    sentAt: d(25, 14, 0),
    viewedAt: d(23, 8, 55),
    decidedAt: d(20, 11, 18),
    locked: true,
    version: {
      title: "Altanrenovering",
      intro:
        "Rivning av befintlig altan och nybyggnad om ca 22 kvm med tryckimpregnerat virke, inklusive nytt räcke och trappsteg.",
      lines: [
        L("arbete", "Rivning av befintlig altan samt nybyggnad", 56, "tim", 550),
        L("material", "Tryckimpregnerat virke, skruv och plintar", 1, "st", 10000),
      ],
      rot: null,
      paymentPlan: [
        { label: "Vid arbetets start", percent: 50 },
        { label: "När arbetet är klart och godkänt", percent: 50 },
      ],
      paymentTermsDays: 14,
      validUntil: d(-5),
      terms: standardTerms,
    },
  });

  addQuote({
    id: "quote-dorrar",
    number: 112,
    customerId: "cust-brf",
    status: "skickad",
    token: "demo-brf-dorrar",
    createdAt: d(8),
    sentAt: d(8, 11, 20),
    viewedAt: d(7, 9, 5),
    version: {
      title: "Byte av förrådsdörrar",
      intro:
        "Byte av 12 förrådsdörrar i källargången på Åsögatan 114, inklusive nya karmar och lås enligt styrelsens önskemål.",
      lines: [
        L("arbete", "Demontering och montering av dörrar", 24, "tim", 500),
        L("material", "Förrådsdörrar med karm och hänglåsbeslag, 12 st", 1, "st", 7200),
      ],
      rot: null,
      paymentPlan: [{ label: "Betalning när arbetet är klart", percent: 100 }],
      paymentTermsDays: 30,
      validUntil: d(-22),
      terms: standardTerms,
      // Demodata för "Övrig information" (rik text) – visas på offerten/kundvyn/PDF.
      richText: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Detta ingår" }] },
          {
            type: "bulletList",
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Bortforsling av gamla dörrar och emballage" }] }] },
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Nya hänglåsbeslag monterade på samtliga dörrar" }] }] },
            ],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Arbetet utförs vardagar 07–16. Vi behöver " },
              { type: "text", text: "fri tillgång till källargången", marks: [{ type: "bold" }] },
              { type: "text", text: " under arbetsdagen." },
            ],
          },
        ],
      },
    },
  });

  addQuote({
    id: "quote-garderob",
    number: 113,
    customerId: "cust-anna",
    jobId: "job-garderob",
    status: "skickad",
    token: "demo-anna-garderob",
    createdAt: d(3),
    sentAt: d(2, 10, 12),
    viewedAt: d(1, 21, 8),
    version: {
      title: "Platsbyggd garderob",
      intro:
        "Platsbyggd garderob i hallen på Folkungagatan 62: vitmålade släta luckor golv till tak, inredning med hyllor och klädstänger.",
      lines: [
        L("arbete", "Snickeri och montering", 32, "tim", 500),
        L("material", "Stomme, dörrar och inredning", 1, "st", 9600),
      ],
      rot: { type: "rot" },
      taxReductionTerms: snapshotTaxReductionTerms("rot"),
      paymentPlan: [{ label: "Betalning när arbetet är klart", percent: 100 }],
      paymentTermsDays: 10,
      validUntil: d(-28),
      terms: standardTerms,
    },
  });

  addQuote({
    id: "quote-nord2",
    number: 114,
    customerId: "cust-nord",
    jobId: "job-nord2",
    status: "skickad",
    token: "demo-nord-etapp2",
    createdAt: d(2),
    sentAt: d(1, 15, 45),
    version: {
      title: "Kontorsinredning – etapp 2",
      intro:
        "Fortsättning på inredningen av ert kontor: platsbyggd bokhylla i konferensrummet samt ny köksö i personalköket.",
      lines: [
        L("arbete", "Snickeri och montering", 40, "tim", 580),
        L("material", "Materialpaket enligt specifikation", 1, "st", 14000),
      ],
      rot: null,
      paymentPlan: [{ label: "Betalning när arbetet är klart", percent: 100 }],
      paymentTermsDays: 30,
      validUntil: d(-29),
      terms: standardTerms,
    },
  });

  // Skickad och öppnad – väntar på kundens godkännande. Komplett ROT-exempel:
  // arbete + material + restid, fastighet via uppdragets arbetsplats,
  // betalningsplan i två steg och ROT-villkor.
  addQuote({
    id: "quote-fasad",
    number: 115,
    customerId: "cust-bertil",
    jobId: "job-fasad",
    status: "skickad",
    token: "demo-bertil-fasad",
    createdAt: d(5),
    sentAt: d(4, 9, 40),
    viewedAt: d(3, 18, 25),
    version: {
      title: "Fasadarbete och nya fönsterfoder",
      intro:
        "Byte av rötskadad panel på södergaveln, nya fönsterfoder och komplett ommålning av fasaden på Personnevägen 148, enligt vårt hembesök.",
      lines: [
        L("arbete", "Byte av panel, foder och målning", 68, "tim", 550),
        L("material", "Fasadpanel, foder, grund- och täckfärg", 1, "st", 18400),
        L("resor", "Restid servicebil", 6, "tim", 350),
      ],
      rot: { type: "rot" },
      taxReductionTerms: snapshotTaxReductionTerms("rot"),
      paymentPlan: [
        { label: "Vid arbetets start", percent: 40 },
        { label: "När arbetet är klart och godkänt", percent: 60 },
      ],
      paymentTermsDays: 14,
      validUntil: d(-25),
      terms: standardTerms,
    },
  });

  // Utkast: Eva frågade om en bokhylla när räcket monterades – offerten är
  // påbörjad men inte skickad.
  addQuote({
    id: "quote-bokhylla",
    number: 116,
    customerId: "cust-eva",
    status: "utkast",
    token: "demo-eva-bokhylla",
    createdAt: d(0, 9, 30),
    version: {
      title: "Platsbyggd bokhylla i ek",
      intro:
        "Platsbyggd bokhylla i vitoljad ek till vardagsrummet, med justerbara hyllplan och sockel anpassad efter golvlisten.",
      lines: [
        L("arbete", "Snickeri och montering", 36, "tim", 550),
        L("material", "Ekskivor, hyllbärare och vitolja", 1, "st", 12800),
      ],
      rot: { type: "rot" },
      taxReductionTerms: snapshotTaxReductionTerms("rot"),
      paymentPlan: [{ label: "Betalning när arbetet är klart", percent: 100 }],
      paymentTermsDays: 10,
      validUntil: d(-30),
      terms: standardTerms,
    },
  });

  /* ----------------------------- Offertgodkännanden ---------------------------- */

  // Kunden skrev sitt namn och tryckte Godkänn offert på offertlänken.
  // statement är exakt den mening som visades – samma helper som kundsidan.
  function accepted(a: {
    id: string;
    quoteId: string;
    versionId: string;
    name: string;
    customerName: string;
    email: string;
    at: string;
    ip: string;
    userAgent: string;
  }): QuoteAcceptance {
    const version = quoteVersions.find((v) => v.id === a.versionId)!;
    const t = docTotals(version.lines, version.rot);
    return {
      id: a.id,
      quoteId: a.quoteId,
      quoteVersionId: a.versionId,
      method: "simple_accept",
      acceptedAt: a.at,
      acceptedByName: a.name,
      customerNameAtAccept: a.customerName,
      acceptedByEmail: a.email,
      contentHash: version.contentHash!,
      statement: acceptanceStatement({
        title: version.title,
        companyName: "Södermalms Snickeri AB",
        datedIso: version.createdAt,
        total: t.total,
        deduction: t.deduction,
      }),
      ip: a.ip,
      userAgent: a.userAgent,
      linkSentTo: a.email,
    };
  }

  const signatures: QuoteAcceptance[] = [
    accepted({
      id: "sig-nord1",
      quoteId: "quote-nord1",
      versionId: "quote-nord1-v1",
      name: "Elin Nord",
      customerName: "Nord Studio AB",
      email: "elin@nordstudio.se",
      at: d(55, 15, 4),
      ip: "83.233.12.41",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    }),
    accepted({
      id: "sig-kok",
      quoteId: "quote-kok",
      versionId: "quote-kok-v1",
      name: "Anna Andersson",
      customerName: "Anna Andersson",
      email: "anna.andersson@gmail.com",
      at: d(24, 14, 32),
      ip: "90.229.104.7",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    }),
    accepted({
      id: "sig-altan",
      quoteId: "quote-altan",
      versionId: "quote-altan-v1",
      name: "Johan Lindberg",
      customerName: "Johan Lindberg",
      email: "johan.lindberg@outlook.com",
      at: d(20, 11, 18),
      ip: "78.72.55.190",
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
    }),
  ];

  /* -------------------------------- Uppdrag -------------------------------- */

  const jobs: Job[] = [
    {
      id: "job-kok",
      customerId: "cust-anna",
      quoteId: "quote-kok",
      title: "Köksrenovering",
      description: "Nya luckor, stommar, bänkskiva i ek och belysning enligt offert #110.",
      status: "pagar",
      startDate: d(10),
      endDate: d(-5),
      address: "Folkungagatan 62, Stockholm",
      checklist: [
        { id: "c1", text: "Rivning av gamla köket", done: true },
        { id: "c2", text: "Stommar och luckor", done: true },
        { id: "c3", text: "Montering av bänkskiva", done: true },
        { id: "c4", text: "Stänkskydd", done: false },
        { id: "c5", text: "Belysning under överskåp", done: false },
        { id: "c6", text: "Slutstädning och genomgång med kund", done: false },
      ],
      notes:
        "Bänkskivan levererades 21 aug. Kunden ville flytta ett eluttag – löst med elektriker 25 aug.",
      createdAt: d(24, 14, 32),
      workLocationId: "loc-anna-hem",
      housing: { dwellingType: "smahus" },
      source: "web_form" as const,
      originalMessage: "Vi vill renovera köket – nya luckor, bänkskiva och ny belysning. Kan ni komma på hembesök?",
    },
    {
      id: "job-altan",
      customerId: "cust-johan",
      quoteId: "quote-altan",
      title: "Altanrenovering",
      description: "Rivning och nybyggnad av altan ca 22 kvm enligt offert #111.",
      status: "kommande",
      startDate: d(-5),
      endDate: d(-12),
      address: "Tantogatan 27, Stockholm",
      checklist: [
        { id: "c1", text: "Riva gammal altan", done: false },
        { id: "c2", text: "Plintar och bärlinor", done: false },
        { id: "c3", text: "Trall och räcke", done: false },
        { id: "c4", text: "Slutbesiktning med kund", done: false },
      ],
      notes: "Virke beställt från Beijer, leverans till adressen dagen före start.",
      createdAt: d(20, 11, 18),
    },
    {
      id: "job-fonster",
      customerId: "cust-brf",
      title: "Fönsterbyte gårdshus",
      description: "Byte av 6 fönster i gårdshuset, inklusive foder och smygar.",
      status: "klart",
      startDate: d(30),
      endDate: d(26),
      address: "Åsögatan 114, Stockholm",
      checklist: [
        { id: "c1", text: "Demontering av gamla fönster", done: true },
        { id: "c2", text: "Montering av nya fönster", done: true },
        { id: "c3", text: "Foder och smygar", done: true },
      ],
      notes: "",
      createdAt: d(32),
      completedAt: d(26, 16, 20),
    },
    {
      id: "job-nord1",
      customerId: "cust-nord",
      quoteId: "quote-nord1",
      title: "Kontorsinredning etapp 1",
      description: "Platsbyggd förvaring och akustikpanel enligt offert #106.",
      status: "klart",
      startDate: d(50),
      endDate: d(40),
      address: "Hornsgatan 98, Stockholm",
      checklist: [
        { id: "c1", text: "Platsbyggd förvaring", done: true },
        { id: "c2", text: "Akustikpanel", done: true },
      ],
      notes: "Etapp 2 offererad.",
      createdAt: d(55, 15, 4),
      completedAt: d(40, 15, 0),
    },
    {
      id: "job-kokso",
      customerId: "cust-johan",
      title: "Platsbyggd köksö",
      description: "Köksö med ekskiva och förvaring.",
      status: "klart",
      startDate: d(92),
      endDate: d(86),
      address: "Tantogatan 27, Stockholm",
      checklist: [],
      notes: "",
      createdAt: d(98),
      completedAt: d(86, 14, 0),
    },
    {
      id: "job-sara",
      customerId: "cust-sara",
      title: "Byte av köksluckor och bänkskiva",
      description:
        "Hej! Vi vill byta luckor och bänkskiva i köket. Gärna i oktober om det går. Lägenhet på Söder, köket är ca 12 kvm.",
      status: "kommande",
      address: "Blekingegatan 34, Stockholm",
      checklist: [],
      notes: "",
      createdAt: d(1, 9, 12),
      source: "web_form" as const,
      originalMessage:
        "Hej! Vi vill byta luckor och bänkskiva i köket. Gärna i oktober om det går. Lägenhet på Söder, köket är ca 12 kvm.",
    },
    {
      id: "job-karin",
      customerId: "cust-karin",
      title: "Platsbyggd bokhylla i ek",
      description:
        "Ringde och vill ha offert på en platsbyggd bokhylla i ek till vardagsrummet, ca 3,2 meter bred och golv till tak.",
      status: "kommande",
      address: "Katarina Bangata 19, Stockholm",
      checklist: [],
      notes: "",
      createdAt: d(0, 8, 45),
      source: "phone" as const,
      originalMessage:
        "Ringde och vill ha offert på en platsbyggd bokhylla i ek till vardagsrummet, ca 3,2 meter bred och golv till tak.",
    },
    {
      id: "job-garderob",
      customerId: "cust-anna",
      quoteId: "quote-garderob",
      title: "Platsbyggd garderob",
      description: "Hej igen! Nu när köket snart är klart – skulle ni kunna bygga en garderob i hallen också?",
      status: "kommande",
      address: "Folkungagatan 62, Stockholm",
      checklist: [],
      notes: "",
      createdAt: d(12, 18, 5),
      workLocationId: "loc-anna-hem",
      housing: { dwellingType: "smahus" },
      source: "email" as const,
      originalMessage: "Hej igen! Nu när köket snart är klart – skulle ni kunna bygga en garderob i hallen också?",
    },
    {
      id: "job-nord2",
      customerId: "cust-nord",
      quoteId: "quote-nord2",
      title: "Kontorsinredning etapp 2",
      description: "Vi vill gå vidare med etapp 2 – bokhyllan i konferensrummet och köksön vi pratade om.",
      status: "kommande",
      address: "Hornsgatan 98, Stockholm",
      checklist: [],
      notes: "",
      createdAt: d(9, 10, 40),
      source: "email" as const,
      originalMessage: "Vi vill gå vidare med etapp 2 – bokhyllan i konferensrummet och köksön vi pratade om.",
    },
    {
      id: "job-fasad",
      customerId: "cust-bertil",
      quoteId: "quote-fasad",
      title: "Fasadarbete och nya fönsterfoder",
      description: "Byte av rötskadad panel på södergaveln, nya foder och ommålning enligt offert #115.",
      status: "kommande",
      address: "Personnevägen 148, Hägersten",
      checklist: [],
      notes: "Ställning bokas så snart offerten är godkänd.",
      createdAt: d(6, 13, 40),
      workLocationId: "loc-bertil-villa",
      housing: { dwellingType: "smahus", propertyDesignation: "Hägersten Ekgläntan 1:24" },
      source: "phone" as const,
      originalMessage: "Ringde om rötskador i panelen på södergaveln – vill ha offert på byte och ommålning.",
    },
    // Klart men ännu inte fakturerat: registrerat arbete/material ligger som
    // ofakturerade poster – "klart för fakturering" i appen.
    {
      id: "job-racke",
      customerId: "cust-eva",
      title: "Nytt trappräcke i ek",
      description: "Tillverkning och montering av trappräcke i ek med svarta smidesstolpar.",
      status: "klart",
      startDate: d(9),
      endDate: d(7),
      address: "Sickla Kanalgata 43, Stockholm",
      checklist: [
        { id: "c1", text: "Tillverkning i verkstad", done: true },
        { id: "c2", text: "Montering och oljning på plats", done: true },
      ],
      notes: "Klart och godkänt av kund på plats.",
      createdAt: d(16),
      completedAt: d(7, 15, 30),
    },
  ];

  /* --------------------------- Tid & material ---------------------------- */

  // Registrerade poster på uppdrag: planned = avtalad offertbaseline,
  // actual = utfört arbete/material. Ofakturerade actuals (utan invoiceId)
  // är underlaget för "klart för fakturering".
  function W(entry: {
    id: string;
    jobId: string;
    role: JobWorkEntry["role"];
    type: JobWorkEntry["type"];
    description: string;
    daysAgo: number;
    qty: number;
    unit: string;
    unitPrice: number;
    source?: JobWorkEntry["source"];
    isExtra?: boolean;
    invoiceId?: string;
  }): JobWorkEntry {
    return {
      id: entry.id,
      jobId: entry.jobId,
      role: entry.role,
      type: entry.type,
      description: entry.description,
      date: d(entry.daysAgo).slice(0, 10),
      qty: entry.qty,
      unit: entry.unit,
      unitPrice: entry.unitPrice,
      vatRate: 25,
      source: entry.source ?? "manual",
      isExtra: entry.isExtra ?? false,
      invoiceId: entry.invoiceId,
      createdAt: d(entry.daysAgo, 17, 0),
      updatedAt: d(entry.daysAgo, 17, 0),
    };
  }

  const jobWorkEntries: JobWorkEntry[] = [
    // Köksrenoveringen (pågår): baseline från offert #110 + utfört hittills.
    W({ id: "jwe-kok-p1", jobId: "job-kok", role: "planned", type: "labor", description: "Snickeriarbete: rivning, stomjustering och montering", daysAgo: 10, qty: 96, unit: "tim", unitPrice: 550, source: "quote" }),
    W({ id: "jwe-kok-p2", jobId: "job-kok", role: "planned", type: "material", description: "Luckor, stommar och bänkskiva i ek", daysAgo: 10, qty: 1, unit: "st", unitPrice: 15200, source: "quote" }),
    W({ id: "jwe-kok-a1", jobId: "job-kok", role: "actual", type: "labor", description: "Rivning av gamla köket och stomjustering", daysAgo: 9, qty: 16, unit: "tim", unitPrice: 550 }),
    W({ id: "jwe-kok-a2", jobId: "job-kok", role: "actual", type: "labor", description: "Montering av stommar och luckor", daysAgo: 6, qty: 24, unit: "tim", unitPrice: 550 }),
    W({ id: "jwe-kok-a3", jobId: "job-kok", role: "actual", type: "labor", description: "Bänkskiva: kapning, passbitar och montering", daysAgo: 2, qty: 12, unit: "tim", unitPrice: 550 }),
    W({ id: "jwe-kok-a4", jobId: "job-kok", role: "actual", type: "material", description: "Luckor, stommar och bänkskiva i ek (levererat)", daysAgo: 6, qty: 1, unit: "st", unitPrice: 15200 }),
    W({ id: "jwe-kok-a5", jobId: "job-kok", role: "actual", type: "labor", description: "Extraarbete: urtag och anpassning för flyttat eluttag", daysAgo: 5, qty: 2, unit: "tim", unitPrice: 550, isExtra: true }),
    // Altanen (kommande): bara avtalad baseline än så länge.
    W({ id: "jwe-altan-p1", jobId: "job-altan", role: "planned", type: "labor", description: "Rivning av befintlig altan samt nybyggnad", daysAgo: 20, qty: 56, unit: "tim", unitPrice: 550, source: "quote" }),
    W({ id: "jwe-altan-p2", jobId: "job-altan", role: "planned", type: "material", description: "Tryckimpregnerat virke, skruv och plintar", daysAgo: 20, qty: 1, unit: "st", unitPrice: 10000, source: "quote" }),
    // Trappräcket (klart): allt utfört, inget fakturerat ännu.
    W({ id: "jwe-racke-a1", jobId: "job-racke", role: "actual", type: "labor", description: "Tillverkning av räcke i verkstad", daysAgo: 9, qty: 9, unit: "tim", unitPrice: 550 }),
    W({ id: "jwe-racke-a2", jobId: "job-racke", role: "actual", type: "labor", description: "Montering, justering och oljning på plats", daysAgo: 7, qty: 5, unit: "tim", unitPrice: 550 }),
    W({ id: "jwe-racke-a3", jobId: "job-racke", role: "actual", type: "material", description: "Ekräcke, smidesstolpar och infästning", daysAgo: 7, qty: 1, unit: "st", unitPrice: 3900 }),
    W({ id: "jwe-racke-a4", jobId: "job-racke", role: "actual", type: "travel", description: "Restid till och från Sickla", daysAgo: 7, qty: 2, unit: "tim", unitPrice: 350 }),
  ];

  /* ------------------------------ Fakturor ------------------------------ */

  const invoices: Invoice[] = [];

  function addInvoice(inv: {
    id: string;
    number: number;
    customerId: string;
    jobId?: string;
    quoteId?: string;
    type: Invoice["type"];
    status: Invoice["status"];
    lines: DocLine[];
    rot?: Invoice["rot"];
    richText?: Invoice["richText"];
    issueDate: string;
    dueDate: string;
    sentAt?: string;
    paidAt?: string;
    reminders?: string[];
    token: string;
  }) {
    // Utkast är inte utfärdade: nummer och OCR tilldelas först vid issueInvoice.
    const draft = inv.status === "utkast";
    invoices.push({
      ...inv,
      number: draft ? null : inv.number,
      rot: inv.rot ?? null,
      lateInterestRate: 10,
      paymentTermsDays: 30,
      issuedAt: draft ? undefined : inv.sentAt ?? inv.issueDate,
      reminders: inv.reminders ?? [],
      ocr: draft ? "" : ocrForInvoice(inv.number),
      createdAt: inv.issueDate,
    });
  }

  addInvoice({
    id: "inv-1033",
    number: 1033,
    customerId: "cust-nord",
    type: "faktura",
    status: "betald",
    lines: [
      L("arbete", "Snickeri och montering, receptionsdisk", 64, "tim", 550),
      L("material", "Ekfanér och beslag", 1, "st", 11200),
    ],
    issueDate: d(150),
    dueDate: d(120),
    sentAt: d(150, 11, 0),
    paidAt: d(138),
    token: "demo-f1033",
  });

  addInvoice({
    id: "inv-1034",
    number: 1034,
    customerId: "cust-brf",
    type: "faktura",
    status: "betald",
    lines: [
      L("arbete", "Trapphusrenovering: snickerier och lister", 108, "tim", 550),
      L("material", "Lister, foder och färg", 1, "st", 17400),
    ],
    issueDate: d(130),
    dueDate: d(100),
    sentAt: d(130, 9, 0),
    paidAt: d(118),
    token: "demo-f1034",
  });

  addInvoice({
    id: "inv-1035",
    number: 1035,
    customerId: "cust-glantan",
    type: "faktura",
    status: "betald",
    lines: [
      L("arbete", "Ny bardisk och hyllor i ek, tillverkning och montering", 52, "tim", 580),
      L("material", "Ekskivor, stomme och mässingsbeslag", 1, "st", 16800),
    ],
    issueDate: d(105),
    dueDate: d(75),
    sentAt: d(105, 8, 30),
    paidAt: d(95),
    token: "demo-f1035",
  });

  addInvoice({
    id: "inv-1036",
    number: 1036,
    customerId: "cust-johan",
    jobId: "job-kokso",
    type: "faktura",
    status: "betald",
    lines: [
      L("arbete", "Platsbyggd köksö, snickeri och montering", 44, "tim", 550),
      L("material", "Ekskiva och stommar", 1, "st", 9400),
    ],
    issueDate: d(85),
    dueDate: d(55),
    sentAt: d(85, 13, 0),
    paidAt: d(78),
    token: "demo-f1036",
  });

  addInvoice({
    id: "inv-1040",
    number: 1040,
    customerId: "cust-brf",
    type: "faktura",
    status: "betald",
    lines: [
      L("arbete", "Byte av trall på gårdsdäck", 14, "tim", 550),
      L("material", "Trallvirke och skruv", 1, "st", 2300),
    ],
    issueDate: d(40),
    dueDate: d(10),
    sentAt: d(40, 10, 0),
    paidAt: d(33),
    token: "demo-f1040",
  });

  addInvoice({
    id: "inv-1039",
    number: 1039,
    customerId: "cust-nord",
    jobId: "job-nord1",
    quoteId: "quote-nord1",
    type: "slutfaktura",
    status: "betald",
    lines: [
      L("arbete", "Snickeri och montering", 40, "tim", 580),
      L("material", "Ekfanér, stommar och akustikpanel", 1, "st", 13600),
    ],
    issueDate: d(35),
    dueDate: d(5),
    sentAt: d(35, 9, 30),
    paidAt: d(28),
    token: "demo-f1039",
  });

  addInvoice({
    id: "inv-1042",
    number: 1042,
    customerId: "cust-brf",
    jobId: "job-fonster",
    type: "slutfaktura",
    status: "skickad",
    lines: [
      L("arbete", "Fönsterbyte gårdshus: demontering och montering", 24, "tim", 550),
      L("material", "Foder, smygar och drev", 1, "st", 5200),
    ],
    // Demodata för "Övrig information" – fryses i issuedSnapshot (hydrering i store).
    richText: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Om fakturan" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Avser slutfört fönsterbyte enligt godkänd offert. Frågor om fakturan? Mejla " },
            { type: "text", text: "info@sodermalmssnickeri.se", marks: [{ type: "link", attrs: { href: "mailto:info@sodermalmssnickeri.se" } }] },
            { type: "text", text: "." },
          ],
        },
      ],
    },
    issueDate: d(36),
    dueDate: d(6),
    sentAt: d(36, 14, 10),
    token: "demo-f1042",
  });

  addInvoice({
    id: "inv-1041",
    number: 1041,
    customerId: "cust-johan",
    type: "faktura",
    status: "betald",
    lines: [
      L("arbete", "Justering av dörrar och lister", 6, "tim", 550),
      L("ovrigt", "Servicebil och förbrukningsmaterial", 1, "st", 540),
    ],
    issueDate: d(13),
    dueDate: d(-17),
    sentAt: d(13, 16, 0),
    paidAt: d(6),
    token: "demo-f1041",
  });

  addInvoice({
    id: "inv-1045",
    number: 1045,
    customerId: "cust-anna",
    jobId: "job-kok",
    quoteId: "quote-kok",
    type: "delbetalning",
    status: "betald",
    lines: [L("arbete", "Delbetalning 1 av 2 – Köksrenovering (30 % vid arbetets start)", 1, "st", 20400)],
    issueDate: d(22),
    dueDate: d(12),
    sentAt: d(22, 9, 0),
    paidAt: d(16),
    token: "demo-f1045",
  });

  addInvoice({
    id: "inv-1047",
    number: 1047,
    customerId: "cust-johan",
    jobId: "job-altan",
    quoteId: "quote-altan",
    type: "delbetalning",
    status: "skickad",
    lines: [L("arbete", "Delbetalning 1 av 2 – Altanrenovering (50 % vid arbetets start)", 1, "st", 20400)],
    issueDate: d(6),
    dueDate: d(-8),
    sentAt: d(6, 11, 30),
    token: "demo-f1047",
  });

  // Utkast: påbörjad faktura som inte är utfärdad – bokförs inte förrän den
  // skickas (ingen verifikation, ingen nummerserie-låsning).
  addInvoice({
    id: "inv-1048",
    number: 1048,
    customerId: "cust-brf",
    type: "faktura",
    status: "utkast",
    lines: [
      L("arbete", "Lagning av portparti, entré Åsögatan 114", 4, "tim", 550),
      L("material", "Beslag och ny trälist", 1, "st", 480),
    ],
    issueDate: d(0),
    dueDate: d(-30),
    token: "demo-f1048",
  });

  /* ------------------------------- Utgifter ------------------------------ */

  const expenses = [
    // Fall A i demon: kvittot kom via inboxen, matchades mot kortköpet och
    // bokfördes automatiskt. Kvittoflöde = ingen utgående betalning.
    {
      id: "exp-bauhaus",
      supplier: "Bauhaus",
      date: d(3),
      amount: 875,
      vatAmount: 175,
      category: "material",
      description: "Skruv, lister och handverktyg",
      receiptId: "rec-bauhaus",
      bankTransactionId: "tx-bauhaus",
      status: "bokford" as const,
      verificationId: "ver-exp-bauhaus",
      createdAt: d(3),
    },
    {
      id: "exp-clas",
      supplier: "Clas Ohlson",
      date: d(5),
      amount: 349,
      vatAmount: 70,
      status: "saknar_kvitto" as const,
      bankTransactionId: "tx-clas",
      createdAt: d(5),
    },
    {
      id: "exp-hotel",
      supplier: "Grand Hôtel",
      date: d(4),
      amount: 4250,
      vatAmount: 510,
      status: "behover_svar" as const,
      bankTransactionId: "tx-hotel",
      receiptId: "rec-hotel",
      question: {
        text: "Vad gällde betalningen på 4 250 kr till Grand Hôtel?",
        options: ["Hotell", "Kundrepresentation", "Konferens", "Annat"],
      },
      createdAt: d(4),
    },
    {
      id: "exp-beijer",
      supplier: "Beijer Bygg",
      date: d(9),
      amount: 12400,
      vatAmount: 2480,
      category: "material",
      description: "Material till köksrenovering",
      jobId: "job-kok",
      receiptId: "rec-beijer",
      bankTransactionId: "tx-beijer",
      status: "bokford" as const,
      verificationId: "ver-exp-beijer",
      createdAt: d(9),
    },
    {
      id: "exp-circlek",
      supplier: "Circle K",
      date: d(7),
      amount: 820,
      vatAmount: 164,
      category: "drivmedel",
      description: "Diesel, servicebil",
      receiptId: "rec-circlek",
      bankTransactionId: "tx-circlek",
      status: "bokford" as const,
      verificationId: "ver-exp-circlek",
      createdAt: d(7),
    },
    {
      id: "exp-adobe",
      supplier: "Adobe",
      date: d(15),
      amount: 645,
      vatAmount: 129,
      category: "programvara",
      description: "Creative Cloud, månadsabonnemang",
      receiptId: "rec-adobe",
      bankTransactionId: "tx-adobe",
      status: "bokford" as const,
      verificationId: "ver-exp-adobe",
      createdAt: d(15),
    },
    {
      id: "exp-beijer-jul",
      supplier: "Beijer Bygg",
      date: d(45),
      amount: 22000,
      vatAmount: 4400,
      category: "material",
      description: "Virke och skivmaterial",
      receiptId: "rec-beijer-jul",
      bankTransactionId: "tx-beijer-jul",
      status: "bokford" as const,
      verificationId: "ver-exp-beijer-jul",
      createdAt: d(45),
    },
    {
      id: "exp-bauhaus-jul",
      supplier: "Bauhaus",
      date: d(55),
      amount: 3150,
      vatAmount: 630,
      category: "material",
      description: "Beslag och skruv",
      receiptId: "rec-bauhaus-jul",
      bankTransactionId: "tx-bauhaus-jul",
      status: "bokford" as const,
      verificationId: "ver-exp-bauhaus-jul",
      createdAt: d(55),
    },
    {
      id: "exp-beijer-maj",
      supplier: "Beijer Bygg",
      date: d(100),
      amount: 18400,
      vatAmount: 3680,
      category: "material",
      description: "Material trapphusrenovering",
      receiptId: "rec-beijer-maj",
      bankTransactionId: "tx-beijer-maj",
      status: "bokford" as const,
      verificationId: "ver-exp-beijer-maj",
      createdAt: d(100),
    },
    {
      id: "exp-okq8",
      supplier: "OKQ8",
      date: d(92),
      amount: 760,
      vatAmount: 152,
      category: "drivmedel",
      description: "Diesel, servicebil",
      receiptId: "rec-okq8",
      bankTransactionId: "tx-okq8",
      status: "bokford" as const,
      verificationId: "ver-exp-okq8",
      createdAt: d(92),
    },
  ];

  const receipts = [
    {
      id: "rec-bauhaus",
      expenseId: "exp-bauhaus",
      filename: "kvitto-bauhaus.pdf",
      source: "email" as const,
      uploadedAt: d(3, 12, 45),
      extracted: {
        supplier: "Bauhaus",
        date: d(3),
        amount: 875,
        vatAmount: 175,
        description: "Skruv, lister och handverktyg",
        category: "material",
        confidence: "hog" as const,
      },
    },
    {
      id: "rec-beijer",
      expenseId: "exp-beijer",
      filename: "kvitto-beijer-bygg.jpg",
      source: "foto" as const,
      uploadedAt: d(9, 16, 40),
      extracted: {
        supplier: "Beijer Bygg",
        date: d(9),
        amount: 12400,
        vatAmount: 2480,
        description: "Virke, skivmaterial och skruv",
        category: "material",
        confidence: "hog" as const,
      },
    },
    {
      id: "rec-circlek",
      expenseId: "exp-circlek",
      filename: "kvitto-circle-k.jpg",
      source: "foto" as const,
      uploadedAt: d(7, 8, 12),
      extracted: {
        supplier: "Circle K",
        date: d(7),
        amount: 820,
        vatAmount: 164,
        description: "Diesel",
        category: "drivmedel",
        confidence: "hog" as const,
      },
    },
    {
      id: "rec-adobe",
      expenseId: "exp-adobe",
      filename: "adobe-faktura-aug.pdf",
      source: "email" as const,
      uploadedAt: d(15, 6, 2),
      extracted: {
        supplier: "Adobe",
        date: d(15),
        amount: 645,
        vatAmount: 129,
        description: "Creative Cloud",
        category: "programvara",
        confidence: "hog" as const,
      },
    },
    {
      id: "rec-hotel",
      expenseId: "exp-hotel",
      filename: "grand-hotel-kvitto.pdf",
      source: "email" as const,
      uploadedAt: d(4, 12, 30),
      extracted: {
        supplier: "Grand Hôtel",
        date: d(4),
        amount: 4250,
        vatAmount: 510,
        description: "Grand Hôtel Stockholm",
        category: "",
        confidence: "lag" as const,
      },
    },
    {
      id: "rec-beijer-jul",
      expenseId: "exp-beijer-jul",
      filename: "kvitto-beijer-jul.jpg",
      source: "foto" as const,
      uploadedAt: d(45),
      extracted: {
        supplier: "Beijer Bygg",
        date: d(45),
        amount: 22000,
        vatAmount: 4400,
        description: "Virke och skivmaterial",
        category: "material",
        confidence: "hog" as const,
      },
    },
    {
      id: "rec-bauhaus-jul",
      expenseId: "exp-bauhaus-jul",
      filename: "kvitto-bauhaus-jul.jpg",
      source: "foto" as const,
      uploadedAt: d(55),
      extracted: {
        supplier: "Bauhaus",
        date: d(55),
        amount: 3150,
        vatAmount: 630,
        description: "Beslag och skruv",
        category: "material",
        confidence: "hog" as const,
      },
    },
    {
      id: "rec-beijer-maj",
      expenseId: "exp-beijer-maj",
      filename: "kvitto-beijer-maj.jpg",
      source: "foto" as const,
      uploadedAt: d(100),
      extracted: {
        supplier: "Beijer Bygg",
        date: d(100),
        amount: 18400,
        vatAmount: 3680,
        description: "Material trapphus",
        category: "material",
        confidence: "hog" as const,
      },
    },
    {
      id: "rec-okq8",
      expenseId: "exp-okq8",
      filename: "kvitto-okq8.jpg",
      source: "foto" as const,
      uploadedAt: d(92),
      extracted: {
        supplier: "OKQ8",
        date: d(92),
        amount: 760,
        vatAmount: 152,
        description: "Diesel",
        category: "drivmedel",
        confidence: "hog" as const,
      },
    },
  ];

  /* -------------------------- Leverantörsfakturor ------------------------ */

  const supplierInvoices: SupplierInvoice[] = [
    // Fall B i demon: komplett leverantörsfaktura – tolkad med hög konfidens,
    // bokförd av autopiloten och REDO ATT BETALA ([Skapa bankfil]).
    {
      id: "sup-beijer",
      supplier: "Beijer Bygg",
      invoiceNumber: "BB-48211",
      date: d(2),
      dueDate: d(-10),
      amount: 18500,
      vatAmount: 3700,
      description: "Virke och skivmaterial, altanprojekt",
      category: "material",
      status: "obetald",
      accountingStatus: "bokford" as const,
      ocr: "48211",
      bankgiro: "123-4567",
      recipientAccount: "123-4567",
      paymentDetails: {
        state: "VERIFIED" as const,
        verified: {
          method: "bankgiro" as const,
          account: "123-4567",
          ocr: "48211",
          source: "document" as const,
          verifiedAt: d(2, 9, 12),
          verifiedBy: "assistent" as const,
        },
      },
      inboxItemId: "inbox-mail-beijer",
      verificationId: "ver-sup-beijer",
      createdAt: d(2),
    },
    {
      id: "sup-telia-aug",
      supplier: "Telia",
      invoiceNumber: "TEL-2026-08",
      date: d(1),
      dueDate: d(-6),
      amount: 1295,
      vatAmount: 259,
      description: "Mobil och bredband, augusti",
      category: "telefon",
      status: "obetald",
      accountingStatus: "bokford" as const,
      ocr: "20260881",
      bankgiro: "991-2345",
      recipientAccount: "991-2345",
      verificationId: "ver-sup-telia-aug",
      createdAt: d(1),
    },
    {
      id: "sup-hyra-sep",
      supplier: "Fastighets AB Söderport",
      invoiceNumber: "HYRA-2026-09",
      date: d(3),
      dueDate: d(-5),
      amount: 8500,
      vatAmount: 0,
      description: "Verkstadslokal, september",
      category: "hyra",
      status: "obetald",
      accountingStatus: "bokford" as const,
      verificationId: "ver-sup-hyra-sep",
      createdAt: d(3),
    },
    {
      id: "sup-forsakring",
      supplier: "Trygg-Hansa",
      invoiceNumber: "TH-771",
      date: d(4),
      dueDate: d(2),
      amount: 2705,
      vatAmount: 0,
      description: "Företagsförsäkring, kvartal 4",
      category: "forsakring",
      status: "obetald",
      accountingStatus: "bokford" as const,
      ocr: "7710021",
      bankgiro: "330-1122",
      recipientAccount: "330-1122",
      verificationId: "ver-sup-forsakring",
      createdAt: d(4),
    },
    {
      id: "sup-telia-jul",
      supplier: "Telia",
      invoiceNumber: "TEL-2026-07",
      date: d(32),
      dueDate: d(18),
      amount: 1295,
      vatAmount: 259,
      description: "Mobil och bredband, juli",
      category: "telefon",
      status: "betald",
      accountingStatus: "bokford" as const,
      ocr: "20260771",
      bankgiro: "991-2345",
      recipientAccount: "991-2345",
      bankTransactionId: "tx-telia-jul",
      verificationId: "ver-sup-telia-jul",
      paymentVerificationId: "ver-suppay-telia-jul",
      createdAt: d(32),
    },
    {
      id: "sup-hyra-aug",
      supplier: "Fastighets AB Söderport",
      invoiceNumber: "HYRA-2026-08",
      date: d(33),
      dueDate: d(26),
      amount: 8500,
      vatAmount: 0,
      description: "Verkstadslokal, augusti",
      category: "hyra",
      status: "betald",
      accountingStatus: "bokford" as const,
      bankgiro: "567-8901",
      recipientAccount: "567-8901",
      bankTransactionId: "tx-hyra-aug",
      verificationId: "ver-sup-hyra-aug",
      paymentVerificationId: "ver-suppay-hyra-aug",
      createdAt: d(33),
    },
  ];

  const supplierPayments: SupplierPayment[] = [
    // Fall B: instruktionen är förberedd och REDO – bankfilen skapas av
    // användaren ([Skapa bankfil]). Ingen fejkad bankinlämning i demon.
    {
      id: "spay-beijer",
      supplierInvoiceId: "sup-beijer",
      amount: 18500,
      currency: "SEK",
      dueDate: d(-10),
      scheduledDate: d(-10).slice(0, 10),
      ocr: "48211",
      recipientAccount: "123-4567",
      recipientName: "Beijer Bygg",
      idempotencyKey: "suppay:sup-beijer:18500:" + d(-10).slice(0, 10),
      status: "READY",
      createdAt: d(2, 9, 12),
      updatedAt: d(2, 9, 12),
    },
    // Telia: bankfil skapad i går – väntar på uppladdning i internetbanken.
    // Fil skapad ≠ skickad till bank ≠ betald.
    {
      id: "spay-telia-aug",
      supplierInvoiceId: "sup-telia-aug",
      amount: 1295,
      currency: "SEK",
      dueDate: d(-6),
      scheduledDate: d(-6).slice(0, 10),
      ocr: "20260881",
      recipientAccount: "991-2345",
      recipientName: "Telia",
      idempotencyKey: "suppay:sup-telia-aug:1295:" + d(-6).slice(0, 10),
      status: "PAYMENT_FILE_CREATED",
      paymentFileId: "pf-telia-aug",
      createdAt: d(1, 11, 0),
      updatedAt: d(1, 11, 5),
    },
    {
      id: "spay-forsakring",
      supplierInvoiceId: "sup-forsakring",
      amount: 2705,
      currency: "SEK",
      dueDate: d(2),
      scheduledDate: d(2).slice(0, 10),
      ocr: "7710021",
      recipientAccount: "330-1122",
      recipientName: "Trygg-Hansa",
      idempotencyKey: "suppay:sup-forsakring:2705:" + d(2).slice(0, 10),
      status: "READY",
      createdAt: d(4, 10, 0),
      updatedAt: d(4, 10, 0),
    },
    {
      id: "spay-telia-jul",
      supplierInvoiceId: "sup-telia-jul",
      amount: 1295,
      currency: "SEK",
      dueDate: d(18),
      scheduledDate: d(18).slice(0, 10),
      ocr: "20260771",
      recipientAccount: "991-2345",
      recipientName: "Telia",
      providerPaymentId: "seed-bank-telia-jul",
      idempotencyKey: "suppay:sup-telia-jul:1295:" + d(18).slice(0, 10),
      status: "PAID",
      bankTransactionId: "tx-telia-jul",
      createdAt: d(32),
      submittedAt: d(20),
      updatedAt: d(18),
      paidAt: d(18),
    },
    {
      id: "spay-hyra-aug",
      supplierInvoiceId: "sup-hyra-aug",
      amount: 8500,
      currency: "SEK",
      dueDate: d(26),
      scheduledDate: d(26).slice(0, 10),
      recipientAccount: "567-8901",
      recipientName: "Fastighets AB Söderport",
      providerPaymentId: "seed-bank-hyra-aug",
      idempotencyKey: "suppay:sup-hyra-aug:8500:" + d(26).slice(0, 10),
      status: "PAID",
      bankTransactionId: "tx-hyra-aug",
      createdAt: d(33),
      submittedAt: d(28),
      updatedAt: d(26),
      paidAt: d(26),
    },
  ];

  /* -------------------------------- Bankfiler ---------------------------- */

  // Telias bankfil genereras med samma pain.001-byggare som produktflödet –
  // demofilen är alltså en riktig, validerad ISO 20022-fil.
  const teliaFile = getPaymentExportProvider("ISO20022_PAIN001").build({
    messageId: "DRIVA-SEED-TELIA-AUG",
    createdAt: d(1, 11, 5),
    payer: {
      name: "Södermalms Snickeri AB",
      orgNumber: "559123-4567",
      iban: PAYER_IBAN,
      bic: PAYER_BIC,
    },
    instructions: [
      {
        instructionId: "SPAYTELIAAUG",
        endToEndId: "SPAYTELIAAUG",
        amount: 1295,
        currency: "SEK",
        requestedExecutionDate: d(-6).slice(0, 10),
        recipientName: "Telia",
        recipientAccount: { kind: "bankgiro", account: "991-2345" },
        ocr: "20260881",
      },
    ],
  });
  if (!teliaFile.ok) {
    throw new Error(`Seeddata: Telia-bankfilen kunde inte genereras: ${teliaFile.problems.join(" ")}`);
  }

  const paymentFiles: PaymentFile[] = [
    {
      id: "pf-telia-aug",
      filename: `driva-betalningar-${d(1).slice(0, 10)}.xml`,
      messageId: "DRIVA-SEED-TELIA-AUG",
      format: "ISO20022_PAIN001",
      paymentIds: ["spay-telia-aug"],
      supplierInvoiceIds: ["sup-telia-aug"],
      totalAmount: 1295,
      currency: "SEK",
      xml: teliaFile.content,
      status: "CREATED",
      createdAt: d(1, 11, 5),
      createdBy: "anvandare",
    },
  ];

  /* ---------------------------- Banktransaktioner ------------------------ */

  const bankTransactions: BankTransaction[] = [];

  function addTx(tx: {
    id: string;
    date: string;
    amount: number;
    counterpart: string;
    description: string;
    reference?: string;
    status: BankTransaction["status"];
    matchedType?: BankTransaction["matchedType"];
    matchedId?: string;
    verificationId?: string;
  }) {
    bankTransactions.push({ ...tx, accountId: "acc-1" });
  }

  // Inbetalningar från betalda kundfakturor.
  const paidInvoiceTx: [string, string, string][] = [
    ["inv-1033", "tx-in-1033", "Nord Studio AB"],
    ["inv-1034", "tx-in-1034", "Brf Eken"],
    ["inv-1035", "tx-in-1035", "Restaurang Gläntan AB"],
    ["inv-1036", "tx-in-1036", "Johan Lindberg"],
    ["inv-1040", "tx-in-1040", "Brf Eken"],
    ["inv-1039", "tx-in-1039", "Nord Studio AB"],
    ["inv-1041", "tx-in-1041", "Johan Lindberg"],
    ["inv-1045", "tx-in-1045", "Anna Andersson"],
  ];
  for (const [invId, txId, counterpart] of paidInvoiceTx) {
    const inv = invoices.find((i) => i.id === invId)!;
    // Samma pengalogik som resten av appen: docTotals är enda sanningen.
    const total = docTotals(inv.lines, inv.rot ?? null).toPay;
    addTx({
      id: txId,
      date: inv.paidAt!,
      amount: total,
      counterpart,
      description: `Inbetalning bankgiro`,
      reference: `OCR ${inv.ocr}`,
      status: "bokford",
      matchedType: "faktura",
      matchedId: invId,
      verificationId: `ver-pay-${inv.number}`,
    });
  }

  // Utgifter. Bauhaus-köpet (fall A) är matchat mot inboxkvittot och bokfört.
  addTx({ id: "tx-bauhaus", date: d(3), amount: -875, counterpart: "Bauhaus", description: "Kortköp BAUHAUS SICKLA", status: "bokford", matchedType: "utgift", matchedId: "exp-bauhaus", verificationId: "ver-exp-bauhaus" });
  addTx({ id: "tx-clas", date: d(5), amount: -349, counterpart: "Clas Ohlson", description: "Kortköp CLAS OHLSON 224", status: "behover_atgard", matchedType: "utgift", matchedId: "exp-clas" });
  addTx({ id: "tx-hotel", date: d(4), amount: -4250, counterpart: "Grand Hôtel", description: "Kortköp GRAND HOTEL STHLM", status: "behover_atgard", matchedType: "utgift", matchedId: "exp-hotel" });
  addTx({ id: "tx-beijer", date: d(9), amount: -12400, counterpart: "Beijer Bygg", description: "Kortköp BEIJER BYGG 108", status: "bokford", matchedType: "utgift", matchedId: "exp-beijer", verificationId: "ver-exp-beijer" });
  addTx({ id: "tx-circlek", date: d(7), amount: -820, counterpart: "Circle K", description: "Kortköp CIRCLE K RINGVÄGEN", status: "bokford", matchedType: "utgift", matchedId: "exp-circlek", verificationId: "ver-exp-circlek" });
  addTx({ id: "tx-adobe", date: d(15), amount: -645, counterpart: "Adobe", description: "Autogiro ADOBE SYSTEMS", status: "bokford", matchedType: "utgift", matchedId: "exp-adobe", verificationId: "ver-exp-adobe" });
  addTx({ id: "tx-beijer-jul", date: d(45), amount: -22000, counterpart: "Beijer Bygg", description: "Kortköp BEIJER BYGG 108", status: "bokford", matchedType: "utgift", matchedId: "exp-beijer-jul", verificationId: "ver-exp-beijer-jul" });
  addTx({ id: "tx-bauhaus-jul", date: d(55), amount: -3150, counterpart: "Bauhaus", description: "Kortköp BAUHAUS SICKLA", status: "bokford", matchedType: "utgift", matchedId: "exp-bauhaus-jul", verificationId: "ver-exp-bauhaus-jul" });
  addTx({ id: "tx-beijer-maj", date: d(100), amount: -18400, counterpart: "Beijer Bygg", description: "Kortköp BEIJER BYGG 108", status: "bokford", matchedType: "utgift", matchedId: "exp-beijer-maj", verificationId: "ver-exp-beijer-maj" });
  addTx({ id: "tx-okq8", date: d(92), amount: -760, counterpart: "OKQ8", description: "Kortköp OKQ8 SÖDERMALM", status: "bokford", matchedType: "utgift", matchedId: "exp-okq8", verificationId: "ver-exp-okq8" });

  // Betalda leverantörsfakturor.
  addTx({ id: "tx-telia-jul", date: d(18), amount: -1295, counterpart: "Telia", description: "Bankgiro TELIA SVERIGE AB", status: "bokford", matchedType: "leverantorsfaktura", matchedId: "sup-telia-jul", verificationId: "ver-suppay-telia-jul" });
  addTx({ id: "tx-hyra-aug", date: d(26), amount: -8500, counterpart: "Fastighets AB Söderport", description: "Bankgiro HYRA AUG", status: "bokford", matchedType: "leverantorsfaktura", matchedId: "sup-hyra-aug", verificationId: "ver-suppay-hyra-aug" });

  // Skatt.
  addTx({ id: "tx-fskatt-aug", date: d(15), amount: -12400, counterpart: "Skatteverket", description: "Preliminärskatt augusti", status: "bokford", matchedType: "skatt", verificationId: "ver-skatt-aug" });
  addTx({ id: "tx-fskatt-jul", date: d(45), amount: -12400, counterpart: "Skatteverket", description: "Preliminärskatt juli", status: "bokford", matchedType: "skatt", verificationId: "ver-skatt-jul" });

  /* ------------------------------ Betalningar ---------------------------- */

  const payments = paidInvoiceTx.map(([invId, txId]) => {
    const inv = invoices.find((i) => i.id === invId)!;
    const total = docTotals(inv.lines, inv.rot ?? null).toPay;
    return {
      id: `pay-${inv.number}`,
      invoiceId: invId,
      bankTransactionId: txId,
      amount: total,
      date: inv.paidAt!,
      matchedBy: "auto" as const,
    };
  });

  /* ----------------------------- Verifikationer -------------------------- */

  const rawVerifications: Omit<Verification, "number">[] = [];

  function addVer(v: {
    id: string;
    date: string;
    description: string;
    entries: VerificationEntry[];
    source: VerificationSource;
    confidence?: Verification["confidence"];
  }) {
    rawVerifications.push({
      id: v.id,
      series: "A",
      date: v.date,
      description: v.description,
      entries: v.entries,
      source: v.source,
      confidence: v.confidence ?? "hog",
      createdBy: "auto",
      status: "bokford",
      postedAt: v.date,
      createdAt: v.date,
    });
  }

  for (const inv of invoices) {
    // Utkast är inte utfärdade och bokförs därför inte.
    if (inv.status === "utkast") continue;
    const customer = customers.find((c) => c.id === inv.customerId)!;
    addVer({
      id: `ver-inv-${inv.number}`,
      date: inv.issueDate,
      description: `Faktura #${inv.number} – ${customer.name}`,
      entries: entriesInvoiceSent(inv.lines, inv.rot),
      source: { type: "kundfaktura", id: inv.id },
    });
    if (inv.status === "betald" && inv.paidAt) {
      const total = docTotals(inv.lines, inv.rot ?? null).toPay;
      addVer({
        id: `ver-pay-${inv.number}`,
        date: inv.paidAt,
        description: `Betalning faktura #${inv.number} – ${customer.name}`,
        entries: entriesInvoicePaid(total),
        source: { type: "betalning", id: `pay-${inv.number}` },
      });
    }
  }

  for (const exp of expenses) {
    if (exp.status === "bokford" && exp.category) {
      addVer({
        id: `ver-exp-${exp.id.replace("exp-", "")}`,
        date: exp.date,
        description: `${exp.supplier} – ${exp.description ?? "inköp"}`,
        entries: entriesExpense(exp.category, exp.amount, exp.vatAmount),
        source: { type: "utgift", id: exp.id },
      });
    }
  }

  for (const sup of supplierInvoices) {
    addVer({
      id: `ver-sup-${sup.id.replace("sup-", "")}`,
      date: sup.date,
      description: `Leverantörsfaktura ${sup.supplier} ${sup.invoiceNumber}`,
      entries: entriesSupplierInvoiceReceived(sup.category, sup.amount, sup.vatAmount),
      source: { type: "leverantorsfaktura", id: sup.id },
    });
    if (sup.status === "betald" && sup.bankTransactionId) {
      addVer({
        id: `ver-suppay-${sup.id.replace("sup-", "")}`,
        date: bankTransactions.find((t) => t.id === sup.bankTransactionId)!.date,
        description: `Betalning ${sup.supplier} ${sup.invoiceNumber}`,
        entries: entriesSupplierInvoicePaid(sup.amount),
        source: { type: "leverantorsfaktura", id: sup.id },
      });
    }
  }

  addVer({
    id: "ver-skatt-aug",
    date: d(15),
    description: "Preliminärskatt augusti",
    entries: entriesTaxPayment(12400),
    source: { type: "banktransaktion", id: "tx-fskatt-aug" },
  });
  addVer({
    id: "ver-skatt-jul",
    date: d(45),
    description: "Preliminärskatt juli",
    entries: entriesTaxPayment(12400),
    source: { type: "banktransaktion", id: "tx-fskatt-jul" },
  });

  const verifications: Verification[] = rawVerifications
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((v, i) => ({ ...v, number: i + 1 }));

  /* ------------------------------- Aktivitet ----------------------------- */

  const activity: ActivityEvent[] = [
    { id: "act-1", at: d(0, 8, 45), text: "Nytt uppdrag via telefon från Karin Ek: platsbyggd bokhylla i ek.", customerId: "cust-karin", entity: { type: "jobb", id: "job-karin" } },
    { id: "act-2", at: d(1, 9, 12), text: "Nytt uppdrag via webbformuläret från Sara Nilsson: byte av köksluckor och bänkskiva.", customerId: "cust-sara", entity: { type: "jobb", id: "job-sara" } },
    { id: "act-3", at: d(1, 15, 45), text: "Offert #114 skickades till Nord Studio AB (46 500 kr).", customerId: "cust-nord", entity: { type: "offert", id: "quote-nord2" } },
    { id: "act-4", at: d(1, 21, 8), text: "Anna Andersson öppnade offert #113.", customerId: "cust-anna", entity: { type: "offert", id: "quote-garderob" } },
    { id: "act-5", at: d(2, 10, 12), text: "Offert #113 skickades till Anna Andersson (26 000 kr att betala efter ROT).", customerId: "cust-anna", entity: { type: "offert", id: "quote-garderob" } },
    { id: "act-6", at: d(3, 12, 46), text: "Kvitto från Bauhaus (875 kr) matchades mot kortköpet och bokfördes som material.", entity: { type: "utgift", id: "exp-bauhaus" } },
    { id: "act-16", at: d(2, 9, 12), text: "Leverantörsfaktura från Beijer Bygg (18 500 kr) bokfördes automatiskt. Redo att betala – förfaller " + d(-10).slice(0, 10) + ".", entity: { type: "verifikation", id: "ver-sup-beijer" } },
    { id: "act-17", at: d(1, 11, 5), text: "Bankfil driva-betalningar-" + d(1).slice(0, 10) + ".xml skapades för Telia (1 295 kr). Ladda upp den i internetbanken och godkänn betalningen där." },
    { id: "act-18", at: d(0, 10, 15), text: "Faktura från Byggmax behöver kontroll – totalbeloppet kunde inte läsas säkert." },
    { id: "act-7", at: d(4, 12, 30), text: "Betalningen på 4 250 kr till Grand Hôtel behöver klassificeras.", entity: { type: "utgift", id: "exp-hotel" } },
    { id: "act-8", at: d(6, 11, 30), text: "Faktura #1047 skickades till Johan Lindberg (25 500 kr).", customerId: "cust-johan", entity: { type: "faktura", id: "inv-1047" } },
    { id: "act-9", at: d(6, 9, 2), text: "Betalning på 4 800 kr från Johan Lindberg matchades mot faktura #1041 och bokfördes.", customerId: "cust-johan", entity: { type: "faktura", id: "inv-1041" } },
    { id: "act-10", at: d(9, 16, 40), text: "Kvitto från Beijer Bygg (12 400 kr) matchades mot bankköpet och bokfördes som material.", entity: { type: "utgift", id: "exp-beijer" } },
    { id: "act-11", at: d(10, 7, 30), text: "Uppdraget Köksrenovering hos Anna Andersson startades.", customerId: "cust-anna", entity: { type: "jobb", id: "job-kok" } },
    { id: "act-12", at: d(16, 10, 20), text: "Betalning på 25 500 kr från Anna Andersson matchades mot faktura #1045 och bokfördes.", customerId: "cust-anna", entity: { type: "faktura", id: "inv-1045" } },
    { id: "act-13", at: d(20, 11, 18), text: "Johan Lindberg godkände offert #111. Uppdraget Altanrenovering skapades.", customerId: "cust-johan", entity: { type: "offert", id: "quote-altan" } },
    { id: "act-14", at: d(24, 14, 32), text: "Anna Andersson godkände offert #110. Uppdraget Köksrenovering skapades.", customerId: "cust-anna", entity: { type: "offert", id: "quote-kok" } },
    { id: "act-15", at: d(26, 16, 20), text: "Uppdraget Fönsterbyte gårdshus markerades som klart.", customerId: "cust-brf", entity: { type: "jobb", id: "job-fonster" } },
    { id: "act-19", at: d(4, 9, 40), text: "Offert #115 med ROT-avdrag skickades till Bertil Lindqvist.", customerId: "cust-bertil", entity: { type: "offert", id: "quote-fasad" } },
    { id: "act-20", at: d(3, 18, 25), text: "Bertil Lindqvist öppnade offert #115.", customerId: "cust-bertil", entity: { type: "offert", id: "quote-fasad" } },
    { id: "act-21", at: d(7, 15, 30), text: "Uppdraget Nytt trappräcke i ek hos Eva Holmgren markerades som klart – redo att fakturera.", customerId: "cust-eva", entity: { type: "jobb", id: "job-racke" } },
  ];

  /* ------------------------------ Påminnelser ----------------------------- */

  const reminders: Reminder[] = [
    {
      id: "rem-karin",
      userId: null,
      title: "Ring Karin Ek om bokhyllan",
      description: "Stäm av mått och träslag innan offerten skickas.",
      dueAt: d(-1, 9, 0),
      timezone: "Europe/Stockholm",
      hasExplicitTime: true,
      status: "PENDING",
      source: "user",
      relatedEntityType: "customer",
      relatedEntityId: "cust-karin",
      createdAt: d(0, 8, 50),
    },
    {
      id: "rem-slutgenomgang",
      userId: null,
      title: "Boka slutgenomgång av köket med Anna",
      dueAt: d(-3, 12, 0),
      timezone: "Europe/Stockholm",
      hasExplicitTime: false,
      status: "PENDING",
      source: "user",
      relatedEntityType: "job",
      relatedEntityId: "job-kok",
      createdAt: d(1, 17, 10),
    },
    {
      id: "rem-kapsag",
      userId: null,
      title: "Lämna in kapsågen på service",
      timezone: "Europe/Stockholm",
      hasExplicitTime: false,
      status: "PENDING",
      source: "user",
      createdAt: d(4, 7, 45),
    },
  ];

  /* -------------------------------- Hemsida ------------------------------ */

  const website = {
    id: "site-1",
    slug: "sodermalms-snickeri",
    businessName: "Södermalms Snickeri",
    tagline: "Platsbyggt snickeri med känsla för detaljer",
    city: "Stockholm",
    status: "publicerad" as const,
    theme: "tra" as const,
    design: { themeId: "klassisk" as const, accent: "tegel" as const },
    footer: {
      showPhone: true,
      showEmail: true,
      showAddress: true,
      showServices: true,
      showLogo: true,
      aboutText:
        "Platsbyggt snickeri på Södermalm – kök, garderober och möbler med fast pris och ROT-avdrag direkt på fakturan.",
      social: { instagram: "sodermalmssnickeri" },
    },
    publishedAt: d(90),
    createdAt: d(95),
    submissions: 1,
    sections: [
      {
        id: "sec-hero",
        type: "hero" as const,
        heading: "Platsbyggt snickeri med känsla för detaljer",
        body: "Vi ritar, bygger och monterar kök, garderober och platsbyggda möbler på Södermalm med omnejd. Fast pris och tydlig offert som du godkänner digitalt.",
        visible: true,
      },
      {
        id: "sec-tjanster",
        type: "tjanster" as const,
        heading: "Det här hjälper vi dig med",
        body: "",
        visible: true,
        items: [
          { title: "Kök", text: "Renovering, nya luckor och bänkskivor eller helt nytt kök – vi tar hand om helheten." },
          { title: "Garderober & förvaring", text: "Platsbyggda garderober och smart förvaring som passar ditt hem exakt." },
          { title: "Platsbyggda möbler", text: "Bokhyllor, plattformssängar, fönsterbänkar – möbler byggda för ditt rum." },
        ],
      },
      {
        id: "sec-om",
        type: "om" as const,
        heading: "Om oss",
        body: "Södermalms Snickeri drivs av två snickare med över 20 års samlad erfarenhet. Vi tror på raka besked, fasta priser och att alltid lämna ett städat hem efter oss. F-skatt, ansvarsförsäkring och ROT-avdrag direkt på fakturan.",
        visible: true,
      },
      {
        id: "sec-galleri",
        type: "galleri" as const,
        heading: "Utvalda projekt",
        body: "Ett urval av kök, garderober och möbler vi byggt det senaste året.",
        visible: true,
      },
      {
        id: "sec-kontakt",
        type: "kontakt" as const,
        heading: "Berätta om ditt projekt",
        body: "Beskriv vad du vill ha gjort så återkommer vi inom en arbetsdag med nästa steg – oftast ett kostnadsfritt hembesök.",
        visible: true,
      },
    ],
  };

  /* ------------------------------- Assistent ----------------------------- */

  const assistantMessages = [
    {
      id: "msg-welcome",
      role: "assistant" as const,
      at: d(0, 7, 0),
      text: "God morgon! Jag är din assistent och kan utföra saker i hela Driva. Prova till exempel: ”Skapa en offert till Karin för bokhyllan, 28 000 kr” eller ”Vilka kunder har inte betalat?”",
    },
  ];

  /* --------------------------------- Klart ------------------------------- */

  return {
    settings: {
      name: "Södermalms Snickeri AB",
      orgNumber: "559123-4567",
      vatNumber: "SE559123456701",
      email: "info@sodermalmssnickeri.se",
      phone: "08-410 245 30",
      websiteUrl: "https://sodermalmssnickeri.se",
      address: "Renstiernas gata 12",
      postalCode: "116 28",
      city: "Stockholm",
      sate: "Stockholm",
      country: "Sverige",
      bankgiro: "5678-1234",
      logoInitials: "SS",
      fSkattPerMonth: 12400,
      payrollReservePerMonth: 20800,
      paymentTermsDays: 30,
      lateInterestRate: 10,
      quoteValidityDays: 30,
      defaultVatRate: 25,
      defaultQuoteTerms: STANDARD_TERMS,
      inboundMailSlug: "demo",
      // Betalkontot för utgående leverantörsbetalningar (pain.001-debitorn).
      payerBankName: "SEB",
      payerIban: PAYER_IBAN,
      payerBic: PAYER_BIC,
    },
    sequences: { quote: 117, invoice: 1049, verification: verifications.length + 1 },
    customers,
    quotes,
    quoteVersions,
    signatures,
    bankidOrders: [],
    jobs,
    jobWorkEntries,
    invoices,
    payments,
    bankAccounts: [
      {
        id: "acc-1",
        provider: "mock",
        name: "Företagskonto",
        accountNumber: "SEB ···· 4512",
        balance: 284000,
        connectedAt: d(120),
      },
    ],
    bankTransactions: bankTransactions.sort((a, b) => b.date.localeCompare(a.date)),
    expenses,
    receipts,
    supplierInvoices,
    supplierPayments,
    paymentFiles,
    verifications,
    // Bokföringsmotorn: räkenskapsår och IB backfylls av migrateAccounting i store.normalize.
    fiscalYears: [],
    accounting: {},
    vatReports: [],
    assets: [],
    accruals: [],
    auditTrail: [],
    annualReports: [],
    activity: activity.sort((a, b) => b.at.localeCompare(a.at)),
    website,
    domains: [],
    domainAudit: [],
    assistantMessages,
    pendingActions: [],
    assistantAudit: [],
    reminders,
    attentionStates: [],
    collaborationInvitations: [],
    clientInformationRequests: [],
    inboxItems: [
      // Fall B: komplett faktura, tolkad med hög konfidens per fält och
      // bokförd av autopiloten. Betalningen är REDO – [Skapa bankfil].
      {
        id: "inbox-mail-beijer",
        kind: "mail" as const,
        status: "bokford" as const,
        documentType: "leverantorsfaktura" as const,
        source: "email" as const,
        externalId: "seed-beijer-faktura-1",
        fromAddress: "faktura@beijerbygg.se",
        toAddress: "demo@in.ferva.se",
        subject: "Faktura BB-48211",
        textBody: "Bifogad leverantörsfaktura för virke och skivmaterial till altanprojektet.",
        attachments: [
          {
            id: "att-beijer",
            filename: "BB-48211.pdf",
            contentType: "application/pdf",
            size: 2_900,
            storageKey: "demo/inbox-mail-beijer/BB-48211.pdf",
          },
        ],
        parsedAmount: 18500,
        parsedVatAmount: 3700,
        parsedSupplier: "Beijer Bygg",
        parsedInvoiceNumber: "BB-48211",
        parsedDate: d(2).slice(0, 10),
        parsedDueDate: d(-10).slice(0, 10),
        parsedOcr: "48211",
        parsedBankgiro: "123-4567",
        confidence: 0.99,
        extraction: {
          supplier: { value: "Beijer Bygg", confidence: 0.99, source: "dokument" },
          invoiceNumber: { value: "BB-48211", confidence: 0.99, source: "dokument" },
          invoiceDate: { value: d(2).slice(0, 10), confidence: 0.99, source: "dokument" },
          dueDate: { value: d(-10).slice(0, 10), confidence: 0.99, source: "dokument" },
          amount: { value: 18500, confidence: 0.99, source: "dokument" },
          vatAmount: { value: 3700, confidence: 0.99, source: "dokument" },
          ocr: { value: "48211", confidence: 0.99, source: "dokument" },
          bankgiro: { value: "123-4567", confidence: 0.99, source: "dokument" },
        },
        supplierInvoiceId: "sup-beijer",
        createdAt: d(2, 9, 10),
        processedAt: d(2, 9, 12),
      },
      // Fall C: leverantörsfaktura där totalbeloppet lästes OSÄKERT (875 kr,
      // låg konfidens) – PDF:en visar 2 340 kr. Ingen faktura skapas på en
      // osäker siffra: posten väntar på [Kontrollera belopp].
      {
        id: "inbox-mail-byggmax",
        kind: "mail" as const,
        status: "ny" as const,
        documentType: "leverantorsfaktura" as const,
        source: "email" as const,
        externalId: "seed-byggmax-faktura-1",
        fromAddress: "faktura@byggmax.se",
        toAddress: "demo@in.ferva.se",
        subject: "Faktura BM-73821 Byggmax Hornstull",
        textBody:
          "Hej! Här kommer fakturan för ert köp hos Byggmax Hornstull. Betalningsuppgifter finns i den bifogade fakturan.",
        attachments: [
          {
            id: "att-byggmax",
            filename: "faktura-byggmax.pdf",
            contentType: "application/pdf",
            size: 2_800,
            storageKey: "demo/inbox-mail-byggmax/faktura-byggmax.pdf",
          },
        ],
        parsedAmount: 875,
        parsedVatAmount: 175,
        parsedSupplier: "Byggmax",
        parsedInvoiceNumber: "BM-73821",
        parsedDate: d(1).slice(0, 10),
        parsedDueDate: d(-14).slice(0, 10),
        parsedOcr: "7382101",
        parsedBankgiro: "5786-8140",
        parsedDetailsConfidence: 0.98,
        confidence: 0.42,
        // Bara BELOPPET lästes osäkert – resten är säkra läsningar. Det är
        // poängen med vyn: kontrollera undantaget, inte allt.
        extraction: {
          supplier: { value: "Byggmax", confidence: 0.98, source: "dokument" },
          invoiceNumber: { value: "BM-73821", confidence: 0.98, source: "dokument" },
          invoiceDate: { value: d(1).slice(0, 10), confidence: 0.98, source: "dokument" },
          dueDate: { value: d(-14).slice(0, 10), confidence: 0.98, source: "dokument" },
          amount: { value: 875, confidence: 0.42, source: "dokument" },
          vatAmount: { value: 175, confidence: 0.42, source: "dokument" },
          ocr: { value: "7382101", confidence: 0.98, source: "dokument" },
          bankgiro: { value: "5786-8140", confidence: 0.98, source: "dokument" },
        },
        createdAt: d(0, 10, 15),
      },
      // Fall A: kvitto – tolkat säkert, matchat mot kortköpet och bokfört.
      // Kvittoflödet har ingen utgående betalning.
      {
        id: "inbox-mail-bauhaus",
        kind: "mail" as const,
        status: "bokford" as const,
        documentType: "kvitto" as const,
        source: "email" as const,
        externalId: "seed-bauhaus-kvitto-1",
        fromAddress: "kvitto@bauhaus.se",
        toAddress: "demo@in.ferva.se",
        subject: "Kvitto Bauhaus Sickla",
        textBody: "Tack för ditt köp hos Bauhaus Sickla! Ditt kvitto finns bifogat.",
        attachments: [
          {
            id: "att-bauhaus",
            filename: "kvitto-bauhaus.pdf",
            contentType: "application/pdf",
            size: 2_400,
            storageKey: "demo/inbox-mail-bauhaus/kvitto-bauhaus.pdf",
          },
        ],
        parsedAmount: 875,
        parsedVatAmount: 175,
        parsedSupplier: "Bauhaus",
        parsedDate: d(3).slice(0, 10),
        confidence: 0.99,
        extraction: {
          supplier: { value: "Bauhaus", confidence: 0.99, source: "dokument" },
          invoiceDate: { value: d(3).slice(0, 10), confidence: 0.99, source: "dokument" },
          amount: { value: 875, confidence: 0.99, source: "dokument" },
          vatAmount: { value: 175, confidence: 0.99, source: "dokument" },
        },
        expenseId: "exp-bauhaus",
        createdAt: d(3, 12, 45),
        processedAt: d(3, 12, 46),
      },
      {
        id: "inbox-mail-okq8",
        kind: "mail" as const,
        status: "bokford" as const,
        documentType: "kvitto" as const,
        source: "email" as const,
        externalId: "seed-okq8-kvitto-1",
        fromAddress: "kvitto@okq8.se",
        toAddress: "demo@in.ferva.se",
        subject: "Kvitto OKQ8 diesel",
        textBody: "Kvitto för tankning. Posten är redan markerad som behandlad i demon.",
        attachments: [],
        parsedAmount: 745,
        parsedVatAmount: 149,
        parsedSupplier: "OKQ8",
        confidence: 0.99,
        expenseId: "exp-okq8",
        createdAt: d(3, 16, 20),
        processedAt: d(2, 11, 0),
      },
    ],
    meta: { seededAt: new Date().toISOString() },
  };
}
