process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  STATSLANERANTA_30_NOV,
  STATSLANERANTA_GOLV,
  depreciationLimits,
  schablonintakt,
  schablonranta,
} from "./ink2-model";

/**
 * INK2:ans rena räknesätt.
 *
 * Satserna kommer ur lag och ur Riksgäldens fastställda räntor, inte ur
 * produkten, så testerna räknar mot Skatteverkets egna exempel där de finns.
 */

describe("schablonintäkt på periodiseringsfond", () => {
  it("räntan är statslåneräntan den 30 november året innan beskattningsåret går ut", () => {
    // 30 november 2024 var statslåneräntan 1,96 % → beskattningsår 2025.
    assert.equal(schablonranta(2025), 1.96);
    // 30 november 2025 var den 2,55 % → beskattningsår 2026.
    assert.equal(schablonranta(2026), 2.55);
  });

  it("golvet på 0,5 % gäller när statslåneräntan är lägre – uppskjuten skatt är aldrig gratis", () => {
    // 30 november 2020 var räntan -0,10 %. Utan golv hade schablonintäkten
    // blivit negativ, alltså ett avdrag för att ha skjutit upp skatt.
    assert.equal(STATSLANERANTA_30_NOV[2020] < 0, true);
    assert.equal(schablonranta(2021), STATSLANERANTA_GOLV);
    assert.equal(schablonranta(2022), STATSLANERANTA_GOLV, "0,23 % 2021 ligger också under golvet");
  });

  it("ett år utan fastställd ränta ger inget svar i stället för ett gissat", () => {
    assert.equal(schablonranta(2035), undefined);
  });

  it("underlaget är fonderna vid årets ingång", () => {
    // 800 000 kr fond vid ingången av 2026 × 2,55 %.
    assert.equal(schablonintakt(800_000, 2.55), 20_400);
  });

  it("ingen fond ger ingen schablonintäkt", () => {
    assert.equal(schablonintakt(0, 2.55), 0);
  });

  it("ett förkortat räkenskapsår ger en proportionerlig schablonintäkt", () => {
    // Sex månader ska ge halva intäkten – ett kort år räntebeläggs kortare.
    assert.equal(schablonintakt(800_000, 2.55, 6), 10_200);
  });
});

describe("skattemässiga avskrivningar på inventarier", () => {
  it("huvudregeln lämnar 70 % av underlaget kvar", () => {
    // Inventarien köptes förra året för 120 000 kr och står i 100 000 kr.
    const limits = depreciationLimits({
      openingBookValue: 100_000,
      acquisitionsByYearsBack: [0, 120_000, 0, 0, 0],
    });
    assert.equal(limits.basis, 100_000);
    assert.equal(limits.lowestValueHuvudregeln, 70_000);
    assert.equal(limits.maxDepreciation, 30_000);
    assert.equal(limits.rule, "huvudregeln");
  });

  it("årets inköp ingår i underlaget oavsett när på året de gjordes", () => {
    // 30 % får dras av även på en inventarie som köptes i december – det är
    // skillnaden mot bokföringens linjära plan, som periodiserar per månad.
    const limits = depreciationLimits({ openingBookValue: 0, acquisitionsByYearsBack: [50_000, 0, 0, 0, 0] });
    assert.equal(limits.maxDepreciation, 15_000);
  });

  it("ersättning för sålda inventarier från tidigare år minskar underlaget", () => {
    const limits = depreciationLimits({
      openingBookValue: 100_000,
      acquisitionsByYearsBack: [0, 120_000, 0, 0, 0],
      proceedsFromEarlierAssets: 20_000,
    });
    assert.equal(limits.basis, 80_000);
    assert.equal(limits.maxDepreciation, 24_000);
  });

  it("kompletteringsregeln väljs när den ger större avdrag och skriver av helt på fem år", () => {
    /*
     * En inventarie köpt för 100 000 kr för fem år sedan: huvudregeln lämnar
     * alltid något kvar (30 % av ett krympande värde), kompletteringsregeln
     * skriver av den sista kronan. Det är hela dess syfte.
     */
    const limits = depreciationLimits({
      openingBookValue: 16_807,
      acquisitionsByYearsBack: [0, 0, 0, 0, 100_000],
    });
    assert.equal(limits.lowestValueKompletteringsregeln, 0, "femte året bakåt får inget stå kvar");
    assert.equal(limits.lowestValueHuvudregeln, 11_765, "huvudregeln lämnar alltid något kvar");
    assert.equal(limits.rule, "kompletteringsregeln");
    assert.equal(limits.maxDepreciation, 16_807, "hela restvärdet får skrivas av");
  });

  it("kompletteringsregeln staplar 80/60/40/20 procent av anskaffningsåren", () => {
    const limits = depreciationLimits({
      openingBookValue: 260_000,
      acquisitionsByYearsBack: [100_000, 100_000, 100_000, 100_000],
    });
    // 80 000 + 60 000 + 40 000 + 20 000 = 200 000 kr får stå kvar.
    assert.equal(limits.lowestValueKompletteringsregeln, 200_000);
    // Huvudregeln: 70 % av (260 000 + 100 000) = 252 000 kr står kvar.
    assert.equal(limits.lowestValueHuvudregeln, 252_000);
    assert.equal(limits.rule, "kompletteringsregeln");
    assert.equal(limits.maxDepreciation, 160_000);
  });

  it("kompletteringsregeln höjer aldrig värdet över underlaget", () => {
    /*
     * Ett bolag som skrivit av snabbare i bokföringen än kompletteringsregeln
     * kräver har redan ett lägre värde. Regeln får då inte räknas som ett tak
     * över det bokförda värdet – det skulle ge en negativ avskrivning.
     */
    const limits = depreciationLimits({ openingBookValue: 10_000, acquisitionsByYearsBack: [0, 100_000, 0, 0, 0] });
    assert.equal(limits.lowestValueKompletteringsregeln, 10_000, "regeln kapas vid underlaget");
    assert.equal(limits.rule, "huvudregeln", "huvudregeln ger ändå 30 % och alltså mer avdrag");
    assert.equal(limits.maxDepreciation, 3_000);
  });

  it("inga inventarier ger inget avdrag och inget negativt underlag", () => {
    const limits = depreciationLimits({ openingBookValue: 0, acquisitionsByYearsBack: [] });
    assert.equal(limits.basis, 0);
    assert.equal(limits.maxDepreciation, 0);
  });
});
