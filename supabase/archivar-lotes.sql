-- ============================================================
-- Archivar lotes: columna booleana en jobs.
-- Ejecutar una vez en Supabase → SQL Editor.
-- Idempotente (if not exists). El relay NO toca esta columna,
-- así que archivar/desarchivar es seguro frente a reprocesos.
-- ============================================================
alter table public.jobs
  add column if not exists archivado boolean not null default false;
