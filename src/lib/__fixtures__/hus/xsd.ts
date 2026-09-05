import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Testhjälpare: validerar en HUS-fil mot Skatteverkets vendorade schema
 * (docs/skatteverket/hus/…) med xmllint. Returnerar null när xmllint saknas i
 * miljön så att testet kan hoppa över steget i stället för att ge falskt fel.
 */
export const HUS_XSD_PATH = path.join(process.cwd(), "docs/skatteverket/hus/begaran/V6/Begaran.xsd");

let available: boolean | null = null;

export function xmllintAvailable(): boolean {
  if (available == null) {
    const probe = spawnSync("xmllint", ["--version"], { encoding: "utf8" });
    available = !probe.error && existsSync(HUS_XSD_PATH);
  }
  return available;
}

export function validateAgainstHusXsd(xml: string): { ok: boolean; output: string } | null {
  if (!xmllintAvailable()) return null;
  const res = spawnSync("xmllint", ["--noout", "--schema", HUS_XSD_PATH, "-"], { input: xml, encoding: "utf8" });
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`
    .split("\n")
    // Schemats metadata-annotation har ett relativt namespace – xmllint varnar men accepterar.
    .filter((l) => !/namespace warning|SchemaMetadata|^\s*\^?\s*$/.test(l))
    .join("\n")
    .trim();
  return { ok: res.status === 0, output };
}
