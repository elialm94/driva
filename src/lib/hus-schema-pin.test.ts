import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { xmllintAvailable, XMLLINT_SKIP, xmlWellFormed } from "./__fixtures__/xmllint";

/**
 * Skatteverkets HUS-schema är vendorat och pinnat: en ändrad eller utbytt
 * XSD ska synas som ett medvetet steg (ny checksumma + rad i README), inte
 * som att gyllene filerna plötsligt validerar mot något annat. CI hämtar
 * aldrig scheman från nätet (`--nonet`), så det som ligger här är det som
 * gäller.
 */
const HUS_DIR = path.join(process.cwd(), "docs/skatteverket/hus");

function pinned(): Array<{ sha256: string; file: string }> {
  return readFileSync(path.join(HUS_DIR, "SCHEMAS.sha256"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^([0-9a-f]{64})\s+(\S+)$/.exec(line);
      assert.ok(m, `Ogiltig rad i SCHEMAS.sha256: "${line}"`);
      return { sha256: m[1], file: m[2] };
    });
}

describe("Skatteverkets HUS-schema (vendorat, pinnat)", () => {
  it("checksummorna i SCHEMAS.sha256 stämmer med filerna", () => {
    const rows = pinned();
    assert.deepEqual(
      rows.map((r) => r.file).sort(),
      ["begaran/V6/Begaran.xsd", "komponent/V6/BegaranCOMPONENT.xsd"],
      "Båda schemafilerna ska vara pinnade"
    );
    for (const row of rows) {
      const bytes = readFileSync(path.join(HUS_DIR, row.file));
      const actual = createHash("sha256").update(bytes).digest("hex");
      assert.equal(
        actual,
        row.sha256,
        `${row.file} har ändrats. Är det en ny officiell version: uppdatera SCHEMAS.sha256 och README (källa, datum) i samma commit.`
      );
    }
  });

  it("schemat importerar komponentfilen relativt – ingen extern schemaLocation", () => {
    const xsd = readFileSync(path.join(HUS_DIR, "begaran/V6/Begaran.xsd"), "utf8");
    assert.match(xsd, /schemaLocation="\.\.\/\.\.\/komponent\/V6\/BegaranCOMPONENT\.xsd"/);
    assert.doesNotMatch(xsd, /schemaLocation="https?:/);
  });

  it("båda schemafilerna är välformad XML enligt libxml2", (t) => {
    if (!xmllintAvailable()) return t.skip(XMLLINT_SKIP);
    for (const file of ["begaran/V6/Begaran.xsd", "komponent/V6/BegaranCOMPONENT.xsd"]) {
      const res = xmlWellFormed(readFileSync(path.join(HUS_DIR, file), "utf8"));
      assert.ok(res?.ok, `${file}: ${res?.output}`);
    }
  });

  it("i CI finns xmllint – annars är grinden trasig", (t) => {
    if (process.env.CI !== "true") return t.skip("bara i CI");
    assert.ok(xmllintAvailable());
  });
});
