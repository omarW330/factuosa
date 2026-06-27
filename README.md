# AGM · Revisión de facturas (React + Vite)

Web estática para revisar facturas (foto vs datos), sin base de datos: lee ficheros **JSON** de `public/data/`. El estado de revisión se guarda en el navegador (localStorage). Al terminar puedes **Copiar tabla** (pegar en Excel) o **Exportar .xlsx**.

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
