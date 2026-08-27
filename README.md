# Driva

**AI-native business-in-a-box för svenska småföretag.** Du gör jobbet – Driva sköter administrationen: offerter med BankID-godkännande, jobb, fakturor, betalningsmatchning, kvitton och automatisk bokföring.

## Kom igång

```bash
npm install
npm run dev
```

Öppna [http://localhost:3123](http://localhost:3123). `npm run dev` kör `scripts/dev-3123.sh`: den binder **endast 3123**, startar inte en andra server om GET `/` redan är 200, och startar om Next inom en sekund om processen dör. Agents: kill:a inte next på 3123 om porten redan svarar HTTP 200.

Appen seedas automatiskt med demodata för **Södermalms Snickeri AB** (fil-baserad databas i `.data/db.json`). Klicka på företagsnamnet nere i vänstermenyn för att återställa demon.

### Google Maps-adresssökning (valfritt)

Adressfältet i "Ny kund" använder Google Places-autocomplete och fyller i postnummer och ort automatiskt. Lägg en nyckel med **Places API (New)** aktiverat i `.env.local`:

```bash
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=din-nyckel
```

Utan nyckel används svenska exempeladresser, tydligt märkta "Demo" i förslagslistan.

### AI-assistent (valfritt)

Hemsidans kommandorad och `/assistent` delar samma tråd (`assistantMessages`) och samma tjänstelager. Med API-nyckel används LLM med tool calling; **utan nyckel faller assistenten tillbaka på regelbaserade intents** – vi låtsas inte att en modell svarar (samma ärlighet som BankID-mock).

Lägg i `.env.local`:

```bash
AI_PROVIDER=openai-compatible
AI_MODEL=gpt-4.1-mini
AI_API_KEY=sk-...
AI_BASE_URL=https://api.openai.com/v1
```

| Variabel | Standard | Anteckning |
| --- | --- | --- |
| `AI_PROVIDER` | `openai-compatible` | Sätt `none` för att tvinga regel-fallback även med nyckel |
| `AI_MODEL` | `gpt-4.1-mini` | Billig OpenAI-kompatibel modell. På OpenRouter: `openai/gpt-4.1-mini` |
| `AI_API_KEY` | (tom) | Saknas den → regelbaserad demo |
| `AI_BASE_URL` | `https://api.openai.com/v1` | OpenRouter: `https://openrouter.ai/api/v1` |

Verifiera assistentens tjänstelager (utan att skriva till `.data/db.json`):

```bash
npm run test:assistant
```

## Kärnflödet

**Förfrågan → Offert → BankID-godkännande → Jobb → Faktura → Betalning → Bokföring**

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
| BankID | `src/lib/services/bankid.ts` | `BankIDProvider`-interface; demon kör `MockBankIDProvider` (tydligt markerat i UI). Byt till riktig RP-API-integration här |
| Open Banking | `src/lib/services/banking.ts` | `BankProvider`-abstraktion förberedd för t.ex. Tink; matchningsmotorn är riktig |
| Bokföring | `src/lib/bas.ts` | BAS-konton, momssatser, konteringsregler, verifikationer |
| AI-assistent | `src/lib/services/assistant.ts`, `src/lib/ai/` | LLM med tool calling mot samma tjänster som UI:t; regelbaserad fallback utan `AI_API_KEY` |
| Domän | `src/lib/domains/` | `.se`-köp via registrar-abstraktion (Openprovider + mock). Hosting mot Vercel-projektet **driva** (`driva-alpha.vercel.app`), inte noxfort |
| Lagring | `src/lib/store.ts` | JSON-fil (`.data/db.json`) – byts mot riktig databas i produktion |

### Egen .se-adress

Hemsida → Domän: sök, köp, koppla. Standard är **mock** (ingen riktig .se köps). Se `.env.example` för Openprovider-sandbox och `VERCEL_PROJECT_NAME=driva`.

## Verifiering

`scripts/verify.mjs` och `scripts/verify2.mjs` klickar igenom alla flöden i headless Chrome (kräver `puppeteer-core` + lokal Chrome) och sparar skärmdumpar i `.shots/`.

Fakturaenhetstester:

```bash
npm test
```

## Fakturering V1 – omfattning och begränsningar

Driva utfärdar **vanliga svenska småföretagsfakturor**: svensk säljare → svensk kund, valuta **SEK**, momssatser **0 / 6 / 12 / 25 %**. UI, assistent och bokföring går genom samma tjänster (`issueInvoice` / `sendInvoice` i `src/lib/services/invoices.ts`) och samma momsräkning (`docTotals` / `vatBreakdown` i `src/lib/calc.ts`).

**Stöds inte i V1** (inget val i UI, ingen påhittad logik):

- Omvänd skattskyldighet, EU-försäljning, export, byggmoms, vinstmarginalbeskattning
- Andra valutor än SEK
- Delkredit, kredit av redan betald faktura, Peppol/e-faktura
- Verifiering mot Skatteverket, Bolagsverket eller Bankgirot (endast formatkontroll)
- Sparad PDF-blob – den utfärdade `issuedSnapshot` + `InvoiceDocument` är den juridiska kopian (utskrift via `/faktura/[token]/pdf`)

**Nummer:** nya utkast får `number: null` och visas som ”Utkast”. Löpnummer och OCR tilldelas först i `issueInvoice` på servern. Äldre utkast som redan har nummer behåller det. Misslyckad e-post (i demon: mock-logg) rullar inte tillbaka numret; **Skicka igen** återanvänder samma nummer.

**Rabatt:** inget eget radfält. Negativt à-pris på en rad räknas i samma VAT-motor.
