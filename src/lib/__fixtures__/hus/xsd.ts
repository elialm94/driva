import { existsSync } from "node:fs";
import path from "node:path";
import { xmllintAvailable as xmllintPresent, xmlValidAgainstXsd } from "../xmllint";

/**
 * Testhjälpare: validerar en HUS-fil mot Skatteverkets vendorade schema
 * (docs/skatteverket/hus/…) med xmllint. Returnerar null när xmllint saknas
 * lokalt så att testet kan hoppa över steget i stället för att ge falskt fel;
 * i CI kastar hjälparen (se ../xmllint.ts). Schemats version pinnas med
 * checksumma i docs/skatteverket/hus/SCHEMAS.sha256 (hus-schema-pin.test.ts).
 */
export const HUS_XSD_PATH = path.join(process.cwd(), "docs/skatteverket/hus/begaran/V6/Begaran.xsd");

export function xmllintAvailable(): boolean {
  return xmllintPresent() && existsSync(HUS_XSD_PATH);
}

export function validateAgainstHusXsd(xml: string): { ok: boolean; output: string } | null {
  if (!xmllintAvailable()) return null;
  const res = xmlValidAgainstXsd(xml, HUS_XSD_PATH);
  if (!res) return null;
  const output = res.output
    .split("\n")
    // Schemats metadata-annotation har ett relativt namespace – xmllint varnar men accepterar.
    .filter((l) => !/namespace warning|SchemaMetadata|^\s*\^?\s*$/.test(l))
    .join("\n")
    .trim();
  return { ok: res.ok, output };
}
