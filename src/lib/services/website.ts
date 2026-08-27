import { db, save } from "../store";
import { uid } from "../ids";
import type { Website, WebsiteSection, WebsiteSectionItem, WebsiteTheme } from "../types";
import { logActivity } from "./activity";
import { createRequest, findOrCreateCustomerByEmail } from "./customers";

/**
 * AI-hemsidesgeneratorn är regelbaserad i demon (branschdetektering + mallar).
 * `generateWebsiteContent` är integrationspunkten för en riktig LLM.
 */

interface BranchTemplate {
  theme: WebsiteTheme;
  taglines: string[];
  heroBody: (city: string) => string;
  services: WebsiteSectionItem[];
  about: string;
}

const BRANCHES: Record<string, BranchTemplate> = {
  snickeri: {
    theme: "tra",
    taglines: ["Platsbyggt snickeri med känsla för detaljer", "Hantverk som håller i generationer"],
    heroBody: (city) =>
      `Vi ritar, bygger och monterar kök, garderober och platsbyggda möbler i ${city} med omnejd. Fast pris, tydlig offert och alltid BankID-signerat avtal.`,
    services: [
      { title: "Kök", text: "Renovering, nya luckor och bänkskivor eller helt nytt kök – vi tar hand om helheten." },
      { title: "Garderober & förvaring", text: "Platsbyggda garderober och smart förvaring som passar ditt hem exakt." },
      { title: "Platsbyggda möbler", text: "Bokhyllor, plattformssängar, fönsterbänkar – möbler byggda för ditt rum." },
    ],
    about:
      "Vi tror på raka besked, fasta priser och att alltid lämna ett städat hem efter oss. F-skatt, ansvarsförsäkring och ROT-avdrag direkt på fakturan.",
  },
  foto: {
    theme: "studio",
    taglines: ["Bilder som berättar er historia", "Fotografi med känsla och precision"],
    heroBody: (city) =>
      `Porträtt, företagsfoto och event i ${city}. Trygg process från idé till färdiga bilder – alltid med tydlig offert i förväg.`,
    services: [
      { title: "Företagsfoto", text: "Porträtt och miljöbilder som lyfter ert varumärke på webben och i sociala medier." },
      { title: "Event & konferens", text: "Diskret dokumentation av era viktigaste tillfällen, levererat inom 48 timmar." },
      { title: "Porträtt", text: "Personliga porträtt i studio eller på plats – naturligt ljus och avslappnad stämning." },
    ],
    about:
      "Med över tio år bakom kameran hjälper vi företag och privatpersoner att synas på riktigt. Fast pris per uppdrag och alla rättigheter tydligt reglerade.",
  },
  stad: {
    theme: "ren",
    taglines: ["Rent, punktligt och pålitligt", "Städning ni kan lita på"],
    heroBody: (city) =>
      `Hemstäd, flyttstäd och kontorsstäd i ${city}. Samma team varje gång, nöjd-kund-garanti och RUT-avdrag direkt på fakturan.`,
    services: [
      { title: "Hemstäd", text: "Återkommande städning anpassad efter ert hem och era önskemål." },
      { title: "Flyttstäd", text: "Godkänd flyttstädning med garanti – vi gör om tills besiktningen är godkänd." },
      { title: "Kontorsstäd", text: "Trivsamma arbetsplatser med flexibla scheman, även kvällar och helger." },
    ],
    about: "Vi är ett litet team som bryr oss om detaljerna. Försäkrade, F-skatt och kollektivavtal.",
  },
  el: {
    theme: "el",
    taglines: ["Trygg el – installerat och klart", "Behörig elektriker nära dig"],
    heroBody: (city) =>
      `Auktoriserade elinstallationer i ${city}: belysning, elbilsladdare, säkringsskåp och felsökning. Fast pris och BankID-signerad offert.`,
    services: [
      { title: "Elbilsladdare", text: "Installation av laddbox med grönt teknik-avdrag direkt på fakturan." },
      { title: "Belysning", text: "Inomhus och utomhus – från spotlights till smarta hem." },
      { title: "Service & felsökning", text: "Snabb hjälp när något krånglar, ofta samma vecka." },
    ],
    about: "Auktoriserat elinstallationsföretag med fokus på säkerhet och tydliga priser.",
  },
  konsult: {
    theme: "konsult",
    taglines: ["Rådgivning som gör skillnad", "Er partner för nästa steg"],
    heroBody: (city) =>
      `Vi hjälper företag i ${city} att växa – strategi, ekonomi och verksamhetsutveckling med konkreta resultat.`,
    services: [
      { title: "Strategi", text: "Från nuläge till tydlig plan – workshops och beslutsunderlag som används." },
      { title: "Interim", text: "Erfaren förstärkning när ni behöver den, från dagar till månader." },
      { title: "Analys", text: "Datadrivna underlag inför viktiga beslut." },
    ],
    about: "Seniora konsulter med lång operativ erfarenhet. Vi mäter vårt värde i era resultat.",
  },
};

function detectBranch(description: string): BranchTemplate {
  const d = description.toLowerCase();
  if (/(snick|kök|garderob|möbel|bygg)/.test(d)) return BRANCHES.snickeri;
  if (/(foto|fotograf|bild|kamera)/.test(d)) return BRANCHES.foto;
  if (/(städ|city|flyttstäd|rengör)/.test(d) && /städ/.test(d)) return BRANCHES.stad;
  if (/(elektr|elinstall|laddbox|el\b)/.test(d)) return BRANCHES.el;
  if (/(konsult|rådgiv|byrå|design)/.test(d)) return BRANCHES.konsult;
  return BRANCHES.snickeri;
}

function extractName(description: string, fallback: string): string {
  const m =
    description.match(/(?:för|åt)\s+([A-ZÅÄÖ][\wÅÄÖåäö&.-]*(?:\s+[A-ZÅÄÖ][\wÅÄÖåäö&.-]*){0,3})/) ??
    description.match(/^([A-ZÅÄÖ][\wÅÄÖåäö&.-]*(?:\s+[A-ZÅÄÖ][\wÅÄÖåäö&.-]*){0,3})/);
  if (!m) return fallback;
  return m[1].replace(/\s+(i|på|som|med)$/i, "").trim() || fallback;
}

function extractCity(description: string, fallback: string): string {
  const m = description.match(/i\s+([A-ZÅÄÖ][a-zåäö]+)/);
  return m ? m[1] : fallback;
}

export function generateWebsite(description: string): Website {
  const data = db();
  const branch = detectBranch(description);
  const name = extractName(description, data.settings.name.replace(/\s*AB$/, ""));
  const city = extractCity(description, data.settings.city);
  const tagline = branch.taglines[0];

  const sections: WebsiteSection[] = [
    { id: uid(), type: "hero", heading: tagline, body: branch.heroBody(city) },
    { id: uid(), type: "tjanster", heading: "Det här hjälper vi dig med", body: "", items: branch.services },
    { id: uid(), type: "om", heading: "Om oss", body: `${name} – ${branch.about}` },
    { id: uid(), type: "galleri", heading: "Utvalda projekt", body: "Ett urval av uppdrag vi genomfört det senaste året." },
    {
      id: uid(),
      type: "kontakt",
      heading: "Berätta om ditt projekt",
      body: "Beskriv vad du behöver hjälp med så återkommer vi inom en arbetsdag med nästa steg.",
    },
  ];

  const website: Website = {
    id: uid(),
    slug: name
      .toLowerCase()
      .replace(/å/g, "a")
      .replace(/ä/g, "a")
      .replace(/ö/g, "o")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, ""),
    businessName: name,
    tagline,
    city,
    status: "utkast",
    theme: branch.theme,
    sections,
    createdAt: new Date().toISOString(),
    submissions: 0,
  };
  data.website = website;
  logActivity(`Assistenten genererade ett hemsideutkast för ${name}.`, { entity: { type: "hemsida", id: website.id } });
  save();
  return website;
}

/** "Skriv om med AI" – roterar mellan välskrivna varianter (LLM-integrationspunkt). */
const HERO_VARIANTS = [
  (n: string) => `${n} – hantverk du kan lita på`,
  (n: string) => `Välkommen till ${n}`,
  () => "Kvalitet i varje detalj, från första mötet till slutbesiktning",
];

export function rewriteSectionHeading(sectionId: string): void {
  const site = db().website;
  if (!site) return;
  const section = site.sections.find((s) => s.id === sectionId);
  if (!section) return;
  if (section.type === "hero") {
    const idx = (HERO_VARIANTS.findIndex((v) => v(site.businessName) === section.heading) + 1) % HERO_VARIANTS.length;
    section.heading = HERO_VARIANTS[idx](site.businessName);
  } else {
    section.heading = section.heading.endsWith(" ✨") ? section.heading.slice(0, -2) : section.heading;
  }
  save();
}

export function updateSection(sectionId: string, fields: { heading?: string; body?: string }): void {
  const site = db().website;
  if (!site) return;
  const section = site.sections.find((s) => s.id === sectionId);
  if (!section) return;
  if (fields.heading !== undefined) section.heading = fields.heading;
  if (fields.body !== undefined) section.body = fields.body;
  site.status = site.status === "publicerad" ? "publicerad" : "utkast";
  save();
}

const MAX_ITEM_IMAGE_CHARS = 900_000;

function assertItemImage(image: string): void {
  if (!image.startsWith("data:image/") && !image.startsWith("/")) {
    throw new Error("Ogiltig bild. Välj en JPG, PNG eller WebP.");
  }
  if (image.startsWith("data:") && image.length > MAX_ITEM_IMAGE_CHARS) {
    throw new Error("Bilden är för stor. Välj en mindre bild eller en med lägre upplösning.");
  }
}

function normalizeItem(item: WebsiteSectionItem): WebsiteSectionItem {
  const next: WebsiteSectionItem = {
    title: item.title.trim(),
    text: item.text.trim(),
  };
  if (item.image) {
    assertItemImage(item.image);
    next.image = item.image;
  }
  return next;
}

function requireTjansterSection(sectionId: string): { site: Website; section: WebsiteSection } {
  const site = db().website;
  if (!site) throw new Error("Ingen hemsida att uppdatera");
  const section = site.sections.find((s) => s.id === sectionId);
  if (!section || section.type !== "tjanster") throw new Error("Tjänstesektionen hittades inte");
  if (!section.items) section.items = [];
  return { site, section };
}

function touchSite(site: Website): void {
  site.status = site.status === "publicerad" ? "publicerad" : "utkast";
  save();
}

/** Ersätter hela tjänstelistan. Arrayordning = visningsordning. */
export function setSectionItems(sectionId: string, items: WebsiteSectionItem[]): void {
  const { site, section } = requireTjansterSection(sectionId);
  section.items = items.map(normalizeItem);
  touchSite(site);
}

export function addServiceItem(sectionId: string, item: WebsiteSectionItem): void {
  if (!item.title.trim()) throw new Error("Ange ett namn på tjänsten.");
  const { site, section } = requireTjansterSection(sectionId);
  section.items!.push(normalizeItem(item));
  touchSite(site);
}

export function updateServiceItem(
  sectionId: string,
  index: number,
  fields: { title?: string; text?: string; image?: string | null },
): void {
  const { site, section } = requireTjansterSection(sectionId);
  const item = section.items![index];
  if (!item) throw new Error("Tjänsten hittades inte");
  if (fields.title !== undefined) {
    const title = fields.title.trim();
    if (!title) throw new Error("Ange ett namn på tjänsten.");
    item.title = title;
  }
  if (fields.text !== undefined) item.text = fields.text.trim();
  if (fields.image === null || fields.image === "") {
    delete item.image;
  } else if (fields.image !== undefined) {
    assertItemImage(fields.image);
    item.image = fields.image;
  }
  touchSite(site);
}

export function removeServiceItem(sectionId: string, index: number): { error?: string } {
  const { site, section } = requireTjansterSection(sectionId);
  if ((section.items?.length ?? 0) <= 1) {
    return { error: "Minst en tjänst behövs" };
  }
  if (!section.items![index]) return { error: "Tjänsten hittades inte" };
  section.items!.splice(index, 1);
  touchSite(site);
  return {};
}

export function reorderServiceItems(sectionId: string, fromIndex: number, toIndex: number): void {
  const { site, section } = requireTjansterSection(sectionId);
  const items = section.items!;
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return;
  }
  const [moved] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, moved);
  touchSite(site);
}

export function publishWebsite(): Website {
  const site = db().website;
  if (!site) throw new Error("Ingen hemsida att publicera");
  site.status = "publicerad";
  site.publishedAt = new Date().toISOString();
  logActivity(`Hemsidan för ${site.businessName} publicerades.`, { entity: { type: "hemsida", id: site.id } });
  save();
  return site;
}

/** Kontaktformuläret på den publika sajten → kund + förfrågan → syns på Hem. */
export function submitContactForm(input: {
  name: string;
  email: string;
  phone?: string;
  message: string;
}): void {
  const site = db().website;
  const { customer } = findOrCreateCustomerByEmail(input);
  const title = input.message.length > 60 ? input.message.slice(0, 57).trimEnd() + "…" : input.message;
  createRequest({
    customerId: customer.id,
    title: title || "Förfrågan via hemsidan",
    message: input.message,
    source: "hemsida",
  });
  if (site) {
    site.submissions += 1;
    save();
  }
}
