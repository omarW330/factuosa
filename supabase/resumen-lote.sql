-- ============================================================
-- Resumen del lote: texto que deja Cowork al procesar (o el
-- resumen automático del relay como reserva).
-- Ejecutar una vez en Supabase → SQL Editor. Idempotente.
-- ============================================================
alter table public.jobs
  add column if not exists resumen text;
