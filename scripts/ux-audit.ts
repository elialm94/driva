/**
 * Mobil/surfplatte-audit: screenshots + horisontell overflow-detektor.
 *
 * Användning:
 *   npx tsx scripts/ux-audit.ts                          # alla rutter, alla bredder
 *   npx tsx scripts/ux-audit.ts --width 390 /uppdrag …   # urval
 *   npx tsx scripts/ux-audit.ts --shots-only /           # bara screenshots
 *
 * Screenshots hamnar i .data/ux-audit/<bredd>/<ruttnamn>.png
 */
import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";

const BASE = "http://localhost:3123";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = path.join(process.cwd(), ".data", "ux-audit");

const DEFAULT_ROUTES = [
  "/",
  "/kunder?flik=kunder",
  "/kunder?flik=forfragningar",
  "/kunder/cust-anna",
  "/uppdrag",
  "/uppdrag/job-kok",
  "/ekonomi?flik=offerter",
  "/ekonomi?flik=fakturor",
  "/ekonomi?flik=utgifter",
  "/ekonomi?flik=bank",
  "/ekonomi/offerter/ny",
  "/ekonomi/fakturor/ny",
  "/ekonomi/offerter/quote-nord1",
  "/ekonomi/fakturor/inv-1045",
  "/bokforing",
  "/bokforing/verifikationer",
  "/bokforing/huvudbok",
  "/bokforing/saldobalans",
  "/bokforing/resultat",
  "/bokforing/moms",
  "/hemsida",
  "/hemsida/doman",
  "/assistent",
  "/installningar",
  "/sajt",
  "/integritetspolicy",
  "@offert-publik",
  "@offert-underlag",
  "@faktura-publik",
];

const DEFAULT_WIDTHS = [390, 430, 768, 1024];

interface OverflowHit {
  route: string;
  width: number;
  scrollWidth: number;
  offenders: string[];
}

function slug(route: string): string {
  return route.replace(/^\//, "").replace(/[/?=&\[\]]+/g, "_") || "hem";
}

/**
 * Publika kundsidor nås via tokens som inte ska hamna i loggar/utskrifter.
 * Alias (@offert-publik osv.) löses upp mot .data/db.json här i skriptet och
 * skrivs aldrig ut – screenshots och rapporter använder aliasnamnet.
 */
function resolveAlias(route: string): { url: string; name: string } {
  if (!route.startsWith("@")) return { url: route, name: slug(route) };
  const db = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".data", "db.json"), "utf8"));
  const sentQuote = (db.quotes ?? []).find((q: { token?: string }) => q.token) ?? (db.quotes ?? [])[0];
  const sentInvoice = (db.invoices ?? []).find((i: { token?: string }) => i.token) ?? (db.invoices ?? [])[0];
  const map: Record<string, string | undefined> = {
    "@offert-publik": sentQuote?.token && `/offert/${sentQuote.token}`,
    "@offert-underlag": sentQuote?.token && `/offert/${sentQuote.token}/underlag`,
    "@faktura-publik": sentInvoice?.token && `/faktura/${sentInvoice.token}`,
  };
  const url = map[route];
  if (!url) throw new Error(`okänt alias eller token saknas: ${route}`);
  return { url, name: route.slice(1) };
}

async function main() {
  const args = process.argv.slice(2);
  const widths: number[] = [];
  const routes: string[] = [];
  let shotsOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--width") widths.push(Number(args[++i]));
    else if (args[i] === "--shots-only") shotsOnly = true;
    else routes.push(args[i]);
  }
  const useWidths = widths.length ? widths : DEFAULT_WIDTHS;
  const useRoutes = routes.length ? routes : DEFAULT_ROUTES;

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  page.on("dialog", (d) => d.accept());

  const hits: OverflowHit[] = [];
  const errors: string[] = [];

  for (const width of useWidths) {
    const dir = path.join(OUT, String(width));
    fs.mkdirSync(dir, { recursive: true });
    // iPhone-ish höjd för smala bredder, iPad-ish för breda.
    const height = width < 700 ? 844 : 1080;
    await page.setViewport({ width, height, hasTouch: width < 1200, deviceScaleFactor: 2 });

    for (const route of useRoutes) {
      try {
        const { url, name } = resolveAlias(route);
        const res = await page.goto(`${BASE}${url}`, { waitUntil: "networkidle0" });
        if (!res || res.status() >= 400) {
          errors.push(`${name} @${width}: HTTP ${res?.status()}`);
          continue;
        }
        await new Promise((r) => setTimeout(r, 250));

        if (!shotsOnly) {
          const overflow = await page.evaluate(() => {
            const vw = document.documentElement.clientWidth;
            const doc = document.scrollingElement!;
            const out: string[] = [];
            if (doc.scrollWidth > vw + 1) {
              // Hitta elementen som sticker ut utanför viewporten.
              const all = document.querySelectorAll<HTMLElement>("body *");
              for (const el of all) {
                const r = el.getBoundingClientRect();
                if (r.width === 0) continue;
                if (r.right > vw + 1 || r.left < -1) {
                  const desc = `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${String(el.className).split(" ").slice(0, 4).join(".")} [${Math.round(r.left)}..${Math.round(r.right)}]`;
                  // Hoppa över föräldrar vars barn redan rapporterats (grov dedup: max 12).
                  out.push(desc);
                  if (out.length >= 12) break;
                }
              }
            }
            return { scrollWidth: doc.scrollWidth, clientWidth: vw, offenders: out };
          });
          if (overflow.scrollWidth > overflow.clientWidth + 1) {
            hits.push({ route: name, width, scrollWidth: overflow.scrollWidth, offenders: overflow.offenders });
          }
        }

        await page.screenshot({ path: path.join(dir, `${name}.png`) as `${string}.png`, fullPage: true });
      } catch (err) {
        errors.push(`${slug(route)} @${width}: ${(err as Error).message.slice(0, 120)}`);
      }
    }
  }

  await browser.close();

  console.log(`\nScreenshots: ${OUT}`);
  if (errors.length) {
    console.log(`\nFel (${errors.length}):`);
    for (const e of errors) console.log("  " + e);
  }
  if (!shotsOnly) {
    if (hits.length === 0) {
      console.log("\nIngen horisontell overflow på någon rutt/bredd.");
    } else {
      console.log(`\nHorisontell overflow (${hits.length}):`);
      for (const h of hits) {
        console.log(`  ${h.route} @${h.width}px  scrollWidth=${h.scrollWidth}`);
        for (const o of h.offenders.slice(0, 6)) console.log(`    · ${o}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
