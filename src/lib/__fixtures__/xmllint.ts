import { spawnSync } from "node:child_process";

/**
 * Testhjälpare runt `xmllint` (libxml2-utils). Lokalt får verktyget saknas –
 * då hoppar testerna över just XML-steget. I CI (GitHub sätter CI=true) är
 * det ett fel att sakna det: annars hoppas XSD- och välformadhetskontroller
 * över i tysthet och en avvisad myndighetsfil upptäcks först hos Skatteverket.
 * Workflowen installerar libxml2-utils före testerna (.github/workflows/ci.yml).
 */
let available: boolean | null = null;

export function xmllintAvailable(): boolean {
  if (available == null) {
    const probe = spawnSync("xmllint", ["--version"], { encoding: "utf8" });
    available = !probe.error;
    if (!available && process.env.CI === "true") {
      throw new Error(
        "xmllint saknas i CI – installera libxml2-utils i workflowen. XML-kontrollerna får inte hoppas över i grinden."
      );
    }
  }
  return available;
}

/** Skäl att hoppa över ett test lokalt; i CI kastar xmllintAvailable() i stället. */
export const XMLLINT_SKIP = "xmllint saknas lokalt – XML-kontrollen hoppas över (CI kräver den)";

export interface XmllintResult {
  ok: boolean;
  output: string;
}

function run(args: string[], input: string, encoding: BufferEncoding = "utf8"): XmllintResult {
  const res = spawnSync("xmllint", args, { input, encoding });
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
  return { ok: res.status === 0, output };
}

/**
 * Välformad XML enligt libxml2 (`xmllint --noout`). Returnerar null när
 * xmllint saknas lokalt. `encoding` styr hur strängen skickas till processen –
 * eSKD deklarerar ISO-8859-1 och måste matas som latin1 för att prologen och
 * bytesen ska stämma överens.
 */
export function xmlWellFormed(xml: string, encoding: BufferEncoding = "utf8"): XmllintResult | null {
  if (!xmllintAvailable()) return null;
  return run(["--noout", "--nonet", "-"], xml, encoding);
}

/** Validerar mot ett lokalt XSD utan nätåtkomst (`--nonet`: inga externa scheman hämtas). */
export function xmlValidAgainstXsd(xml: string, xsdPath: string): XmllintResult | null {
  if (!xmllintAvailable()) return null;
  return run(["--noout", "--nonet", "--schema", xsdPath, "-"], xml);
}
