# Bankfiler för leverantörsbetalningar (pain.001)

Driva genererar betalningsfiler enligt **ISO 20022 pain.001.001.03**
(CustomerCreditTransferInitiationV03) – den version svenska banker (SEB,
Handelsbanken, Swedbank, Nordea) tar emot för filbaserade leverantörs-
betalningar. V1 är **endast filexport**: Driva skapar filen, användaren
laddar upp den i sin internetbank och godkänner betalningen där. Driva
påstår aldrig att banken tagit emot något ("Bankfil skapad" ≠ "Skickad
till bank" ≠ "Betald").

## Svensk profil

| Del | Val |
| --- | --- |
| Namnrymd | `urn:iso:std:iso:20022:tech:xsd:pain.001.001.03` |
| Teckenkodning | UTF-8, LF-radslut, XML-deklaration med `encoding="UTF-8"` |
| `GrpHdr/MsgId` | `DRIVA-{ÅÅÅÅMMDD-TTMMSS}-{6 tecken}`, unik per företag (unikt index i Postgres), max 35 tecken |
| `GrpHdr/CtrlSum`, `PmtInf/CtrlSum` | Summan av beloppen med exakt 2 decimaler, punktdecimal |
| `PmtInf` | En per önskat betaldatum (`ReqdExctnDt` ligger på PmtInf-nivå); `PmtMtd` = `TRF`, `BtchBookg` = `false`, `ChrgBr` = `SLEV` |
| Betalare (`Dbtr`) | Företagsnamn + organisationsnummer (10 siffror) i `Id/OrgId/Othr/Id` |
| Betalkonto (`DbtrAcct`) | IBAN (valideras med mod-97) + `Ccy` = `SEK` |
| Bank (`DbtrAgt`) | `FinInstnId/BIC` när BIC finns, annars `FinInstnId/Othr/Id` = `NOTPROVIDED` (tillåtet i schemat – banken identifieras via IBAN) |
| Bankgiro-mottagare | `CdtrAcct/Id/Othr/Id` = enbart siffror, `SchmeNm/Prtry` = `BGNR` |
| Plusgiro-mottagare | Samma struktur med `SchmeNm/Prtry` = `PGNR` |
| IBAN-mottagare | `CdtrAcct/Id/IBAN` |
| OCR | `RmtInf/Strd/CdtrRefInf` med `Tp/CdOrPrtry/Cd` = `SCOR` och `Ref` = OCR-numret (enbart siffror) |
| Utan OCR | `RmtInf/Ustrd` = "Faktura {fakturanummer}" (max 140 tecken) |
| `PmtId` | `InstrId` och `EndToEndId` härleds ur instruktionens id (≤ 35 tecken) – spårbara hela vägen till avstämningen |
| Filnamn | `driva-betalningar-{ÅÅÅÅ-MM-DD}.xml`, `-2`/`-3` vid flera filer samma dag |

## Arkitektur

- `src/lib/banking/pain001.ts` – typad domänmodell (`Pain001Document`),
  strukturell validering med exakta svenska fel och XML-serialiserare.
  Ingen XML byggs någon annanstans.
- `src/lib/banking/payment-export.ts` – `PaymentExportProvider`-gränssnittet
  med `ISO20022_PAIN001`-implementationen. Bankspecifika profiler kan läggas
  till som egna providers senare utan att livscykeln byggs om.
- `src/lib/services/payment-files.ts` – `createPaymentFile` /
  `regeneratePaymentFile`: validerar allt FÖRE generering (företagets
  betalkonto, bokförd, verifierade betalningsuppgifter, ingen aktiv fil),
  persisterar `PaymentFile` (XML + metadata) och sätter instruktionerna till
  `PAYMENT_FILE_CREATED`. En fil kan bära flera betalningar.
- Företagets betalkonto (bank, IBAN, BIC) konfigureras under Inställningar
  och lagras i `business_settings.payer_*`.

## Skydd

- **Dubbelbetalning:** en faktura kan bara ingå i en aktiv fil – vakt i
  tjänsten plus partiellt unikt index (`supplier_payments_active_invoice_uq`)
  som räknar `PAYMENT_FILE_CREATED` som aktiv. Regenerering markerar den
  gamla filen `REPLACED` med `replacedByFileId` – aldrig parallella filer.
- **Dubblettfaktura:** samma leverantör + fakturanummer återanvänder den
  befintliga fakturaraden (`findDuplicateSupplierInvoice`) och kan därmed
  aldrig ge en andra instruktion.
- **Betalningsuppgifter:** endast VERIFIERADE destinationer når en fil.
  Ändrade uppgifter (CHANGED) blockerar tills en människa godkänt dem.
- **Avbruten betalning:** makulerar filen (status `CANCELLED`) och släpper
  övriga betalningar i filen tillbaka till `READY`.

## Validering

XSD-schemat kunde inte hämtas från iso20022.org i byggmiljön (begränsad
nätverksåtkomst), så valideringen är strukturell i stället:

- `validatePain001Document` vaktar fältformat (MsgId-teckenuppsättning,
  IBAN mod-97, BIC-format, bankgiro/plusgiro-siffror, OCR, belopp med max
  2 decimaler, datumformat) före varje serialisering.
- `src/lib/banking/pain001.test.ts` parsar den genererade XML:en och
  asserterar namnrymd, elementordning enligt schemat, obligatoriska element,
  kontrollsummor, escapning och svenska profilval (BGNR/SCOR).

Vill man validera mot XSD lokalt: hämta `pain.001.001.03.xsd` från
iso20022.org och kör t.ex. `xmllint --schema pain.001.001.03.xsd fil.xml`.
