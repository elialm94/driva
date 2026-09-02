# Driva

**AI-native business-in-a-box för svenska småföretag.** Du gör jobbet – Driva sköter administrationen: offerter med BankID-godkännande, jobb, fakturor, betalningsmatchning, kvitton och automatisk bokföring.

## Kom igång

```bash
npm install
npm run dev
```

Öppna [http://localhost:3123](http://localhost:3123). `npm run dev` kör `scripts/dev-3123.sh`: den binder **endast 3123**, startar inte en andra server om GET `/` redan är 200, och startar om Next inom en sekund om processen dör. Agents: kill:a inte next på 3123 om porten redan svarar HTTP 200.

Utan Supabase-miljövariabler kör appen i **lokalt JSON-läge** och seedas automatiskt med demodata för **Södermalms Snickeri AB** (fil-baserad databas i `.data/db.json`). Klicka på företagsnamnet nere i vänstermenyn för att återställa demon. Med Supabase-miljö (se "Supabase setup") får du i stället riktig inloggning, onboarding och Postgres.

### Google Maps-adresssökning (valfritt)

Adressfältet i "Ny kund" använder Google Places-autocomplete och fyller i postnummer och ort automatiskt. Lägg en nyckel med **Places API (New)** aktiverat i `.env.local`:

```bash
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=din-nyckel
```

Utan nyckel används svenska exempeladresser, tydligt märkta "Demo" i förslagslistan.

### AI-assistent (valfritt)

Kommandofältet på Hem och `/assistent` är deterministiskt först: vanliga uppgifter körs helt utan LLM. Med `OPENROUTER_API_KEY` tolkas fri text via en serverside verktygsloop mot samma verktygsregister (riskklasser, validering och bekräftelsekort upprätthålls serversidigt); **utan nyckel får fri text ett ärligt "inte konfigurerad"-svar** – vi låtsas inte att en modell svarar (samma ärlighet som BankID-mock).

Arkitektur, riskklasser (inkl. `FORBIDDEN_FOR_AI`), bekräftelsepolicy, kostnadskontroll och känsliga data: se **[docs/ai.md](docs/ai.md)**.

Lägg i `.env.local`:

```bash
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
```

| Variabel | Standard | Anteckning |
| --- | --- | --- |
| `AI_PROVIDER` | `openai-compatible` | `openrouter` för verktygsloopen; `none` stänger av även med nyckel |
| `OPENROUTER_API_KEY` | (tom) | Endast serversidan. Saknas den → deterministisk demo |
| `AI_MODEL_FAST` | `google/gemini-3.7-flash` | Billig, verktygssäker standard |
| `AI_MODEL_SMART` | `openai/gpt-5.6-terra` | Bara långa/fleragsfrågor |
| `AI_MAX_TOOL_STEPS` / `AI_MAX_OUTPUT_TOKENS` | `6` / `700` | Kostnads-/stegtak per fråga |
| `AI_MODEL`/`AI_API_KEY`/`AI_BASE_URL` | – | Äldre generisk OpenAI-kompatibel väg |

Verifiera assistentens tjänstelager (utan att skriva till `.data/db.json`):

```bash
npm run test:assistant
```

## Kärnflödet

**Kund → Uppdrag → Offert → BankID-godkännande → Faktura → Betalning → Bokföring**

- Offert- och fakturautkast visas som dokumentet på detaljsidan. Skicka bekräftas i en liten dialog – ingen extra förhandsgranskning.
- Kundens offertsida (`/offert/[token]`) är mobil-först med **Godkänn med BankID** som primär handling.
- Vid godkännande låses offertversionen, en SHA-256-hash av innehållet sparas med signaturen, och jobbet skapas automatiskt. Signeringsunderlaget kan öppnas och verifieras i efterhand.
- Betalningar matchas mot fakturor (OCR/belopp) och bokförs automatiskt enligt BAS-kontoplanen.
- Bokföringen är confidence-styrd: hög säkerhet bokförs direkt, låg säkerhet blir en enkel fråga ("Vad gällde köpet på Grand Hôtel?").

## Arkitektur

| Del | Var | Anteckning |
| --- | --- | --- |
| Domänmodell | `src/lib/types.ts` | Customer, Request, Quote, QuoteVersion, BankIDSignature, Job, Invoice, Payment, Expense, Receipt, SupplierInvoice, Verification … |
| Tjänstelager | `src/lib/services/` | All affärslogik; UI:t och AI-assistenten anropar samma funktioner |
| BankID | `src/lib/services/bankid.ts` | `BankIDProvider`-interface; demon kör `MockBankIDProvider` (tydligt markerat i UI). Mocken är servergrindad: den signerar bara i demoläge/för demoföretaget – riktiga företag i produktion får ett ärligt "inte aktiverat" tills en riktig RP-API-integration kopplas in här |
| Open Banking | `src/lib/services/banking.ts` | `BankProvider`-abstraktion förberedd för t.ex. Tink; matchningsmotorn är riktig |
| Bokföring | `src/lib/bas.ts` | BAS-konton, momssatser, konteringsregler, verifikationer |
| AI-assistent | `src/lib/services/assistant.ts`, `src/lib/ai/` | LLM med tool calling mot samma tjänster som UI:t; regelbaserad fallback utan `AI_API_KEY` |
| Domän | `src/lib/domains/` | `.se`-köp via registrar-abstraktion (Openprovider + mock). Hosting mot Vercel-projektet **driva** (`driva-alpha.vercel.app`), inte noxfort |
| Lagring | `src/lib/store.ts` + `src/lib/storage/` | Två lägen: **Supabase/Postgres** (produktion – RLS, atomära RPC:er, audit) och **lokal JSON** (`.data/db.json`, endast utveckling/tester). Se "Supabase setup" nedan |
| Auth & tenancy | `src/proxy.ts`, `src/lib/auth/session.ts` | Supabase Auth (e-post + lösenord), `business_memberships`, tenantkontext per request |

### Egen .se-adress

Hemsida → Domän: sök, köp, koppla. Standard är **mock** (ingen riktig .se köps). Se `.env.example` för Openprovider-sandbox och `VERCEL_PROJECT_NAME=driva`.

## Supabase setup

Driva kör mot **Supabase/Postgres i produktion** – riktig inloggning, ett företag per kund (multi-tenant) och Row-Level Security på varje tabell. Utan Supabase-miljövariabler kör appen i **lokalt JSON-läge** (demoläget ovan). I produktion är JSON-läget avstängt: saknas miljön stannar appen med ett tydligt fel i stället för att tyst falla tillbaka.

### 1. Skapa projektet

1. [database.new](https://database.new) → nytt projekt (region: `eu-north-1` Stockholm ligger närmast). Välj ett starkt databaslösenord och spara det.
2. Anteckna projekt-referensen (`<ref>` i `https://<ref>.supabase.co`).

### 2. Miljövariabler

Kopiera `.env.example` → `.env.local` och fyll i:

| Variabel | Var den finns | Exponering |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Dashboard → Settings → API | Publik (klient + server) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dashboard → Settings → API (anon/publishable) | Publik (skyddas av RLS) |
| `SUPABASE_DB_URL` | Dashboard → Connect → Session/Transaction pooler | **Endast server** |
| `SUPABASE_SERVICE_ROLE_KEY` | Dashboard → Settings → API (service role) | **Endast server** – behövs bara för `db:seed`/migreringsskriptet |

Serverless (Vercel): använd **Transaction pooler**-URL:en (port 6543) som `SUPABASE_DB_URL`. Ingen av server-variablerna får någonsin ges ett `NEXT_PUBLIC_`-prefix.

> **Vercel↔Supabase-integrationen:** kopplar du Supabase via Vercels Marketplace-integration i stället för att sätta variablerna för hand får du databas-URL:en under `POSTGRES_URL` / `POSTGRES_PRISMA_URL` / `POSTGRES_URL_NON_POOLING` – integrationen sätter **aldrig** `SUPABASE_DB_URL`. Appen accepterar dessa namn automatiskt (poolade `POSTGRES_URL*` föredras för serverless). Nyckeln kan heta `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` i stället för `NEXT_PUBLIC_SUPABASE_ANON_KEY`; båda fungerar.

### 3. Migrationer

Schemat ligger som versionerade SQL-filer i `supabase/migrations/` (8 filer: extensions/roller, tenancy, kärndomän, bokföring, webb/assistent/audit, atomära funktioner, RLS-policys, storage-buckets).

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push          # applicerar alla migrationer
```

Nya schemaändringar: `npx supabase migration new <namn>` → skriv SQL → `db push`.

### 4. Seed (dev/test-data)

```bash
npm run db:seed                       # skapar agare@driva.test + demoföretaget
npm run db:seed -- --email du@x.se --password hemligt123
npm run db:seed -- --empty            # bara användare + tomt företag
npm run db:seed -- --demo             # internt demoföretag (is_demo-sandlåda med riktig inloggning)
```

Skriptet skapar auth-användaren (service role), företaget med ägarmedlemskap och spelar upp demodatat genom **samma atomära RPC:er som appen** (fakturanummer, verifikationer, betalningar). Körs aldrig automatiskt, och vägrar skriva till ett företag som redan har data. Exempeldatats id:n är fasta – skriptet vägrar också om ett **annat** företag i samma databas redan bär dem (seeda dev- och demoföretag i olika databaser, eller ta bort det gamla först).

### 5. Lokal utveckling

* **Utan Docker:** kör mot det riktiga Supabase-projektet (env enligt ovan), eller kör JSON-läget genom att lämna variablerna tomma. Hela databasstacken valideras dessutom i Postgres/WASM utan Docker: `npm run test:db` (59 SQL-invarianter: RLS, atomicitet, immutabilitet, samtidighet, delbetalningar, dedup) och `npm run test:adapter` (20 heltäckande adapterkontroller med riktiga domäntjänster, inkl. seed-import).
* **Med Docker:** `npx supabase start` startar en lokal stack, `npx supabase db reset` applicerar migrationerna från noll. Peka `SUPABASE_DB_URL` mot den lokala instansens URL (visas av `supabase status`).
* `DRIVA_STORAGE=json` tvingar JSON-läget även med satta variabler (endast utveckling).

### 6. Produktion (Vercel)

1. Sätt `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` och `SUPABASE_DB_URL` (Transaction pooler) i Vercel-projektets miljövariabler. `SUPABASE_SERVICE_ROLE_KEY` behövs **inte** i appen – endast för seed-/migreringsskripten lokalt.
2. Deploya. Utan komplett miljö vägrar appen starta mot data (inget tyst demoläge).
3. Verifiera: `/login` ska visas, en ny användare ska hamna i onboarding och få ett eget företag.
4. **Diagnostik:** öppna `/api/health` på den driftsatta sajten. Endpointen kräver ingen inloggning och läcker inga hemligheter – den visar vilka miljövariabler som saknas, om databasen svarar och om migrationerna körts. `status: "ok"` = allt på plats; `misconfigured` = sätt env; `degraded` med hint om schema = kör `supabase db push`.

### 7. Manuella steg i dashboarden

1. **Auth → Providers → Email:** ha *Email* på (standard). Bestäm *Confirm email* – med bekräftelse på måste användaren klicka mejllänken innan inloggning (signup-flödet hanterar båda lägena).
2. **Auth → URL Configuration:** sätt *Site URL* till produktions-URL:en (t.ex. `https://driva-alpha.vercel.app`) och lägg till ev. preview-URL:er under *Redirect URLs*.
3. **Buckets:** skapas av migrationerna (`receipts` privat, `website-images` publik) – inget manuellt steg om `db push` körts.
4. **Auth → Rate limits:** standardvärdena räcker för start.

### Publik demo (`/demo`)

**Se demo** (landningssidan och `/login`) låter vem som helst utforska Södermalms Snickeri AB med exempeldata – utan konto och **utan databas**. Demon bor aldrig i Postgres: den är JSON + cookie.

Så fungerar den:

* **En httpOnly-cookie, en JSON-fil per besökare.** GET `/demo` sätter `driva_demo` (kryptografiskt slumpat session-id + utgångstid) och klonar det kanoniska seedet till sessionens egen fil: `.data/demo-sessions/<id>.json` (`/tmp` på serverless). Det är **samma JSON-lager som den lokala utvecklingen** – inte en andra Driva – bara request-skopat till sessionens fil.
* **Request-skopad specialväg i Supabase-läget.** En demorequest kör `db()`/`save()` mot sessionens fil via samma tenantkontext som Supabase-vägen använder; riktiga inloggade användare fortsätter mot Supabase som vanligt, och en riktig inloggning vinner alltid över en kvarglömd demokaka. Demon skapar, läser eller raderar **aldrig** Supabase-rader.
* **Reload inom livslängden → samma fil.** Annan webbläsare/incognito → egen färsk klon. **Inställningar → Återställ demo** skriver över filen med färskt seed. **Avsluta demo** och **Skapa ditt eget konto** i menyn slänger filen och rensar kakorna; ett diskret **Demo**-märke visas vid företagsnamnet.
* **Städning utan cron:** demosessionen lever `DEMO_SESSION_HOURS` (standard 24 h). Utgångna filer tas bort med enkel katalogstädning som körs opportunistiskt när nya sessioner klonas – ingen SQL, inga riktiga tabeller.
* **Inga externa sidoeffekter:** demons mejl går aldrig till riktiga mottagare – centralvakten i `sendMail` simulerar utskicket (UI:t visar "Demo: mejlet simulerades och skickades inte externt") eller skickar till `DEMO_EMAIL_SINK` med `[Demo]`-prefix om den är satt. BankID är mocken, bankflöden är simulerade, Places-förslag är lokala exempeldata, och AI:n kör alltid den snabba modellen med dygnstak + per-sessionsfönster (ärligt gränsbesked, resten av demon fungerar vidare).
* **Rate limits:** demostarter stryps per IP och instans, skrivningar per session (60/min) och återställningen per instans. Fönstren är i minnet per serverless-instans (bäst ansträngning); i botten gäller katalogstädningen.

Ingen seedning eller extra miljö krävs – demon fungerar direkt efter deploy. Valfria variabler (endast servermiljö):

| Variabel | Standard | Anteckning |
| --- | --- | --- |
| `DEMO_SESSION_HOURS` | 24 | Demosessionens livslängd, klampas till 1–72 h |
| `DEMO_EMAIL_SINK` | (tom) | Om satt: demons mejl skickas hit (med `[Demo]`-prefix) i stället för att simuleras |
| `DEMO_AI_DAILY_CAP` | 300 | Dygnstak för demons LLM-anrop (kräver `OPENROUTER_API_KEY` för AI alls) |

E2E-verifieringen (`npx tsx scripts/verify-logged-out-demo.ts`) kör två separata webbläsarkontexter (egna cookie jars) mot en dev-server och verifierar isoleringen **mot JSON-filerna** – ingen lokal Supabase-stack behövs för att testa demon.

### Migrera lokal data

```bash
npm run migrate:local-to-supabase -- --user-email du@x.se        # förhandsvisning
npm run migrate:local-to-supabase -- --user-email du@x.se --yes  # utför
```

Läser `.data/db.json` (eller `--file <sökväg>`), skapar företaget och spelar upp hela historiken genom appens commit-väg: entitets-id:n bevaras exakt (offert-/fakturalänkar överlever), fakturanummer/verifikationsnummer replayas genom databasens sekvensvakter, och till sist valideras antal per samling plus att offertversioner **hashar identiskt** (BankID-signaturer förblir verifierbara) och att utfärdade fakturasnapshots är värde-exakta. Avbryter hellre än halvimporterar.

### Säkerhetsmodellen i korthet

* **RLS på varje tenanttabell** – två vägar: appens serverroll (`driva_app`) är låst till `app.current_business_id()` (sätts per transaktion), och en direkt inloggad Supabase-användare kommer bara åt företag där hen har medlemskap (`app.is_member`). Publika tokenflöden (offert-/fakturalänkar, kundsajt, BankID) löser företag via `security definer`-uppslag på ogissbara tokens – aldrig via klientpåståenden.
* **Atomära flöden i SQL:** `app.issue_invoice` (nummer + frysta rader + snapshot + bokföring), `app.post_verification` (balanskrav sum(debet)=sum(kredit), obruten nummerserie), `app.match_payment` (bokför det faktiska bankbeloppet, vaktar övergången skickad/delbetald → betald/delbetald, dubbelbetalning omöjlig via unikt index). Immutabilitetstriggers skyddar bokförda verifikationer, utfärdade fakturor, snapshots, låsta offertversioner och auditloggen även om applikationskoden skulle ha fel.
* **Auditlogg** (`audit_log`): aktivitetsflöde, bokföringsaudit, domänhändelser och assistentbeslut skrivs i samma transaktion som ändringen. Personnummer maskeras/utelämnas – de ingår aldrig i auditmetadata.
* **Personnummer** lagras i `customers.personnummer` (endast synligt via RLS-skyddade läsningar; maskeras i UI, "Visa"-åtgärden är en dedikerad server action). Kolumnkryptering är ett medvetet nästa steg – använd i så fall Postgres `pgsodium`/KMS, ingen egen krypto.

## Verifiering

`scripts/verify.mjs` och `scripts/verify2.mjs` klickar igenom alla flöden i headless Chrome (kräver `puppeteer-core` + lokal Chrome) och sparar skärmdumpar i `.shots/`.

Enhetstester (domän, bokföring, fakturor, lagring):

```bash
npm test
```

Databas- och persistenslager (Postgres i WASM – ingen Docker eller Supabase-miljö krävs):

```bash
npm run test:db        # SQL-invarianter i PGlite: RLS, atomära RPC:er, immutabilitet, samtidighet, delbetalningar, dedup
npm run test:adapter   # adapterkontroller: riktiga domäntjänster → diff → commit → validering
```

## Fakturering V1 – omfattning och begränsningar

Driva utfärdar **vanliga svenska småföretagsfakturor**: svensk säljare → svensk kund, valuta **SEK**, momssatser **0 / 6 / 12 / 25 %**. UI, assistent och bokföring går genom samma tjänster (`issueInvoice` / `sendInvoice` i `src/lib/services/invoices.ts`) och samma momsräkning (`docTotals` / `vatBreakdown` i `src/lib/calc.ts`).

**Stöds inte i V1** (inget val i UI, ingen påhittad logik):

- Omvänd skattskyldighet, EU-försäljning, export, byggmoms, vinstmarginalbeskattning
- Andra valutor än SEK
- Peppol/e-faktura
- Verifiering mot Skatteverket, Bolagsverket eller Bankgirot (endast formatkontroll)
- Sparad PDF-blob – den utfärdade `issuedSnapshot` + `InvoiceDocument` är den juridiska kopian (utskrift via `/faktura/[token]/pdf`)

**Stöds sedan autopiloten:** delbetalningar (status `delbetald`), delkredit, kredit av betald/delbetald faktura (skapar återbetalningsskyldighet som bokförs 2420/1510 → 1930), över-/underbetalningshantering och ROT/RUT-utbetalningar från Skatteverket inklusive delvis godkännande.

**Nummer:** nya utkast får `number: null` och visas som ”Utkast”. Löpnummer och OCR tilldelas först i `issueInvoice` på servern. Äldre utkast som redan har nummer behåller det. Misslyckad e-post rullar inte tillbaka numret och markerar inte fakturan som skickad; **Skicka igen** återanvänder samma nummer.

### E-post (Resend)

Offerter, fakturor, betalningspåminnelser och samarbetsinbjudningar skickas via Resend när **både** `RESEND_API_KEY` och avsändare (`RESEND_FROM_EMAIL` / `MAIL_FROM`) är satta. Testdefault `beth.t@example.com` används aldrig som tyst live-From (Resend avvisar då kundens adress). Utan nyckel eller From: offerten markeras som skickad och kundlänken delas – vi låtsas inte att ett mejl gick iväg. Misslyckad Resend lämnar status utkast.

**Rabatt:** inget eget radfält. Negativt à-pris på en rad räknas i samma VAT-motor.

## Ekonomiska beslut (ADR)

Besluten nedan är avsiktliga och testade – ändra dem inte utan att läsa motiveringen.

### ADR-1: Hela kronor i systemet, öre hanteras vid gränsen

Allt i domänen och databasen är **heltalskronor** (`bigint`). Riktiga bankflöden bär öre – de hanteras så här:

* **Importgränsen** (`registerBankTransactions`): beloppet avrundas till hela kronor innan transaktionen registreras. Databasen ser aldrig öre.
* **Matchningen** tolererar avvikelser upp till **1 kr** (`ORE_TOLERANS_KR` i `src/lib/autopilot.ts`): fordran bockas av helt och differensen bokförs på **3740 Öres- och kronutjämning**.
* **Större avvikelser** blir aldrig tysta: underbetalning → status `delbetald` med kvarvarande fordran; överbetalning → beslut krävs av användaren, överskottet bokförs som skuld på **2420 Förskott från kunder** med en återbetalnings-åtgärd.

Motiv: momsberäkning och fakturor i hela kronor är standard för svenska småföretag (öresavrundning är norm), och en migrering till ören i hela stacken ger ingen kundnytta i förhållande till risken. Beslutet kan omprövas om internationella betalningar blir aktuella.

### ADR-2: ROT/RUT-tak är vakter, inte sanning

`docTotals` begränsar avdraget till **ROT 50 000 kr / RUT 75 000 kr per person och år** (lagens tak, `src/lib/calc.ts`). Driva känner **aldrig** kundens faktiskt kvarvarande utrymme hos Skatteverket – kunden kan ha använt avdrag hos andra utförare. Därför är varje avdrag **preliminärt** tills Skatteverket betalat ut: full utbetalning → `godkant`; lägre → `delvis_godkant` + restfaktura till kunden (omflytt 1513 → 1510, aldrig ny intäkt); ingen → `nekat` + restfaktura. Fordran på Skatteverket bor på **1513** och bockas av först när pengarna kommer.

### ADR-3: En löpande verifikationsserie ("A") över räkenskapsår

Verifikationsnumren är en obruten serie per företag – **inte** per räkenskapsår. SIE-exporten exporterar ett räkenskapsår i taget, och `#VER`-poster kräver bara unika nummer inom serien, så exporten är giltig. Beslutet att INTE byta till per-år-serier nu: bytet kräver en migrering av `business_sequences` (nyckel per räkenskapsår), en regel för vilket år en verifikation tillhör vid årsskiftesbokningar, och vinner först något när första bokslutet stängs. Tills dess dokumenteras konventionen här; `verifications.fiscal_year_id` finns redan, så en framtida serieomläggning behöver inte gissa årstillhörighet.

### ADR-4: Autopilotens trösklar bor på ETT ställe

`src/lib/autopilot.ts` äger konfidenströsklarna (**≥ 0,98 auto**, **0,80–0,98 förslag**, **< 0,80 människa**) och beslutstyperna `AUTO_EXECUTE / SUGGEST / REQUIRES_USER / BLOCKED`. Matchningsmotorn (`payment-matching.ts`) räknar konfidens; trösklarna mappas centralt. Två hårda regler oavsett konfidens: **överbetalningar bokförs aldrig automatiskt**, och **delvisa ROT/RUT-utbetalningar bokförs aldrig automatiskt** – båda kräver mänsklig bekräftelse eftersom de skapar följdbeslut (återbetala? restfakturera?). Varje automatisk bokning bär en klartextförklaring (`explanation` på verifikationen).
