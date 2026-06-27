-- ============================================================
-- Esquema v2 (idempotente) — fuente de verdad en Supabase
-- Modelo "equipo": cualquier usuario autenticado ve/edita todo.
-- user_id se guarda solo para auditoría (quién subió / quién revisó).
-- Re-ejecutable sin errores. Supabase → SQL Editor → Run.
-- ============================================================

create table if not exists empresas (
  id text primary key,                 -- código corto, ej 'AGM'
  nombre text not null,
  creado timestamptz default now()
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid(),     -- quién lo creó (auditoría)
  empresa text,
  estado text not null default 'en_cola' check (estado in ('en_cola','procesando','listo','error')),
  n_facturas int default 0,
  creado timestamptz not null default now(),
  terminado timestamptz
);
create index if not exists jobs_creado_idx on jobs (creado desc);

alter table facturas add column if not exists job_id uuid references jobs(id) on delete cascade;
alter table facturas add column if not exists empresa text;
create index if not exists facturas_job_idx on facturas (job_id);

create table if not exists revisiones (
  factura_id uuid primary key references facturas(id) on delete cascade,
  user_id uuid default auth.uid(),     -- quién revisó por última vez (auditoría)
  status text check (status in ('ver','rev')),
  correcciones jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists status (
  id int primary key default 1 check (id = 1),
  last_run timestamptz,
  interval_min int default 15,
  avg_seg_por_lote int default 90,
  procesando boolean default false
);
insert into status (id) values (1) on conflict (id) do nothing;

insert into storage.buckets (id, name, public) values ('uploads','uploads', false)
  on conflict (id) do nothing;

-- Migrar facturas existentes (fase A) a un job inicial (solo si quedan sin job)
do $$
declare jid uuid;
begin
  if exists (select 1 from facturas where job_id is null) then
    insert into jobs (empresa, estado, n_facturas, terminado)
      values ('AGM','listo',(select count(*) from facturas where job_id is null), now())
      returning id into jid;
    update facturas set job_id = jid, empresa = coalesce(empresa,'AGM') where job_id is null;
  end if;
end $$;

-- ---- RLS (equipo: solo autenticados) ----
alter table empresas   enable row level security;
alter table jobs       enable row level security;
alter table revisiones enable row level security;
alter table status     enable row level security;

drop policy if exists "empresas auth"   on empresas;
drop policy if exists "jobs auth"        on jobs;
drop policy if exists "revisiones auth"  on revisiones;
drop policy if exists "status lectura"   on status;
create policy "empresas auth"   on empresas   for all    to authenticated using (true) with check (true);
create policy "jobs auth"       on jobs       for all    to authenticated using (true) with check (true);
create policy "revisiones auth" on revisiones for all    to authenticated using (true) with check (true);
create policy "status lectura"  on status     for select to authenticated using (true);

drop policy if exists "fact lectura"   on facturas;
drop policy if exists "fact insercion" on facturas;
drop policy if exists "fact update"    on facturas;
drop policy if exists "fact borrado"   on facturas;
drop policy if exists "fact auth"      on facturas;
create policy "fact auth" on facturas for all to authenticated using (true) with check (true);

drop policy if exists "lectura"        on review_state;
drop policy if exists "insercion"      on review_state;
drop policy if exists "actualizacion"  on review_state;
drop policy if exists "borrado"        on review_state;
drop policy if exists "rev auth"       on review_state;
drop policy if exists "rev_state auth" on review_state;
create policy "rev_state auth" on review_state for all to authenticated using (true) with check (true);

drop policy if exists "img lectura"   on storage.objects;
drop policy if exists "img insercion" on storage.objects;
drop policy if exists "img borrado"   on storage.objects;
drop policy if exists "img auth"      on storage.objects;
drop policy if exists "storage auth"  on storage.objects;
create policy "storage auth" on storage.objects for all to authenticated
  using (bucket_id in ('facturas','uploads')) with check (bucket_id in ('facturas','uploads'));

do $$ begin alter publication supabase_realtime add table jobs;   exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table status; exception when others then null; end $$;
