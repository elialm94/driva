# Runbook: backup, PITR och restore drill

Ferva lagrar bokföringsmaterial som enligt bokföringslagen ska bevaras i sju
år. Backup är därför inte en teknisk detalj utan ett lagkrav. Ingen kod kan
läsa om Supabase-backup/PITR är påslaget – det verifieras av en människa i
dashboarden och dokumenteras i `/admin/system` genom en **registrerad restore
drill**. Tills dess visar systemvyn *Ej verifierat*.

## 1. Aktivera och verifiera backup i Supabase

1. Supabase Dashboard → projektet → **Settings → Add-ons** (eller **Database →
   Backups**): kontrollera plan. Dagliga backuper kräver Pro; **Point in Time
   Recovery (PITR)** är ett tillägg (aktivera, välj retention, t.ex. 7 dagar).
   PITR kräver att projektet kör på en compute-storlek som stöder det
   (minst *Small*). Följ dashboardens anvisningar – texterna där är
   auktoritativa.
2. Database → Backups → **Point in time**: bekräfta att *Earliest restore
   point* fylls på (tar upp till en timme efter aktivering).
3. Anteckna datum i restore-drill-formuläret (*PITR bekräftat påslaget*).

Mål (utgångsvärden, justera efter drill): **RPO ≤ 2 min** (PITR/WAL),
**RTO ≤ 60 min** (återläsning till nytt projekt + byte av `SUPABASE_DB_URL`).

## 2. Restore drill (staging) – aldrig mot produktion

Gör minst **var 6:e månad** (systemvyn markerar drillen som förfallen efter
180 dagar eller om den underkändes).

1. Skapa/återanvänd ett **staging-projekt** i Supabase. Anteckna dess
   projektref (`<staging-ref>`).
2. Återläs produktionens backup/PITR-punkt till staging:
   - Dashboard: Database → Backups → *Restore* / *Point in time* går till
     **samma** projekt – för drill används i stället:
   - `supabase db dump --linked -f dump.sql` mot **produktion** (endast
     läsning; kräver att CLI är länkad till prod och att du kör från en betrodd
     maskin), därefter `psql "<staging-db-url>" -f dump.sql` mot staging.
     Alternativt Supabase *Clone*/*Branching* när det är tillgängligt för
     planen. Radera dumpfilen efter drillen (`shred -u dump.sql`).
3. Kör verifieringen mot staging (read-only-transaktion, vägrar prod):

   ```bash
   RESTORE_DRILL_DB_URL='postgres://postgres:<pw>@db.<staging-ref>.supabase.co:5432/postgres' \
   PRODUCTION_SUPABASE_PROJECT_REF='<prod-ref>' \
   npm run restore:drill -- --target staging --staging-ref <staging-ref>
   ```

   Kontrollerar: kärnschema + senaste migration
   (`EXPECTED_MIGRATION_VERSION`), immutabilitetstriggrar
   (`verifications_immutable`, `accounting_entries_immutable`,
   `audit_log_immutable`, …), tenantantal, ledger-checksumma och debet = kredit
   per företag. Exit 0 = godkänd, 2 = underkänd, 1 = vägrade/fel.
4. Jämför checksumma och antal med produktionen genom att köra samma
   **read-only** SQL i produktionens SQL-editor (ingen skrivning):

   ```sql
   select count(*) as tenants from public.businesses;
   select business_id::text, count(*) as n, sum(debit) as debit, sum(credit) as credit,
          md5(string_agg(verification_id || ':' || position || ':' || account || ':' || debit || ':' || credit,
                         ',' order by verification_id, position)) as digest
     from public.accounting_entries group by business_id order by business_id;
   ```

   Scriptets `checksum` är `sha256` över raderna
   `business_id|n|debit|credit|digest\n` (första 32 hex). Avvikelse är väntad
   om produktionen fått nya verifikationer efter återläsningspunkten – jämför
   då per företag fram till punkten.
5. Mät **RTO**: tid från beslut till att staging svarar med verifierat schema.
   Mät **RPO**: skillnad mellan återläsningspunkt och senaste verifikation i
   prod.
6. Registrera: `/admin/system` → *Backup & återställning* → **Registrera
   genomförd restore drill** (super_admin): datum, staging-ref, ansvarig,
   resultat, RPO/RTO, PITR-datum, klistra in RESULT-JSON. Audit
   `restore_drill_recorded`.
7. Städa staging: rotera staging-lösenordet eller pausa projektet – kopian
   innehåller riktiga kunddata och omfattas av samma skydd.

## 3. Riktig återläsning (incident)

1. Besluta återläsningspunkt (så nära felet som möjligt).
2. Supabase → Database → Backups → **Point in time** → välj tidpunkt →
   *Restore*. Projektet blir otillgängligt under återläsningen.
3. Efteråt: `GET /api/health` (schema, migrationer), `/admin/system`
   (migrationer = kod), kör `npm run restore:drill` mot en staging-kopia om
   tid finns, eller åtminstone SQL-kontrollerna ovan i prod (read-only).
4. Stripe-webhooks som skickats under nertiden retriar automatiskt; kör
   **Resend** i Stripe för händelser äldre än 3 dagar.
5. Informera berörda kunder om eventuellt förlorat arbete (RPO) via
   supportärenden. Dokumentera i post-mortem.
