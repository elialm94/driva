/**
 * Kontrollerar att PNG-ikonerna i public/icons/ fortfarande är rastreringar av
 * SVG-källorna i public/brand/. Körs med:
 *
 *   npx tsx scripts/generate-pwa-icons.ts
 *
 * Varför kontroll och inte generering
 * -----------------------------------
 * Tidigare ritade det här skriptet ikonerna för hand i TypeScript. Geometrin
 * fanns då på två ställen och märket i koden var inte märket i varumärket.
 * Nu är SVG:erna enda källan: logiken i src/lib/brand-icons.ts läser dem,
 * rastrerar dem i minnet och jämför mot PNG-filerna på disk.
 *
 * Att i stället skriva PNG-filerna skulle kräva samma rastrerare som ritade
 * dem (resvg, sharp eller liknande) för att bli byte-identiskt - annars byter
 * en omkörning ut de färdiga filerna mot skriptets egen kantutjämning och
 * smutsar ner arbetsträdet. Ett nytt beroende är inte värt det, så skriptet
 * skriver ingenting alls. Determinismen blir därmed total: en omkörning kan
 * inte ändra en enda fil.
 *
 * Samma kontroll körs av src/lib/brand-icons.test.ts, så CI fångar en ikon som
 * glidit ifrån sin SVG även om ingen kör skriptet.
 */
import { checkIcons } from "../src/lib/brand-icons";

function main(): void {
  const results = checkIcons();
  for (const r of results) {
    const status = r.ok ? "ok " : "FEL";
    const detail = r.problem ?? `medel ${r.meanDelta.toFixed(2)}, max ${Math.round(r.maxDelta)}`;
    process.stdout.write(`${status} ${r.file} <- ${r.source}  (${detail})\n`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    process.stdout.write(
      `\n${failed.length} ikon(er) matchar inte sin SVG-källa i public/brand/.\n` +
        "Exportera om PNG:erna ur SVG:n (eller rätta SVG:n) - ändra inte toleransen.\n",
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`\nAlla ${results.length} ikoner matchar sin SVG-källa.\n`);
}

main();
