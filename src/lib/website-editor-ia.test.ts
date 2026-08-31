process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("Hemsida-editorns informationsarkitektur", () => {
  it("sidan använder skalet med tre flikar och ingen permanent sidfot-stack", () => {
    const page = readFileSync(join(here, "../app/(app)/hemsida/page.tsx"), "utf8");
    assert.match(page, /SiteEditorShell/);
    assert.match(page, /innehall=/);
    assert.match(page, /design=/);
    assert.match(page, /installningar=/);
    assert.match(page, /WebsiteFormRecipientCard/);
    assert.match(page, /PrivacyPolicySettingsCard/);
    assert.match(page, /DomainSidebarCard/);
    assert.doesNotMatch(page, /SectionTitle>Utseende/);
    assert.doesNotMatch(page, /lg:grid-cols-\[minmax\(0,1fr\)_300px\]/);

    const innehall = page.slice(page.indexOf("innehall="), page.indexOf("design="));
    const installningar = page.slice(page.indexOf("installningar="));
    assert.match(innehall, /FooterSettingsCard/);
    assert.match(innehall, /data-footer-innehall/);
    assert.match(innehall, /SectionList/);
    assert.ok(
      innehall.indexOf("SectionList") < innehall.indexOf("FooterSettingsCard"),
      "Sidfot ska ligga efter sektionerna under Innehåll"
    );
    assert.doesNotMatch(installningar, /FooterSettingsCard/);
    assert.match(installningar, /WebsiteFormRecipientCard/);
    assert.match(installningar, /PrivacyPolicySettingsCard/);
    assert.match(installningar, /DomainSidebarCard/);
  });

  it("skalet har tillgängliga flikar och Förhandsvisa/Redigera på smal yta", () => {
    const shell = readFileSync(join(here, "../components/site-editor-shell.tsx"), "utf8");
    assert.match(shell, /role="tablist"/);
    assert.match(shell, /Innehåll/);
    assert.match(shell, /Design/);
    assert.match(shell, /Inställningar/);
    assert.match(shell, /Förhandsvisa/);
    assert.match(shell, /Redigera/);
    assert.match(shell, /ArrowRight/);
    assert.match(shell, /data-site-editor-shell/);
  });

  it("sidfoten är sammanfattning plus modal, inte ett alltid-synligt formulär", () => {
    const footer = readFileSync(join(here, "../components/site-footer-settings.tsx"), "utf8");
    assert.match(footer, /Redigera sidfot/);
    assert.match(footer, /footerSummaryRows/);
    assert.match(footer, /<Modal/);
    assert.match(footer, /Avbryt/);
    assert.match(footer, /Spara/);
  });
});
