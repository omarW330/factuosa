# Factuosa · Revisión de facturas (React + Vite + Tailwind + Supabase)

App para revisar facturas (foto vs datos extraídos por IA), corregir y exportar a Excel.
Fuente de verdad: **Supabase** (datos, imágenes, estado de revisión y lotes). La extracción
con IA la hace **Cowork**, que solo habla por **Dropbox**; dos *relays* (GitHub Actions)
conectan Supabase ↔ Dropbox. Documento de arquitectura: **[docs/ESTADO-v2.md](docs/ESTADO-v2.md)**.

## Flujo
```
Usuario sube facturas → Storage 'uploads' + crea JOB (en_cola)
  → relay ↑ copia a Dropbox /facturas AGM/entrada/<EMP>/<JOB_ID>/  (job: procesando)
  → Cowork extrae con IA → /facturas AGM/web/<JOB_ID>.json + status.json
  → relay ↓ vuelca a Supabase (facturas + imágenes) y pone el JOB en 'listo'
  → la app avisa por Realtime → revisas (foto vs datos) → exportas Excel
```

## Funcionalidad
- **Login** usuario+contraseña (Supabase Auth), recuerda usuarios, modo claro/oscuro.
- **Panel** de lotes con KPIs, progreso, latido de Cowork (próxima/última ejecución) y Realtime.
- **Subida** de lotes (imágenes/PDF) por empresa.
- **Revisión** foto vs datos: modo *Tinder* (deslizar) o por botones, zoom (rueda / 2 dedos),
  edición en línea, precarga de fotos. Estado en la tabla `revisiones` (multi-dispositivo).
- **Estadísticas** (base/IVA/total, por mes, top proveedores) y **export** a Excel / copiar tabla.

## Desarrollo
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # genera dist/
```
Variables en `.env` (ver `.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
Sin claves, la app no arranca el login (modo Supabase obligatorio).

## Supabase
Esquema en **[supabase/schema-v2.sql](supabase/schema-v2.sql)** (tablas `empresas`, `jobs`,
`facturas`, `revisiones`, `status`; buckets `uploads` y `facturas`; RLS de equipo: solo
usuarios autenticados). Los usuarios se crean en Authentication → Users (con *Auto Confirm*);
el registro público va desactivado.

## Relays (GitHub Actions) — `scripts/relay.py` + `.github/workflows/relay.yml`
Cron cada ~10 min + ejecución manual. Redimensiona las fotos al volcarlas (Pillow).
Secrets necesarios: `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN`,
`VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Despliegue (GitHub Pages)
`.github/workflows/deploy.yml` publica en cada push a `main`. Añade los secrets
`VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (los inyecta el build).
URL: `https://<usuario>.github.io/<repo>/`.
