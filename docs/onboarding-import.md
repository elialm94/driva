# Onboarding, Kom igång och import av uppgifter

Två korta onboardingsteg, ett beständigt Kom igång-center och en gemensam
importsida som tar emot bokföring (SIE), kund- och leverantörsregister samt
grossisternas prislistor. Ingenting importeras eller bokförs utan
förhandsgranskning och uttrycklig bekräftelse.

## Routes och tillstånd

| Route | Vad | Vem |
| --- | --- | --- |
| `/onboarding` | Steg 1 *Berätta om företaget* → steg 2 *Anpassa Ferva efter företaget*. Steget avgörs av sparat tillstånd, inte av URL:en. | Inloggad ägare utan företag, eller med företag där onboarding ≠ klar |
| `/` (Hem) | Kortet **Gör Ferva redo** tills rekommenderade uppgifter är klara/uppskjutna/bortvalda | Alla |
| `/installningar?flik=kom-igang` | Kom igång-centret: profil, uppgifter, uppskjutna/bortvalda, genomförda importer, *Ladda upp filer* | Alla (permanent) |
| `/kom-igang/importera` | *Flytta dina uppgifter till Ferva* | Ägare/admin (`import_data`) |
| `POST /api/kom-igang/import` | `mode=analyze` / `mode=import` (multipart ≤ 25 MB) | Ägare/admin, same-origin |
| `/dev/onboarding?steg=1\|2` | Lokal förhandsvisning av stegen i JSON-läget | Bara utan Supabase |

### Onboardingtillstånd (`business_onboarding`, `DB.onboarding`)

```
not_started ──steg 1 (företaget skapas)──▶ company_done ──steg 2 (Öppna Ferva)──▶ complete
```

Kolumner: `status`, `current_step`, `started_at`, `company_completed_at`,
`personalization_completed_at`, `completed_at`, `industries` (jsonb, flera
val), `other_industry`, `payroll`, `bookkeeping`, `task_overrides` (jsonb),
`updated_at`. RLS via `app.is_member(business_id)`.

Invarianter:

* **Företaget skapas efter steg 1.** Medlemskapet räcker därför inte som
  "klar": `membershipsForUser` joinar `business_onboarding.status` och
  `requireBusiness()` skickar ägare med `status ≠ complete` till `/onboarding`.
  `/onboarding` använder aldrig `requireBusiness` → ingen redirect-loop.
* **Saknad rad = klar.** Migration 31 backfillar alla befintliga företag som
  `complete`; `ensureOnboardingSchema` (pending schema) gör samma sak i
  miljöer där `supabase db push` inte körts. Konsultmedlemskap räknas aldrig.
* **Bolagsform sparas explicit** (`business_settings.company_form`, `ab` |
  `enskild`). Andra former avvisas ärligt – vi gissar inte redovisningsregler.
* **Momsregistreringsnummer härleds** (`SE` + 10 siffror + `01`) och visas som
  uträknat. Ett avvikande värde avvisas på servern.
* **Betalningsuppgifter kan läggas till senare.** Samma
  `settingsBillingReadiness` styr Kom igång-uppgiften, varningen i
  Inställningar och om en faktura kan skickas – ingen dubblerad validering.
* Demo/JSON-läget har ett färdigt företag och går aldrig in i onboarding.

## Kom igång-centret

Statusen **härleds** ur verklig data (`src/lib/setup/tasks.ts`); bara
*gör senare* och *behövs inte* lagras (`task_overrides`). "Klar" vinner alltid
över ett sparat val.

| Uppgift | Klar när | Visas |
| --- | --- | --- |
| Flytta in bokföringen | en import av typ `bokforing` är genomförd | rekommenderad vid *befintlig bokföring*, valfri vid konsult/senare, dold vid *nystartat* |
| Bjud in din redovisningskonsult | inbjudan/medlemskap finns (`hasCollaborationUsage`) | rekommenderad vid *konsult*, annars valfri |
| Lägg till första kunden | minst en kund | alltid |
| Skapa första uppdraget | minst ett (ej arkiverat) uppdrag | alltid |
| Lägg till betalningsuppgifter | readiness saknar betalningsblockering | alltid; först i ordningen så snart offerter/fakturor finns |
| Koppla banken | `bankConnectionView().status === "connected"` | alltid |
| Lägg in artiklar och priser | en aktiv prisimport finns i Grossistbeställningar | rekommenderad för El/VVS, annars valfri. Avstängd funktion → knappen aktiverar den (samma väg som Funktioner) och landar på Grossister |
| Ställ in lön | – | **dold**: lön finns inte i Ferva; behovet sparas i profilen och visas ärligt där |

Hem-kortet visar högst tre öppna rekommenderade uppgifter, den mest värdefulla
först, och försvinner när inga återstår. Centret i Inställningar är permanent.

## Importflödet

1. **Analys** (`analyzeImportFile`): filhash (SHA-256), filtyp, innehåll.
   * SIE på innehållet (`#FLAGGA/#SIETYP/…`), oavsett filändelse.
   * PDF → *kan inte importeras här* (kvitton/fakturor hör till Inboxen).
   * Tabeller (CSV/TXT/XLSX/XML/ZIP) via grossistmodulens läsare
     (`parsePriceFile`) → `classifyRegisterTable` på rubrikerna:
     kunder / leverantörer / artiklar / okänt.
   * Okänt eller utan namnkolumn: AI-förslag om nyckel finns (se nedan),
     annars väljer användaren innehåll och kolumner manuellt.
2. **Kort per fil** med vad Ferva tror, vad som skapas, vad som utelämnas,
   dubbletter, varningar, obligatoriska val och *Kontrollera detaljer*.
   Verklig progress: *Läser filen* (uppladdning) → *Kontrollerar innehållet*
   (serveranalys) → *Redo att granskas*.
3. **Bekräftelse** → `mode=import`: filen laddas upp igen, hashen måste vara
   samma som vid analysen, importen körs i EN tenantcommit (`withBusiness`).
   Klart visas först när servern svarat.
4. **Audit** i `data_imports`: användare, företag, tidpunkt, filtyp, hash,
   storlek, val (mappning/år/anslutning), skapade/uppdaterade/ignorerade,
   varningar, sammanfattning, ev. fel. Unikt index
   `(business_id, kind, file_hash) where status = 'imported'` – samma fil kan
   inte importeras två gånger för samma ändamål ("redan inflyttad").

Filerna sparas aldrig och filinnehåll loggas aldrig. Filnamn saneras.
Tabellläsarna har gränser för rader/kolumner/celler, neutraliserar
formelinjektion och läser XML utan externa entiteter.

### Register (kunder, leverantörer)

Kolumnmappning på svenska/engelska rubriksynonymer med innehållsheuristik
(e-post, postnummer, organisationsnummer). Användaren rättar i vyn *Vi tror att
dessa kolumner hör ihop* med exempelrader. Rader utan namn faller bort (med
radnummer); fel i frivilliga fält (e-post, organisationsnummer, postnummer,
bankgiro …) lämnar fältet tomt och flaggar raden. Dubbletter mot registret
(organisationsnummer, personnummer, e-post, namn) och inom filen hoppas över –
inget skrivs över. Fastighetsbeteckning blir en bostad på kunden. Leverantörer
landar i `suppliers` och listas under Ekonomi → Utgifter; betalningsuppgifter
där är förslag, aldrig automatiskt verifierade.

### Artiklar och priser

Använder grossistmodulen rakt av: samma `importPriceFile`, samma tabeller
(`wholesaler_price_imports`, `wholesaler_products`) och samma prisbegrepp.
Kräver aktiv funktion + en grossistanslutning (kortet förklarar annars och
länkar till Funktioner/Grossister). Kom igång-uppgiften heter *Lägg in artiklar
och priser*. Ingen parallell katalog skapas.

## SIE-import

`src/lib/imports/sie-parse.ts` (läsare) och `sie-import.ts` (förhandsgranskning
+ genomförande). Stöder SIE 4/4E som svenska program exporterar.

**Tas med**

* Företagsnamn/organisationsnummer (kontroll mot företaget), `#PROGRAM` som diagnostik.
* Räkenskapsår (`#RAR`, även brutna) → `fiscal_years` med etikett `2025` eller `2024/2025`.
* Ingående balanser (`#IB`) för de år som tas med → `opening_balances`, `opening_source = migrering`.
* Kontoplan (`#KONTO`): konton utanför Fervas BAS-utdrag följer med med namnet från filen.
* Verifikationer (`#VER` + `#TRANS`) med filens **serie och nummer**, källa
  `sie_import`, `created_by = anvandare`. Serie A flyttar fram företagets
  nummerserie (`business_sequences.verification`) så nya verifikationer aldrig
  kolliderar. Onumrerade verifikationer och samlade saldoposter får serien `SIE`.
* Projekt/resultatenheter (`#DIM`/`#OBJEKT`) som text på raden ("Projekt: Villa Ekbacken").
* År som **bara har saldon** (`#IB/#UB/#RES`, inga `#VER`): IB + EN samlad post
  "Årets bokföring … enligt SIE-fil (saldon, inte enskilda verifikationer)".
* PC8/CP437 och UTF-8 (med/utan BOM), klammer på samma eller nästa rad,
  `\"` i texter, punkt eller komma som decimaltecken, `#RTRANS/#BTRANS` ignoreras.

**Tas inte med / begränsningar (sägs alltid i förhandsgranskningen)**

* Verifikationer som **inte balanserar i filen** (ören) – listas och utelämnas, importeras aldrig som korrekta.
* Dubbletter (samma serie + nummer två gånger i filen) – bara första tas med.
* Serie + nummer som redan finns i Ferva – hoppas över.
* År som överlappar ett befintligt räkenskapsår med andra datum, eller stängda år – kan inte importeras.
* År som redan har bokföring i Ferva är **avmarkerade som standard**; väljs de läggs filens verifikationer till, inget skrivs över.
* Verifikationer med datum utanför filens räkenskapsår.
* `#UB`/`#RES` används inte för år som har verifikationer (Ferva räknar UB själv).
* Objektsaldon (`#OIB/#OUB`), budget (`#PBUDGET/#PSALDO`), `#SRU`, `#KTYP`, `#ENHET`.
* Ferva bokför i **hela kronor**: ören avrundas per verifikation med
  största-rest-metoden så att varje verifikation balanserar exakt (ingen rad
  ändras mer än ±1 kr, inget konstgjort konto). Detsamma för IB.
* Ingående balanser som inte summerar till noll i filen stoppar det årets import.
* Filer > 25 MB eller > 200 000 verifikationer avvisas (exportera ett år i taget).

Importen är transaktionell: allt byggs i staging och skrivs i ett steg; i
Supabase går verifikationerna via `app.import_verification` (samma
radvalidering som `app.post_verification`, unikt index på serie+nummer,
immutabla efteråt) i samma commit-transaktion som räkenskapsår och audit.

## AI:s roll

* **Får:** föreslå vad en tabell innehåller (kunder/leverantörer/artiklar) och
  vilka kolumner som hör till vilka fält när rubrikerna inte känns igen
  (`src/lib/imports/classify-ai.ts`). Bara rubriker + två avkortade exempelrader
  skickas. Förslaget märks *AI-förslag* och bekräftas av användaren.
* **Får inte:** bokföra, skapa verifikationer, ändra belopp, hitta på värden
  eller välja mellan ekonomiskt betydelsefulla alternativ. SIE tolkas alltid
  deterministiskt.
* **Utan nyckel / vid fel:** `aiSuggestTableMapping` returnerar `null` och det
  deterministiska + manuella flödet fortsätter oförändrat. Inga nya
  miljövariabler – samma `OPENROUTER_API_KEY`/`AI_*` som övriga AI-funktioner.

## Tester och verifiering

* `src/lib/onboarding.test.ts` – steg 1: bolagsform, härlett momsnummer, betalning nu/senare, befintliga företag.
* `src/lib/setup/setup.test.ts` – tillståndsmaskin, återupptagning, redirectregel, mappers, uppgifter härledda ur data, gör senare/ta upp igen, prioritering.
* `src/lib/imports/sie.test.ts` – läsare (PC8/UTF-8/klamrar/avhuggen fil), förhandsgranskning (obalans, dubbletter, konflikter, org.nr), import (IB, nummer, dimensioner, flera år, saldon, rundresa av Fervas egen export, 20 000 verifikationer).
* `src/lib/imports/registers.test.ts` – klassning, mappning, manuell rättning, dubbletter, idempotens, AI av/trasig, artiklar via grossistmodulen.
* `scripts/db-validate.ts` – RLS för de nya tabellerna, `app.import_verification`, hash-index, backfill via pending schema.
* `scripts/adapter-validate.ts` – steg 1/2 genom adaptern, SIE genom commit (nummerserie, audit, isolering), leverantörer.
* `scripts/verify-onboarding-browser.ts` – formulären på 390/320 px, Kom igång, Hem-kortet, hela importflödet i webbläsaren.
