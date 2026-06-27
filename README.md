# AGM · Revisión de facturas (React + Vite + Tailwind)

Web estática para revisar facturas (foto vs datos), sin base de datos: lee ficheros **JSON** de `public/data/`. El estado de revisión se guarda en el navegador (localStorage). Al terminar puedes **Copiar tabla** (pegar en Excel) o **Exportar .xlsx**.

UI rediseñada con **Tailwind v4**, mobile-first:
- **Panel general** (pantalla inicial): KPIs globales (verificadas / a revisar / pendientes), progreso y una tarjeta por tanda con su estado, % y última revisión.
- **Lista** por tanda: filtros, buscador, edición en línea y modal de zoom.
- **Modo revisión tipo Tinder**: imagen a pantalla completa, **desliza ▶ verificar / ◀ a revisar**, zoom/giro/encajar, panel de datos (lateral en escritorio, *bottom sheet* en móvil), teclado (V / P / ◀ / ▶ / +/−) y resumen final.
- **Eliminar datos**: borra una tanda para que el repo no acumule JSON/imágenes antiguas. Desde la web borra el `.json` de verdad en `npm run dev`; en producción solo la oculta en ese navegador. Para limpiar el repo a lo grande, usa el script `npm run clean` (ver abajo).

## Estructura de datos (los "ficheros = BD")
```
public/data/index.json        -> lista de tandas
public/data/2026-06-25.json   -> una tanda (array de facturas con foto embebida)
```
`index.json`:
```json
{ "tandas": [ { "fecha": "2026-06-25", "archivo": "2026-06-25.json", "n": 12 } ] }
```
Cada tanda:
```json
{ "fecha": "2026-06-25", "items": [
  { "id":"r1", "img":"data:image/jpeg;base64,...", "rot0":0,
    "fecha":"13/05/2026", "proveedor":"Mercadona", "num":"A-V...",
    "base":9.67, "iva":0.98, "total":10.65, "timp":"IVA mixto",
    "conf":"alta", "flag":false, "obs":"..." } ] }
```
> **Añadir una tanda nueva = añadir su `.json` a `public/data/` y referenciarla en `index.json`.** No hace falta recompilar nada (la app los lee en tiempo de ejecución).

## Desarrollo
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # genera dist/
```

## Limpiar datos antiguos (que el repo no crezca)
```bash
npm run data                              # lista tandas y su tamaño
node scripts/clean-data.js --keep 3       # conserva solo las 3 más recientes
node scripts/clean-data.js --before 2026-06-01   # borra anteriores a esa fecha
node scripts/clean-data.js --file 2026-06-25.json # borra una concreta
node scripts/clean-data.js --all          # borra todas
# añade --dry para simular sin borrar
```
Borra los `.json` de `public/data/` y actualiza `index.json`. Luego haz commit para que el repo deje de cargar esas imágenes.

## Sincronizar la revisión entre dispositivos (Supabase)
El estado de revisión se guarda en el navegador y, si configuras Supabase, **también en la nube**, para retomar la revisión desde otro móvil/PC. Sin claves, la app funciona igual pero solo en local (indicador "Solo local").

1. Crea un proyecto gratis en https://supabase.com
2. En **SQL Editor** ejecuta:
   ```sql
   create table if not exists review_state (
     tanda text primary key,
     marks jsonb not null default '{}'::jsonb,
     updated_at timestamptz not null default now()
   );
   alter table review_state enable row level security;
   create policy "lectura"       on review_state for select using (true);
   create policy "insercion"     on review_state for insert with check (true);
   create policy "actualizacion" on review_state for update using (true) with check (true);
   create policy "borrado"       on review_state for delete using (true);
   ```
3. En **Project Settings → API** copia la *Project URL* y la clave *anon public*.
4. **En local**: copia `.env.example` a `.env` y rellena `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
5. **En GitHub Pages**: repo → Settings → Secrets and variables → Actions → añade `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (los inyecta `deploy.yml` al hacer build).

> La clave `anon` es pública (va en el build). Con repo/JSON públicos el nivel de privacidad es el mismo que ya tenías; para privacidad real usa hosting privado o login.

## Despliegue (GitHub Pages, automático)
1. Sube este repo a GitHub.
2. Settings → **Pages** → Source: **GitHub Actions**.
3. Cada push a `main` ejecuta `.github/workflows/deploy.yml` y publica en `https://<usuario>.github.io/<repo>/`.

## Datos automáticos desde Dropbox (opcional, recomendado)
El workflow `.github/workflows/sync-data.yml` baja cada día los `.json` de una carpeta de Dropbox a `public/data/` y hace commit (que dispara el deploy).

Pasos:
1. Crea una app en https://www.dropbox.com/developers/apps (Scoped, `files.content.read`).
2. Genera un **refresh token** (OAuth) de esa app.
3. En el repo → Settings → Secrets and variables → Actions, añade:
   - `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN`
   - `DROPBOX_WEB_FOLDER` (ej.: `/facturas AGM/web`)

## Contrato con el flujo de Claude
El proceso diario que lee los tickets debe dejar en `DROPBOX_WEB_FOLDER`:
- `index.json` actualizado
- un `<fecha>.json` por tanda (con las fotos embebidas en base64)

La Action los sincroniza y la web se actualiza sola.
