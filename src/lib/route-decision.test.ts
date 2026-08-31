process.env.DRIVA_TEST = "1";

/**
 * Proxyns ruttbeslut (src/lib/auth/route-decision.ts): landningssidan för
 * utloggade, appen för inloggade, loginskydd med next, och demosessionens
 * utgångshantering. Proxyn själv (src/proxy.ts) samlar bara in sessionsläget
 * och verkställer besluten som testas här.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideRoute, isPublicPath, type RouteDecision } from "./auth/route-decision";

function decide(over: Partial<Parameters<typeof decideRoute>[0]> = {}): RouteDecision {
  return decideRoute({
    pathname: "/",
    search: "",
    isAuthenticated: false,
    isDemoUser: false,
    demoCookieActive: false,
    ...over,
  });
}

describe("landningssidan på /", () => {
  it("utloggad på / får landningssidan som rewrite – URL:en förblir /", () => {
    assert.deepEqual(decide(), { kind: "rewrite", pathname: "/valkommen" });
  });

  it("inloggad på / hamnar i appen (Hem) precis som förut", () => {
    assert.deepEqual(decide({ isAuthenticated: true }), { kind: "next" });
  });

  it("ingen loop: /valkommen är publik och släpps igenom utloggad", () => {
    assert.deepEqual(decide({ pathname: "/valkommen" }), { kind: "next" });
  });
});

describe("skyddade och publika rutor", () => {
  it("utloggad på skyddad ruta skickas till /login med next", () => {
    assert.deepEqual(decide({ pathname: "/fakturor", search: "?filter=obetalda" }), {
      kind: "redirect",
      pathname: "/login",
      next: "/fakturor?filter=obetalda",
    });
  });

  it("ingen redirect-loop: /login är publik utloggad och skyddade rutor bär sitt next dit", () => {
    assert.deepEqual(decide({ pathname: "/login" }), { kind: "next" });
    assert.deepEqual(decide({ pathname: "/hemligt" }), {
      kind: "redirect",
      pathname: "/login",
      next: "/hemligt",
    });
  });

  it("publika dokument- och marknadsrutor kräver aldrig inloggning", () => {
    for (const p of [
      "/login",
      "/signup",
      "/glomt-losenord",
      "/demo",
      "/offert/abc123",
      "/faktura/abc123",
      "/sajt/sodermalms-snickeri",
      "/villkor",
      "/integritet",
      "/valkommen",
      "/api/health",
      "/api/demo-cleanup",
    ]) {
      assert.equal(isPublicPath(p), true, `${p} ska vara publik`);
      assert.deepEqual(decide({ pathname: p }), { kind: "next" }, `${p} ska släppas igenom`);
    }
  });

  it("prefixmatchningen gäller hela segment – /villkorstrixig är skyddad", () => {
    assert.equal(isPublicPath("/villkorstrixig"), false);
    assert.equal(decide({ pathname: "/villkorstrixig" }).kind, "redirect");
  });

  it("inloggad på /login eller /signup studsar till appen", () => {
    assert.deepEqual(decide({ isAuthenticated: true, pathname: "/login" }), {
      kind: "redirect",
      pathname: "/",
    });
    assert.deepEqual(decide({ isAuthenticated: true, pathname: "/signup" }), {
      kind: "redirect",
      pathname: "/",
    });
  });
});

describe("demosessionens livscykel i proxyn", () => {
  it("demo-användare med aktiv kaka behandlas som vanlig inloggad", () => {
    assert.deepEqual(
      decide({ isAuthenticated: true, isDemoUser: true, demoCookieActive: true }),
      { kind: "next" }
    );
  });

  it("demo-användare utan aktiv kaka släpps och skickas till /demo för en fräsch session", () => {
    assert.deepEqual(
      decide({ isAuthenticated: true, isDemoUser: true, demoCookieActive: false, pathname: "/kunder" }),
      { kind: "end_demo_session", pathname: "/demo" }
    );
  });

  it("riktiga användare berörs aldrig av demo-kakans status", () => {
    assert.deepEqual(
      decide({ isAuthenticated: true, isDemoUser: false, demoCookieActive: false }),
      { kind: "next" }
    );
  });
});
