process.env.DRIVA_TEST = "1";

import { runAssistantChecks } from "../src/lib/ai/checks";

async function main() {
  const checks = await runAssistantChecks();
  let failed = 0;
  for (const c of checks) {
    const mark = c.ok ? "ok" : "FAIL";
    if (!c.ok) failed += 1;
    console.log(`${mark}  ${c.name}  — ${c.detail}`);
  }
  if (failed > 0) {
    console.error(`\n${failed} tester misslyckades.`);
    process.exit(1);
  }
  console.log(`\n${checks.length} tester godkända.`);
}

main();
