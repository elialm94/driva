process.env.DRIVA_TEST = "1";

import { readFileSync } from "node:fs";
import path from "node:path";
import { after, describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cronSecret, isAuthorizedCronRequest } from "./cron-auth";
import { GET } from "@/app/api/cron/reminders/route";

const SECRET = "cron-hemlighet-0123456789abcdef";
const URL_BASE = "https://ferva.test/api/cron/reminders";

const original = process.env.CRON_SECRET;
after(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

function get(url: string, headers?: Record<string, string>): Promise<Response> {
  return GET(new NextRequest(url, headers ? { headers } : undefined));
}

describe("cron-auktorisering (rena funktioner)", () => {
  it("godkänner rätt hemlighet i Authorization: Bearer", () => {
    assert.equal(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET), true);
    // Vercel/proxyer normaliserar inte skiftläget på schemat.
    assert.equal(isAuthorizedCronRequest(`bearer ${SECRET}`, SECRET), true);
    assert.equal(isAuthorizedCronRequest(`  Bearer   ${SECRET}  `, SECRET), true);
  });

  it("avvisar fel hemlighet, fel längd och fel schema", () => {
    assert.equal(isAuthorizedCronRequest(`Bearer ${SECRET}x`, SECRET), false);
    assert.equal(isAuthorizedCronRequest("Bearer fel", SECRET), false);
    assert.equal(isAuthorizedCronRequest(`Basic ${SECRET}`, SECRET), false);
    // Hemligheten utan schema är inte ett Bearer-token.
    assert.equal(isAuthorizedCronRequest(SECRET, SECRET), false);
    assert.equal(isAuthorizedCronRequest("Bearer ", SECRET), false);
    assert.equal(isAuthorizedCronRequest(null, SECRET), false);
    assert.equal(isAuthorizedCronRequest(undefined, SECRET), false);
  });

  it("olika längd kastar inte utan ger false", () => {
    // timingSafeEqual kräver lika längd - längdkontrollen ligger före anropet.
    assert.doesNotThrow(() => isAuthorizedCronRequest("Bearer a", SECRET));
    assert.equal(isAuthorizedCronRequest("Bearer a", SECRET), false);
  });

  it("saknad eller tom CRON_SECRET auktoriserar ingenting", () => {
    assert.equal(isAuthorizedCronRequest(`Bearer ${SECRET}`, undefined), false);
    assert.equal(isAuthorizedCronRequest("Bearer ", undefined), false);
    assert.equal(cronSecret({}), undefined);
    assert.equal(cronSecret({ CRON_SECRET: "   " }), undefined);
    assert.equal(cronSecret({ CRON_SECRET: " abc " }), "abc");
  });
});

describe("GET /api/cron/reminders", () => {
  it("fel bearer ger 401", async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await get(URL_BASE, { authorization: "Bearer fel-hemlighet-0123456789abc" });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { ok: false, error: "Obehörig." });
  });

  it("hemligheten som query-parameter ger 401", async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await get(`${URL_BASE}?secret=${encodeURIComponent(SECRET)}`);
    assert.equal(res.status, 401);
    // Även tillsammans med en felaktig header: query-vägen finns inte längre.
    const ocksa = await get(`${URL_BASE}?secret=${encodeURIComponent(SECRET)}`, { authorization: "Bearer fel" });
    assert.equal(ocksa.status, 401);
  });

  it("utan satt CRON_SECRET är endpointen stängd, inte öppen", async () => {
    delete process.env.CRON_SECRET;
    assert.equal((await get(URL_BASE)).status, 401);
    assert.equal((await get(URL_BASE, { authorization: "Bearer " })).status, 401);
    process.env.CRON_SECRET = "";
    assert.equal((await get(URL_BASE, { authorization: "Bearer " })).status, 401);
  });

  it("rätt bearer ger 200 och kör påminnelserna", async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await get(URL_BASE, { authorization: `Bearer ${SECRET}` });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; businesses: number };
    assert.equal(body.ok, true);
    assert.equal(body.businesses, 1);
  });
});

test("routen läser inte hemligheten ur frågesträngen", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src", "app", "api", "cron", "reminders", "route.ts"),
    "utf8"
  );
  assert.doesNotMatch(source, /searchParams/);
  assert.doesNotMatch(source, /process\.env\.CRON_SECRET/);
  assert.match(source, /isAuthorizedCronRequest\(req\.headers\.get\("authorization"\)\)/);
});
