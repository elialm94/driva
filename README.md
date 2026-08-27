# Driva

**AI-native business-in-a-box för svenska småföretag.** Du gör jobbet – Driva sköter administrationen: offerter med BankID-godkännande, jobb, fakturor, betalningsmatchning, kvitton och automatisk bokföring.

## Kom igång

```bash
npm install
npm run dev
```

Öppna [http://localhost:3000](http://localhost:3000). Appen seedas automatiskt med demodata för **Södermalms Snickeri AB** (fil-baserad databas i `.data/db.json`). Klicka på företagsnamnet nere i vänstermenyn för att återställa demon.

## Kärnflödet

**Förfrågan → Offert → BankID-godkännande → Jobb → Faktura → Betalning → Bokföring**

- Offert- och faktura­utskick har alltid en preview: *"Så här ser kunden offerten"* (desktop/mobil/PDF).
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
| AI-assistent | `src/lib/services/assistant.ts` | Regelbaserad intent-tolkning i demon; utför riktiga åtgärder med bekräftelsekort |
| Lagring | `src/lib/store.ts` | JSON-fil (`.data/db.json`) – byts mot riktig databas i produktion |

## Verifiering

`scripts/verify.mjs` och `scripts/verify2.mjs` klickar igenom alla flöden i headless Chrome (kräver `puppeteer-core` + lokal Chrome) och sparar skärmdumpar i `.shots/`.
