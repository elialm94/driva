import { db, save } from "../store";
import { uid } from "../ids";
import {
  PRIMARY_CTA_LABEL_MAX,
  type Customer,
  type Job,
  type Website,
  type WebsiteDesign,
  type WebsiteSection,
  type WebsiteSectionItem,
  type WebsiteTheme,
} from "../types";
import {
  WEBSITE_ACCENTS,
  WEBSITE_THEMES,
  assertWebsiteDesign,
  publishedWebsiteDesign,
  sameDesign,
} from "../website-design";
import { logActivity } from "./activity";
import { markWebsiteModuleUsed } from "./modules";
import { findOrCreateCustomerByEmail } from "./customers";
import { createJob, titleFromIncomingMessage } from "./jobs";
import { getBusinessProfile, getWebsiteNotificationEmail, isEmailFormat } from "./settings";
import { absoluteAppUrl, mailFromAddress, sendMail, type MailMessage } from "../mail";
import { newQuoteHref } from "../nav";

/**
 * AI-hemsidesgeneratorn är regelbaserad i demon (branschdetektering + mallar).
 * `generateWebsiteContent` är integrationspunkten för en riktig LLM.
 */

interface BranchTemplate {
  theme: WebsiteTheme;
  /** Föreslaget utseende (tema + accent) för branschen. Användaren kan byta fritt. */
  design: WebsiteDesign;
  taglines: string[];
  heroBody: (city: string) => string;
  services: WebsiteSectionItem[];
  about: string;
}

const BRANCHES: Record<string, BranchTemplate> = {
  snickeri: {
    theme: "tra",
    design: { themeId: "klassisk", accent: "tegel" },
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
    design: { themeId: "minimal", accent: "svart" },
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
    design: { themeId: "modern", accent: "gron" },
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
    design: { themeId: "robust", accent: "sand" },
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
    design: { themeId: "modern", accent: "bla" },
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
    { id: uid(), type: "hero", heading: tagline, body: branch.heroBody(city), visible: true },
    { id: uid(), type: "tjanster", heading: "Det här hjälper vi dig med", body: "", items: branch.services, visible: true },
    { id: uid(), type: "om", heading: "Om oss", body: `${name} – ${branch.about}`, visible: true },
    { id: uid(), type: "galleri", heading: "Utvalda projekt", body: "Ett urval av uppdrag vi genomfört det senaste året.", visible: true },
    {
      id: uid(),
      type: "kontakt",
      heading: "Berätta om ditt projekt",
      body: "Beskriv vad du behöver hjälp med så återkommer vi inom en arbetsdag med nästa steg.",
      visible: true,
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
    design: branch.design,
    sections,
    createdAt: new Date().toISOString(),
    submissions: 0,
  };
  data.website = website;
  markWebsiteModuleUsed(data);
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

export function updateSection(
  sectionId: string,
  fields: { heading?: string; body?: string; image?: string | null; primaryCtaLabel?: string },
): void {
  const site = db().website;
  if (!site) return;
  const section = site.sections.find((s) => s.id === sectionId);
  if (!section) return;
  if (fields.heading !== undefined) section.heading = fields.heading;
  if (fields.body !== undefined) section.body = fields.body;
  if (fields.image === null || fields.image === "") {
    delete section.image;
  } else if (fields.image !== undefined) {
    assertItemImage(fields.image);
    section.image = fields.image;
  }
  if (fields.primaryCtaLabel !== undefined) {
    if (section.type !== "hero") {
      throw new Error("Knapptext kan bara ändras i startsektionen.");
    }
    site.primaryCta = { label: normalizePrimaryCtaLabel(fields.primaryCtaLabel) };
  }
  site.status = site.status === "publicerad" ? "publicerad" : "utkast";
  save();
}

function normalizePrimaryCtaLabel(raw: string): string {
  const label = raw.trim();
  if (!label) throw new Error("Fyll i det här fältet.");
  if (label.length > PRIMARY_CTA_LABEL_MAX) throw new Error("Knapptexten är för lång.");
  return label;
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

/**
 * Bilddata för sektionsredigeraren. Hämtas separat (vid öppning) så att
 * sektionslistan slipper skicka tunga data-URL:er till klienten på varje sidladdning.
 */
export function sectionImages(sectionId: string): { image?: string; itemImages: (string | null)[] } | null {
  const site = db().website;
  const section = site?.sections.find((s) => s.id === sectionId);
  if (!section) return null;
  return {
    image: section.image,
    itemImages: (section.items ?? []).map((it) => it.image ?? null),
  };
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

/** Arrayordning = visningsordning. Okända id:n ignoreras; saknade sektioner behålls sist. */
export function reorderSections(orderedIds: string[]): void {
  const site = db().website;
  if (!site) return;
  const byId = new Map(site.sections.map((section) => [section.id, section]));
  const next: WebsiteSection[] = [];
  for (const id of orderedIds) {
    const section = byId.get(id);
    if (!section) continue;
    next.push(section);
    byId.delete(id);
  }
  for (const leftover of byId.values()) next.push(leftover);
  site.sections = next;
  touchSite(site);
}

export function setSectionVisible(sectionId: string, visible: boolean): void {
  const site = db().website;
  if (!site) throw new Error("Ingen hemsida att uppdatera");
  const section = site.sections.find((s) => s.id === sectionId);
  if (!section) throw new Error("Sektionen hittades inte");
  if (section.type === "hero" && !visible) {
    throw new Error("Startsektionen kan inte döljas");
  }
  section.visible = visible;
  touchSite(site);
}

/**
 * Väljer tema + accent. Ändringen är ett UTKAST: förhandsvisningen uppdateras
 * direkt, den publika sajten först vid "Publicera ändringar". Rör aldrig
 * innehållet – texter, tjänster, bilder, ordning och formulär är opåverkade.
 */
export function setWebsiteDesign(input: { themeId: unknown; accent: unknown }): WebsiteDesign {
  const site = db().website;
  if (!site) throw new Error("Ingen hemsida att uppdatera");
  const design = assertWebsiteDesign(input);
  if (sameDesign(design, publishedWebsiteDesign(site))) {
    // Tillbaka till det publicerade utseendet → inget utkast kvar att publicera.
    delete site.draftDesign;
  } else {
    site.draftDesign = design;
  }
  touchSite(site);
  return design;
}

export function publishWebsite(): Website {
  const site = db().website;
  if (!site) throw new Error("Ingen hemsida att publicera");
  if (site.draftDesign) {
    const theme = WEBSITE_THEMES[site.draftDesign.themeId];
    const accent = WEBSITE_ACCENTS[site.draftDesign.accent];
    site.design = site.draftDesign;
    delete site.draftDesign;
    logActivity(`Hemsidans utseende byttes till ${theme.namn} med accentfärgen ${accent.namn.toLowerCase()}.`, {
      entity: { type: "hemsida", id: site.id },
    });
  }
  site.status = "publicerad";
  site.publishedAt = new Date().toISOString();
  logActivity(`Hemsidan för ${site.businessName} publicerades.`, { entity: { type: "hemsida", id: site.id } });
  save();
  return site;
}

const WEB_FORM_RATE_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 };
const WEB_FORM_DEDUP_MS = 10 * 60 * 1000;

export interface ContactFormInput {
  name: string;
  email: string;
  phone?: string;
  message: string;
  /** Honeypot – ska vara tomt. */
  website?: string;
  idempotencyKey?: string;
}

export interface ContactFormResult {
  jobId: string;
  customerId: string;
  created: boolean;
  mailed: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function websiteJobQuoteCtaHref(customerId: string, jobId: string): string {
  return newQuoteHref({ kund: customerId, job: jobId });
}

export function buildWebsiteJobNotificationMail(input: {
  job: Job;
  customer: Customer;
  to: string;
  from: string;
}): MailMessage {
  const { job, customer, to, from } = input;
  const cta = absoluteAppUrl(websiteJobQuoteCtaHref(customer.id, job.id));
  const phone = customer.phone.trim() || "–";
  const message = job.originalMessage || job.description;
  const text = [
    `Nytt uppdrag från webbformuläret`,
    "",
    job.title,
    "",
    message,
    "",
    `Namn: ${customer.name}`,
    `E-post: ${customer.email}`,
    `Telefon: ${phone}`,
    "",
    "Skapa offert:",
    cta,
  ].join("\n");
  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;background:#f6f5f1;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;">
    <p style="margin:0 0 8px;font-size:18px;font-weight:600;">Nytt uppdrag från webbformuläret</p>
    <p style="margin:0 0 16px;color:#5a574e;">${escapeHtml(job.title)} · ${escapeHtml(customer.name)}</p>
    <p style="margin:0 0 20px;white-space:pre-wrap;">${escapeHtml(message)}</p>
    <p style="margin:0 0 4px;">Namn: ${escapeHtml(customer.name)}</p>
    <p style="margin:0 0 4px;">E-post: ${escapeHtml(customer.email)}</p>
    <p style="margin:0 0 24px;">Telefon: ${escapeHtml(phone)}</p>
    <a href="${escapeHtml(cta)}" style="display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">Skapa offert</a>
  </div>
</body></html>`;
  return {
    to,
    from,
    replyTo: customer.email || undefined,
    subject: `Nytt uppdrag från webbformuläret`,
    text,
    html,
  };
}

function findExistingWebFormJob(input: { email: string; message: string; idempotencyKey?: string }): Job | undefined {
  const data = db();
  const key = input.idempotencyKey?.trim();
  if (key) {
    const byKey = data.jobs.find((j) => j.idempotencyKey === key);
    if (byKey) return byKey;
  }
  const email = input.email.trim().toLowerCase();
  const message = input.message.trim();
  const cutoff = Date.now() - WEB_FORM_DEDUP_MS;
  const customerIds = new Set(data.customers.filter((c) => c.email.toLowerCase() === email).map((c) => c.id));
  return data.jobs.find(
    (j) =>
      j.source === "web_form" &&
      customerIds.has(j.customerId) &&
      (j.originalMessage ?? j.description).trim() === message &&
      Date.parse(j.createdAt) >= cutoff
  );
}

function assertContactInput(input: ContactFormInput): { name: string; email: string; phone: string; message: string } {
  const name = input.name.trim();
  const email = input.email.trim();
  const phone = (input.phone ?? "").trim();
  const message = input.message.trim();
  if (!name) throw new Error("Ange ditt namn.");
  if (name.length > 80) throw new Error("Namnet är för långt.");
  if (!email || !isEmailFormat(email)) throw new Error("Ange en giltig e-postadress.");
  if (email.length > 120) throw new Error("E-postadressen är för lång.");
  if (phone.length > 40) throw new Error("Telefonnumret är för långt.");
  if (!message) throw new Error("Skriv ett meddelande.");
  if (message.length > 4000) throw new Error("Meddelandet är för långt.");
  return { name, email, phone, message };
}

function assertRateLimit(email: string, exceptId?: string): void {
  const cutoff = Date.now() - WEB_FORM_RATE_LIMIT.windowMs;
  const emailNorm = email.toLowerCase();
  const customerIds = new Set(db().customers.filter((c) => c.email.toLowerCase() === emailNorm).map((c) => c.id));
  let n = 0;
  for (const j of db().jobs) {
    if (j.id === exceptId) continue;
    if (j.source !== "web_form") continue;
    if (!customerIds.has(j.customerId)) continue;
    if (Date.parse(j.createdAt) < cutoff) continue;
    n += 1;
    if (n >= WEB_FORM_RATE_LIMIT.max) {
      throw new Error("För många meddelanden. Försök igen om en stund.");
    }
  }
}

function notificationFrom(settings = getBusinessProfile()): string {
  return mailFromAddress() || settings.email || settings.name;
}

export async function deliverWebsiteJobNotification(jobId: string): Promise<boolean> {
  const job = db().jobs.find((j) => j.id === jobId);
  if (!job) return false;
  if (job.notification?.status === "sent") return true;
  const customer = db().customers.find((c) => c.id === job.customerId);
  if (!customer) return false;
  const to = getWebsiteNotificationEmail();
  if (!to) {
    markJobNotification(job, { ok: false, error: "Ingen e-postadress att skicka till." });
    return false;
  }
  const message = buildWebsiteJobNotificationMail({
    job,
    customer,
    to,
    from: notificationFrom(),
  });
  const result = await sendMail(message);
  markJobNotification(job, result.ok ? { ok: true } : { ok: false, error: result.error });
  return result.ok;
}

function markJobNotification(job: Job, result: { ok: true } | { ok: false; error: string }): void {
  job.notification = {
    status: result.ok ? "sent" : "failed",
    sentAt: result.ok ? new Date().toISOString() : job.notification?.sentAt,
    lastError: result.ok ? undefined : result.error,
    attempts: (job.notification?.attempts ?? 0) + 1,
  };
  save();
}

/**
 * Kontaktformuläret på den publika sajten.
 * Identifierar/skapar kund och skapar uppdrag via createJob. Mejlfel tappar inte uppdraget.
 */
export async function submitContactForm(input: ContactFormInput): Promise<ContactFormResult | { skipped: true }> {
  if (input.website?.trim()) {
    return { skipped: true };
  }
  const parsed = assertContactInput(input);
  const existing = findExistingWebFormJob({
    email: parsed.email,
    message: parsed.message,
    idempotencyKey: input.idempotencyKey,
  });
  if (existing) {
    const mailed = await deliverWebsiteJobNotification(existing.id);
    return { jobId: existing.id, customerId: existing.customerId, created: false, mailed };
  }
  assertRateLimit(parsed.email);
  const { customer } = findOrCreateCustomerByEmail(parsed);
  const job = createJob({
    customerId: customer.id,
    title: titleFromIncomingMessage(parsed.message),
    description: parsed.message,
    source: "web_form",
    originalMessage: parsed.message,
    idempotencyKey: input.idempotencyKey?.trim() || undefined,
  });
  job.notification = { status: "pending", attempts: 0 };
  const site = db().website;
  if (site) site.submissions += 1;
  save();
  const mailed = await deliverWebsiteJobNotification(job.id);
  return { jobId: job.id, customerId: customer.id, created: true, mailed };
}
