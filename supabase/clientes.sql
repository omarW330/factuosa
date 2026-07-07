-- ============================================================
-- Clientes: la app pasa a soportar dos tipos de lote.
--   proveedores (por defecto) · clientes (facturas emitidas)
-- Ejecutar una vez en Supabase → SQL Editor. Idempotente.
-- ============================================================

-- Tipo de lote
alter table public.jobs
  add column if not exists tipo text not null default 'proveedores'
    check (tipo in ('proveedores','clientes'));

-- Campos extra que solo usan los lotes de clientes
alter table public.facturas add column if not exists codigo text;      -- código de cliente (ej. 43000008)
alter table public.facturas add column if not exists iva_pct numeric;  -- % de IVA (ej. 21)
