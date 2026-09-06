/**
 * Demo för grossistbeställningar – realistisk men helt fiktiv.
 *
 *   * En fiktiv grossist ("Demo-grossisten") med ordermejl på en reserverad
 *     .example-domän som aldrig kan nå någon riktig mottagare.
 *   * En liten prislista (el + VVS) som importeras genom den RIKTIGA
 *     importmotorn (CSV) – samma väg som en kunds fil.
 *   * En deterministisk orderbekräftelse som "kommer in" i inboxen efter ett
 *     simulerat utskick, med en prisändring och en restnotering så att
 *     avstämningen har något att visa.
 *
 * Allt märks som demo. Körs bara för demoföretaget/JSON-läget – aldrig för
 * riktiga företag.
 */
import { db } from "../store";
import { isDemoBusiness, isJsonDemoStore } from "../demo";
import { inboundMailAddress, type InboundMailPayload } from "../inbox/inbound-mail";
import type { PurchaseOrder } from "../types";
import { createWholesalerConnection, importPriceFile, wholesalerConnections, type ImportRunner } from "../services/wholesalers";
import { escapeHtml } from "../email/templates";
import { formatOre } from "./money";

export const DEMO_WHOLESALER_NAME = "Demo-grossisten";
export const DEMO_WHOLESALER_EMAIL = "order@demo-grossisten.example";
export const DEMO_WHOLESALER_CUSTOMER_NUMBER = "DEMO-4711";

/** Gäller demon (publik demosession, demoföretaget eller lokalt JSON-läge)? */
export function isWholesalerDemoContext(): boolean {
  return isDemoBusiness() || isJsonDemoStore();
}

export function demoWholesalerSeeded(): boolean {
  return db().meta.wholesalerDemoSeeded === true;
}

/** Fiktiv prislista: artikelnummer;benämning;E-nummer;RSK;enhet;förp;listpris;rabattgrupp;rabatt;nettopris;utpris */
export function demoPriceListCsv(): string {
  const rows: string[][] = [
    ["Artikelnummer", "Benämning", "E-nummer", "RSK-nummer", "Enhet", "Förpackning", "Listpris", "Rabattgrupp", "Rabatt %", "Nettopris", "Rek. utpris"],
    ["DG-100101", "Installationskabel EKK 3G1,5 vit", "0400212", "", "m", "100", "18,90", "K10", "42", "10,96", "21,50"],
    ["DG-100102", "Installationskabel EKK 3G2,5 vit", "0400214", "", "m", "100", "27,50", "K10", "42", "15,95", "31,00"],
    ["DG-100110", "Kabel EQLQ 5G2,5 halogenfri", "0405222", "", "m", "50", "41,00", "K10", "42", "23,78", "46,00"],
    ["DG-100201", "Apparatdosa infälld 1-fack", "1408133", "", "st", "50", "14,20", "D20", "35", "9,23", "19,00"],
    ["DG-100202", "Apparatdosa infälld 2-fack", "1408134", "", "st", "25", "26,80", "D20", "35", "17,42", "35,00"],
    ["DG-100203", "Kopplingsdosa utanpåliggande IP55", "1409215", "", "st", "20", "39,00", "D20", "35", "25,35", "49,00"],
    ["DG-100301", "Vägguttag 2-vägs jordat infällt vit", "1857005", "", "st", "10", "62,00", "M30", "30", "43,40", "89,00"],
    ["DG-100302", "Strömställare trapp infälld vit", "1855010", "", "st", "10", "58,00", "M30", "30", "40,60", "85,00"],
    ["DG-100303", "Dimmer LED 5–200 W infälld vit", "1855422", "", "st", "1", "489,00", "M30", "30", "342,30", "690,00"],
    ["DG-100401", "Dvärgbrytare 1-pol C16", "2120316", "", "st", "12", "89,00", "A40", "38", "55,18", "125,00"],
    ["DG-100402", "Dvärgbrytare 3-pol C16", "2120716", "", "st", "4", "268,00", "A40", "38", "166,16", "365,00"],
    ["DG-100403", "Jordfelsbrytare 4-pol 40 A 30 mA typ A", "2122440", "", "st", "1", "1 290,00", "A40", "38", "799,80", "1 690,00"],
    ["DG-100404", "Personskyddsautomat 1P+N C16 30 mA", "2124216", "", "st", "1", "645,00", "A40", "38", "399,90", "890,00"],
    ["DG-100501", "Normkapsling 2 rader 24 moduler IP40", "2311224", "", "st", "1", "890,00", "A40", "38", "551,80", "1 190,00"],
    ["DG-100601", "LED-panel 60×60 40 W 4000 K", "7518540", "", "st", "1", "745,00", "L50", "28", "536,40", "990,00"],
    ["DG-100602", "LED-downlight IP44 dimbar 8 W vit", "7500812", "", "st", "6", "289,00", "L50", "28", "208,08", "395,00"],
    ["DG-100603", "Utomhusarmatur vägg IP65 antracit", "7530065", "", "st", "1", "1 150,00", "L50", "28", "828,00", "1 590,00"],
    ["DG-100701", "Flexrör 20 mm halogenfritt", "1231020", "", "m", "100", "6,40", "R60", "45", "3,52", "8,00"],
    ["DG-100702", "Kabelkanal 40×60 vit", "1235060", "", "m", "16", "48,00", "R60", "45", "26,40", "62,00"],
    ["DG-100703", "Kabelband 200×4,8 svart 100-pack", "1250200", "", "förp", "1", "42,00", "R60", "45", "23,10", "59,00"],
    ["DG-200101", "Kopparrör 15 mm hårt 3 m", "", "6402015", "st", "1", "189,00", "V10", "33", "126,63", "245,00"],
    ["DG-200102", "Kopparrör 22 mm hårt 3 m", "", "6402022", "st", "1", "329,00", "V10", "33", "220,43", "425,00"],
    ["DG-200201", "Presskoppling rak 15 mm", "", "6412015", "st", "10", "38,00", "V20", "36", "24,32", "52,00"],
    ["DG-200202", "Presskoppling vinkel 90° 15 mm", "", "6412115", "st", "10", "46,00", "V20", "36", "29,44", "62,00"],
    ["DG-200203", "Pressövergång 15 mm × R15 inv", "", "6412215", "st", "10", "58,00", "V20", "36", "37,12", "79,00"],
    ["DG-200301", "PEX-rör i skyddsrör 15 mm 50 m", "", "6421015", "st", "1", "1 090,00", "V10", "33", "730,30", "1 390,00"],
    ["DG-200302", "Fördelarskåp 6 ledningar", "", "6425006", "st", "1", "1 850,00", "V30", "30", "1 295,00", "2 390,00"],
    ["DG-200401", "Kulventil 15 mm med spak", "", "6431015", "st", "5", "112,00", "V30", "30", "78,40", "149,00"],
    ["DG-200402", "Blandare tvättställ krom", "", "8291005", "st", "1", "1 690,00", "V40", "25", "1 267,50", "2 190,00"],
    ["DG-200403", "Blandare kök med diskmaskinsavstängning", "", "8292012", "st", "1", "2 290,00", "V40", "25", "1 717,50", "2 990,00"],
    ["DG-200501", "Avloppsrör PP 110 mm 2 m", "", "2350110", "st", "1", "165,00", "V50", "32", "112,20", "219,00"],
    ["DG-200502", "Avloppsböj PP 110 mm 45°", "", "2351145", "st", "4", "58,00", "V50", "32", "39,44", "79,00"],
    ["DG-200503", "Golvbrunn med klämring 75 mm", "", "7101075", "st", "1", "890,00", "V50", "32", "605,20", "1 190,00"],
    ["DG-200601", "Vattenmätarkonsol komplett", "", "6450001", "st", "1", "1 450,00", "V30", "30", "1 015,00", "1 890,00"],
    ["DG-200602", "Säkerhetsventil 9 bar 1/2\"", "", "6440009", "st", "1", "245,00", "V30", "30", "171,50", "319,00"],
    ["DG-200701", "Rörisolering 15 mm 9 mm cellgummi 2 m", "", "6480015", "st", "20", "34,00", "V60", "40", "20,40", "45,00"],
    ["DG-200702", "Rörklammer 15 mm med gummi", "", "6485015", "st", "50", "9,80", "V60", "40", "5,88", "14,00"],
    ["DG-300001", "Skruv trallskruv 4,2×55 250-pack", "", "", "förp", "1", "189,00", "S70", "20", "151,20", "229,00"],
    ["DG-300002", "Fogmassa sanitet vit 300 ml", "", "", "st", "12", "89,00", "S70", "20", "71,20", "119,00"],
    ["DG-300003", "Arbetshandskar montage strl 10", "", "", "par", "12", "59,00", "S70", "20", "47,20", "79,00"],
  ];
  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\r\n");
}

/**
 * Seeda demogrossisten + prislistan genom den riktiga importmotorn. Kör bara
 * i demokontext och bara en gång (meta.wholesalerDemoSeeded). `run` är
 * withBusiness i appen (varje steg blir en egen commit).
 */
export async function seedDemoWholesaler(run: ImportRunner): Promise<{ seeded: boolean; connectionId?: string }> {
  const prepared = await run(() => {
    if (!isWholesalerDemoContext() || demoWholesalerSeeded()) return null;
    const existing = wholesalerConnections().find((c) => c.displayName === DEMO_WHOLESALER_NAME);
    const connection =
      existing ??
      createWholesalerConnection({
        wholesaler: "other",
        displayName: DEMO_WHOLESALER_NAME,
        customerNumber: DEMO_WHOLESALER_CUSTOMER_NUMBER,
        orderEmail: DEMO_WHOLESALER_EMAIL,
        ccSelf: false,
        defaultDeliveryMode: "pickup",
        defaultStore: "Demo-grossisten Årsta",
        contactPerson: "Demo-säljaren",
        phone: "08-000 00 00",
        customerPriceRule: { kind: "markup", percent: 25 },
        active: true,
      });
    const data = db();
    data.meta = { ...data.meta, wholesalerDemoSeeded: true };
    return { connectionId: connection.id };
  });
  if (!prepared) return { seeded: false };
  const outcome = await importPriceFile(
    {
      connectionId: prepared.connectionId,
      filename: "demo-prislista.csv",
      bytes: Buffer.from(demoPriceListCsv(), "utf8"),
    },
    run,
  );
  return { seeded: outcome.ok, connectionId: prepared.connectionId };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Deterministisk demobekräftelse för en skickad order: första raden får
 * +5 % i pris, sista raden (om minst två) restnoteras med 1 enhet.
 * Ingen slump – samma order ger alltid samma bekräftelse.
 */
export function demoConfirmationPayload(order: PurchaseOrder): InboundMailPayload {
  const snapshot = order.sentSnapshot;
  if (!snapshot) throw new Error("Beställningen är inte skickad.");
  const sentDate = snapshot.sentAt.slice(0, 10);
  const deliveryDate = addDays(sentDate, 3);
  const backorderDate = addDays(sentDate, 10);
  const orderNumber = `9${order.reference.replace(/\D/g, "").padStart(5, "0")}`;
  const lines = snapshot.lines.map((l, i) => {
    const last = snapshot.lines.length >= 2 && i === snapshot.lines.length - 1;
    const confirmedQty = last ? Math.max(0, l.qty - 1) : l.qty;
    const unitCostOre = l.unitCostOre != null ? (i === 0 ? Math.round(l.unitCostOre * 1.05) : l.unitCostOre) : undefined;
    return { ...l, confirmedQty, unitCostOre, backordered: last && l.qty >= 1 };
  });
  const total = lines.every((l) => l.unitCostOre != null)
    ? lines.reduce((s, l) => s + Math.round(l.confirmedQty * (l.unitCostOre ?? 0)), 0)
    : undefined;

  const textRows = lines.map((l) => {
    const parts = [
      `Art.nr ${l.articleNumber ?? "-"}  ${l.name}  Antal: ${l.confirmedQty} ${l.unit}`,
      l.unitCostOre != null ? `à-pris ${(l.unitCostOre / 100).toFixed(2).replace(".", ",")}` : "",
      l.backordered ? `Restnoterad: 1 ${l.unit}, levereras ${backorderDate}` : "",
    ];
    return parts.filter(Boolean).join("  ");
  });
  const text = [
    `[Demo] Orderbekräftelse ${orderNumber}`,
    `Er referens: ${order.reference}`,
    `Kundnummer: ${snapshot.customerNumber}`,
    "",
    `Tack för er beställning. Vi bekräftar följande:`,
    ...textRows,
    "",
    `${order.delivery.mode === "pickup" ? "Hämtklart" : "Leveransdatum"}: ${deliveryDate}`,
    total != null ? `Totalt exkl. moms: ${formatOre(total)}` : "",
    "",
    "Detta är en simulerad bekräftelse i Fervas demo – ingen riktig grossist är inblandad.",
    "Med vänliga hälsningar",
    DEMO_WHOLESALER_NAME,
  ]
    .filter((l) => l !== "")
    .join("\n");

  const html = `<p>[Demo] Orderbekräftelse ${orderNumber}<br>Er referens: ${escapeHtml(order.reference)}<br>Kundnummer: ${escapeHtml(snapshot.customerNumber)}</p>
<table>
<tr><th>Artikelnummer</th><th>Benämning</th><th>Bekräftat antal</th><th>Enhet</th><th>À-pris</th><th>Status</th></tr>
${lines
  .map(
    (l) =>
      `<tr><td>${escapeHtml(l.articleNumber ?? "")}</td><td>${escapeHtml(l.name)}</td><td>${l.confirmedQty}</td><td>${escapeHtml(l.unit)}</td><td>${
        l.unitCostOre != null ? (l.unitCostOre / 100).toFixed(2).replace(".", ",") : ""
      }</td><td>${l.backordered ? `Restnoterad 1 ${escapeHtml(l.unit)}, levereras ${backorderDate}` : "Bekräftad"}</td></tr>`,
  )
  .join("\n")}
</table>
<p>${order.delivery.mode === "pickup" ? "Hämtklart" : "Leveransdatum"}: ${deliveryDate}${total != null ? `<br>Totalt exkl. moms: ${escapeHtml(formatOre(total))}` : ""}</p>
<p>Detta är en simulerad bekräftelse i Fervas demo – ingen riktig grossist är inblandad.</p>`;

  return {
    externalId: `demo-confirmation-${order.id}`,
    to: inboundMailAddress(db().settings.inboundMailSlug || "demo"),
    from: `${DEMO_WHOLESALER_NAME} <${DEMO_WHOLESALER_EMAIL}>`,
    subject: `[Demo] Orderbekräftelse ${orderNumber} – Er referens ${order.reference}`,
    text,
    html,
    attachments: [],
    // Bara avsändarnamnet – dokumenttypen avgörs av pipelinen (orderbekräftelse).
    parsed: { supplier: DEMO_WHOLESALER_NAME },
  };
}
