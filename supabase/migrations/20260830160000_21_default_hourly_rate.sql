-- ============================================================================
-- 21 · Standard timpris (valfritt) för ny arbetstid på offerter och fakturor
-- ----------------------------------------------------------------------------
--   * default_hourly_rate: hela kronor. NULL = inte satt (fältet lämnas tomt
--     när användaren lägger till arbete). Sätts under Inställningar → Standardval.
-- ============================================================================

alter table public.business_settings
  add column if not exists default_hourly_rate integer
    check (default_hourly_rate is null or default_hourly_rate >= 1);
