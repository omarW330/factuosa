-- ============================================================
-- G · Pinger integrado en Supabase (pg_cron + pg_net + Vault)
-- Dispara el relay (workflow_dispatch) cada 10 min, sin terceros.
-- Ejecutar en Supabase → SQL Editor.
--
-- Antes necesitas un PAT de GitHub (fine-grained, repo `factuosa`,
-- permiso Actions: Read and write). Ver docs/PINGER.md.
-- ============================================================

-- 1) Extensiones
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) Guarda el PAT en Vault (⚠ reemplaza el valor por tu token).
--    Si ya lo creaste antes, omite esta línea o bórralo primero:
--    delete from vault.secrets where name = 'github_pat_relay';
select vault.create_secret('github_pat_PEGA_AQUI_TU_TOKEN', 'github_pat_relay');

-- 3) Función que llama al workflow_dispatch del relay leyendo el PAT del Vault
create or replace function public.trigger_relay() returns void
language plpgsql security definer as $$
declare tok text;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'github_pat_relay';
  if tok is null then raise notice 'falta el secreto github_pat_relay'; return; end if;
  perform net.http_post(
    url := 'https://api.github.com/repos/omarW330/factuosa/actions/workflows/relay.yml/dispatches',
    body := '{"ref":"main"}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || tok,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'Content-Type', 'application/json',
      'User-Agent', 'factuosa-pinger'
    )
  );
end $$;

-- 4) Programa el cron cada 10 min (re-ejecutable: primero lo quita si existía)
do $$ begin perform cron.unschedule('relay-pinger'); exception when others then null; end $$;
select cron.schedule('relay-pinger', '*/10 * * * *', $$ select public.trigger_relay(); $$);

-- ---- Comprobaciones ----
-- Lanzar ahora a mano (debería aparecer una ejecución en GitHub → Actions → Relay):
--   select public.trigger_relay();
-- Ver el cron programado:
--   select jobid, schedule, jobname, active from cron.job where jobname = 'relay-pinger';
-- Ver las últimas respuestas HTTP (200/204 = OK):
--   select id, status_code, created from net._http_response order by created desc limit 5;
-- Quitar el pinger:
--   select cron.unschedule('relay-pinger');
