/**
 * Steg-för-steg-instruktioner för manuell inlämning – en per dokumenttyp.
 *
 * Ferva skickar inte filen. Användaren hämtar den här, loggar in i
 * myndighetens e-tjänst med sin egen e-legitimation, lämnar in filen där och
 * rapporterar sedan tillbaka i Ferva. Instruktionerna beskriver alltså
 * myndighetens gränssnitt, inte Fervas, och kan bli inaktuella när
 * e-tjänsterna ändras. Därför är de versionerade: versionen visas i UI:t och
 * sparas inte i data, men gör det tydligt när texten senast sågs över.
 *
 * Länkarna är myndigheternas egna informationssidor för e-tjänsten (med
 * inloggningsknapp), inte djuplänkar in i inloggade flöden – de sidorna är de
 * stabila adresserna. Ren modul: ingen store, inga sidoeffekter, kan
 * importeras från klientkomponenter.
 */
import type { FilingAuthority, FilingKind } from "../types";

/** Bumpa när text eller länkar ses över mot myndighetens aktuella e-tjänst. */
export const FILING_INSTRUCTIONS_VERSION = "2026.09.1";

/** Dokumenttyper på deklarationsytan. HUS är ROT/RUT-begäran och lever på ärendet. */
export type FilingDocumentType = FilingKind | "hus";

export interface FilingInstruction {
  type: FilingDocumentType;
  authority: FilingAuthority;
  authorityName: string;
  /** Namnet på e-tjänsten så som myndigheten kallar den. */
  serviceName: string;
  /** Myndighetens informationssida för e-tjänsten, med inloggning. */
  serviceUrl: string;
  /** Vilken fil e-tjänsten tar emot och var i tjänsten den läses in. */
  fileHint: string;
  /** Vad du gör, i ordning, efter att filen är hämtad. */
  steps: string[];
  /** Vad myndigheten ger tillbaka – och vad Ferva vill ha av det. */
  receiptHint: string;
  /**
   * När e-tjänsten inte tar emot filen från en privatperson/företag utan
   * mellanhand (Bolagsverkets digitala inlämning kräver ansluten programvara)
   * beskrivs vägen som faktiskt finns.
   */
  alternative?: { title: string; steps: string[] };
}

export const FERVA_DOES_NOT_SEND =
  "Ferva skickar inte filen till myndigheten. Du lämnar in den själv i e-tjänsten och rapporterar sedan här.";

const INSTRUCTIONS: Record<FilingDocumentType, FilingInstruction> = {
  moms: {
    type: "moms",
    authority: "skatteverket",
    authorityName: "Skatteverket",
    serviceName: "Lämna momsdeklaration",
    serviceUrl: "https://skatteverket.se/foretag/moms/deklareramoms.4.7459477810df5bccdd480006935.html",
    fileHint: "Deklarationsfilen (eSKD, .xml) läses in under Deklarera via fil i e-tjänsten. Rutorna fylls i från filen.",
    steps: [
      "Logga in i e-tjänsten med din e-legitimation och välj företaget.",
      "Välj momsperioden och sedan Deklarera via fil. Peka ut filen du hämtade från Ferva.",
      "Kontrollera att rutorna stämmer med Fervas underlag – ruta 49 är att betala eller få tillbaka.",
      "Skriv under deklarationen med e-legitimationen. E-tjänsten visar en kvittens.",
      "Betala momsen till skattekontot senast förfallodagen om ruta 49 är att betala.",
    ],
    receiptHint: "Kvittensen har ett referensnummer. Skriv in det i Ferva eller ladda upp kvittensen som PDF.",
  },
  agi: {
    type: "agi",
    authority: "skatteverket",
    authorityName: "Skatteverket",
    serviceName: "Lämna arbetsgivardeklaration",
    serviceUrl: "https://www.skatteverket.se/foretag/arbetsgivare/lamnaarbetsgivardeklaration.4.41f1c61d16193087d7fcaeb.html",
    fileHint: "Arbetsgivardeklarationen (.xml) läses in under Deklarera via fil. Både huvuduppgift och individuppgifter ligger i samma fil.",
    steps: [
      "Logga in i e-tjänsten med din e-legitimation och välj företaget.",
      "Välj redovisningsperioden och sedan Deklarera via fil. Peka ut filen du hämtade från Ferva.",
      "Kontrollera huvuduppgiften (avgifter och avdragen skatt) och individuppgiften per anställd.",
      "Skriv under deklarationen med e-legitimationen. E-tjänsten visar en kvittens.",
      "Betala avgifterna och skatten till skattekontot senast förfallodagen.",
    ],
    receiptHint: "Kvittensen har ett referensnummer. Skriv in det i Ferva eller ladda upp kvittensen som PDF.",
  },
  ink2: {
    type: "ink2",
    authority: "skatteverket",
    authorityName: "Skatteverket",
    serviceName: "Filöverföring",
    serviceUrl: "https://www.skatteverket.se/etjanster/filoverforing.4.1f604301062bf0c47e8000527.html",
    fileHint:
      "Två filer hör ihop och lämnas i samma överföring: BLANKETTER.SRU (INK2, INK2R, INK2S) och INFO.SRU (vem som lämnar). Hämta paketet så får du båda.",
    steps: [
      "Logga in i e-tjänsten Filöverföring med din e-legitimation.",
      "Ladda upp båda filerna – BLANKETTER.SRU och INFO.SRU – i samma överföring. Tjänsten kontrollerar formatet och visar en kvittens på att filerna tagits emot.",
      "Logga in på Mina sidor hos Skatteverket och skriv under inkomstdeklarationen. Den räknas som lämnad först när den är underskriven av behörig firmatecknare eller deklarationsombud.",
      "Konton som saknar ruta i räkenskapsschemat (listas i Ferva) fylls i för hand i e-tjänsten innan du skriver under.",
    ],
    receiptHint:
      "Filöverföringen ger en kvittens med referensnummer, och underskriften på Mina sidor en till. Skriv in referensen för underskriften i Ferva eller ladda upp kvittensen.",
  },
  arsredovisning: {
    type: "arsredovisning",
    authority: "bolagsverket",
    authorityName: "Bolagsverket",
    serviceName: "Lämna in årsredovisningen digitalt",
    serviceUrl: "https://bolagsverket.se/sjalvservice/etjanster/lamnainarsredovisningendigitalt.1663.html",
    fileHint:
      "Årsredovisningen som iXBRL (.xhtml) är formatet för Bolagsverkets digitala inlämning. Filen laddas upp av ett program eller en tjänst som är ansluten till Bolagsverket – Ferva är inte ansluten utan avtal, så den digitala vägen kräver en ansluten tjänst.",
    steps: [
      "Håll årsstämman och låt den fastställa resultat- och balansräkningen. Datumet ska in i fastställelseintyget i Ferva.",
      "Digital väg: ladda upp iXBRL-filen i ett program eller en tjänst som är ansluten till Bolagsverket, bjud in den styrelseledamot eller VD som ska skriva under fastställelseintyget, och låt den personen logga in hos Bolagsverket, skriva under och skicka in.",
      "Kvittensen från Bolagsverket visas direkt i e-tjänsten för den som skickar in.",
    ],
    receiptHint: "Bolagsverkets kvittens har ett ärendenummer. Skriv in det i Ferva eller ladda upp kvittensen som PDF.",
    alternative: {
      title: "På papper",
      steps: [
        "Skriv ut årsredovisningen från Ferva (A4-vyn) och låt hela styrelsen och VD skriva under den.",
        "Skriv fastställelseintyget i original på en kopia av årsredovisningen: en styrelseledamot eller VD intygar att kopian stämmer med originalet och att stämman fastställde räkningarna, med stämmodatum.",
        "Posta kopian med fastställelseintyget (och revisionsberättelsen om bolaget har revisor) till Bolagsverket, Årsredovisningar, 851 98 Sundsvall.",
        "Bolagsverket skickar bekräftelse när årsredovisningen är registrerad. Rapportera i Ferva när du postat den och komplettera med Bolagsverkets ärendenummer när det kommer.",
      ],
    },
  },
  hus: {
    type: "hus",
    authority: "skatteverket",
    authorityName: "Skatteverket",
    serviceName: "Rot och rut – företag",
    serviceUrl:
      "https://skatteverket.se/foretag/etjansterochblanketter/allaetjanster/tjanster/rotochrutforetag.4.361dc8c15312eff6fdfca4.html",
    fileHint:
      "Begäran om utbetalning (.xml) importeras i e-tjänsten. Filen innehåller ett ärende per betald faktura – ROT och RUT går inte i samma fil.",
    steps: [
      "Logga in i e-tjänsten med din e-legitimation. Aktiebolag måste först ha anmält firmatecknaren eller ett ombud i Ombud och behörigheter.",
      "Välj Begär utbetalning och sedan Importera fil. Peka ut filen du hämtade från Ferva – ärendena fylls i automatiskt.",
      "Kontrollera ärendena mot fakturorna och skicka in begäran. Begäran ska ha kommit in senast den 31 januari året efter kundens betalning.",
      "Skatteverkets beslut kommer i e-tjänsten under Beslut. Registrera beslutet och utbetalningen på ärendet i Ferva när pengarna kommer.",
    ],
    receiptHint: "E-tjänsten visar en kvittens med ärendenummer när begäran skickats in. Skriv in numret på ärendet i Ferva.",
  },
};

export function filingInstruction(type: FilingDocumentType): FilingInstruction {
  return INSTRUCTIONS[type];
}

export const FILING_DOCUMENT_LABEL: Record<FilingDocumentType, string> = {
  moms: "Momsdeklaration",
  agi: "Arbetsgivardeklaration",
  ink2: "Inkomstdeklaration 2",
  arsredovisning: "Årsredovisning",
  hus: "ROT/RUT – begäran om utbetalning",
};
