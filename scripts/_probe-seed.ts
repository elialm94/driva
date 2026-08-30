process.env.DRIVA_TEST = "1";
import { buildSeed } from "../src/lib/seed";
const db = buildSeed();
const q = db.quotes.find((x) => x.id === "quote-dorrar")!;
const v = db.quoteVersions.find((x) => x.quoteId === "quote-dorrar")!;
console.log("version has richText:", v.richText ? "YES" : "NO");
const inv = db.invoices.find((x) => x.id === "inv-1042")!;
console.log("invoice has richText:", inv.richText ? "YES" : "NO");
console.log("quote status:", q.status, "currentVersionId matches:", q.currentVersionId === v.id);
