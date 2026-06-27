CLAUDE.md — Contexto del proyecto (AGM · Revisión de facturas)
Léeme antes de tocar nada. Resume qué es, cómo fluyen los datos, qué archivos importan y qué convenciones NO romper.
1. Qué es
Web estática (React + Vite) para revisar facturas a mano: foto a un lado, datos extraídos al otro. Sirve para validar lo que un proceso automático (lectura de tickets con IA) extrajo de cada factura, corregir lo que haga falta y exportar el resultado.

No hay base de datos. Los datos son ficheros JSON en public/data/. El estado de la revisión (verificado/pendiente/correcciones) se guarda en el navegador (localStorage).
2. Flujo end-to-end (el pipeline)
1. Llegan imágenes/PDF de facturas a Dropbox  (carpeta "/facturas AGM/entrada")

2. Un proceso (fuera de este repo) las lee con IA, genera por cada tanda:

      - <fecha>.json  (array de facturas con la foto embebida en base64)

      - index.json    (lista de tandas)

   y los deja en Dropbox  "/facturas AGM/web"

3. GitHub Action "sync-data.yml" (diaria) baja esos JSON a public/data/ y hace commit

4. El commit dispara "deploy.yml" → build de Vite → publica en GitHub Pages

5. El usuario abre la web (móvil incluido), revisa, y:

      - "Copiar tabla" (TSV → pegar en Excel)  o  "Exportar Excel" (.xlsx)

Este repo es del paso 3 al 5. Los pasos 1-2 viven en otro sitio (flujo de Claude/Cowork) y solo se comunican con nosotros dejando ficheros JSON en Dropbox.
3. Mapa del repo
public/data/index.json        Lista de tandas (lo lee la app al arrancar)

public/data/<fecha>.json      Una tanda = array de facturas (con foto base64)

src/main.jsx                  Entry. Detecta táctil (clase .touch) y monta <App/>

src/App.jsx                   TODA la lógica: lista, edición, modal zoom, modo

                              revisión (deslizar/zoom/paneo/reloj), export, popup

src/xlsx.js                   Generador de .xlsx REAL sin librerías (zip+crc32)

                              + tsvTable() para "copiar tabla"

src/styles.css               Estilos (claro + glass + modo revisión + responsive)

index.html, vite.config.js   Vite (base: './' para que funcione bajo /<repo>/)

.github/workflows/deploy.yml      build + deploy a GitHub Pages (on push)

.github/workflows/sync-data.yml   baja JSON de Dropbox y commitea (diario)

scripts/sync_dropbox.py           script que usa la Action (refresh token Dropbox)
4. Contrato de datos (NO romper sin actualizar el generador del paso 2)
public/data/index.json:

{ "tandas": [ { "fecha": "2026-06-25", "archivo": "2026-06-25.json", "n": 12 } ] }

public/data/<fecha>.json:

{ "fecha": "2026-06-25",

  "items": [

    { "id": "r1",

      "img": "data:image/jpeg;base64,...",   // foto embebida

      "rot0": 0,                              // rotación inicial (0/90/180/270)

      "fecha": "13/05/2026",                  // SIEMPRE DD/MM/AAAA

      "proveedor": "Mercadona S.A.",

      "num": "A-V2026-000...",

      "base": 9.67, "iva": 0.98, "total": 10.65,

      "timp": "IVA mixto 4/10/21%",           // texto informativo del impuesto

      "conf": "alta|media|baja",              // confianza de la extracción

      "flag": false,                          // true = caso a revisar (ámbar)

      "obs": "..." }

  ] }
5. Estado de revisión (localStorage)
Clave por tanda: agm_rev_<fecha>.
Valor: { [id]: { status?: 'ver'|'rev', base?, iva?, total?, fecha?, proveedor?, num?, obs?, rot? } }.
status: ver = verificada, rev = pendiente/a revisar.
Los campos editados sobrescriben a los del JSON (helper F(it,marks,k)).
6. Comandos
npm install

npm run dev      # desarrollo, http://localhost:5173

npm run build    # genera dist/ (lo hace la Action)
7. Despliegue
GitHub Pages con Source = "GitHub Actions" (Settings → Pages).
deploy.yml corre en cada push a main. URL: https://<usuario>.github.io/<repo>/.
sync-data.yml (cron diario) baja los JSON de Dropbox. Necesita secrets: DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN, DROPBOX_WEB_FOLDER.
8. Convenciones / cosas a respetar
Rutas relativas: vite.config.js usa base: './'. Los fetch de datos usan import.meta.env.BASE_URL (fetch(\${BASE}data/index.json`)). No pongas rutas absolutas con /`.
Fechas: internamente y en el JSON, DD/MM/AAAA. En la UI se usa <input type="date"> (ISO) y se convierte con isoFromDMY / dmyFromIso.
localStorage siempre entre try/catch (Safari lo bloquea al abrir archivos locales).
Export .xlsx: implementado a mano en src/xlsx.js (ZIP "store" + CRC32). Si tocas columnas/estilos, mantén índices de estilo (cellXfs) coherentes. NO metas dependencias nuevas solo para esto.
Imágenes: van como data URLs base64 dentro del JSON (la web es sandbox/Pages, no puede pedir imágenes externas).
Datos en runtime: la app hace fetch de public/data al cargar; por eso añadir un JSON nuevo NO requiere recompilar. Mantén esa propiedad.
9. Gotchas conocidos
Subir por la web de GitHub se salta carpetas con punto (.github). Usar git o crear los archivos a mano con la ruta.
GitHub Pages gratis exige repo público → los JSON (datos de facturas) quedan públicos. Para privado: Cloudflare Pages + Access.
Móvil: si abres el HTML como archivo local, muchos visores no ejecutan JS. Por eso se despliega como web.
10. Ideas / próximas mejoras (libres para abordar)
Multi-tanda real: selector e índice ya soportados; pulir UX si hay muchas.
"Memoria de proveedores": autocompletar/validar por proveedor recurrente.
Persistir la revisión en algo compartido (hoy es local del navegador).
Filtros por proveedor/importe; buscador.
Mejor accesibilidad y teclado en la lista (hoy el teclado es del modo revisión).
Tests de xlsx.js (abrir el .xlsx generado y validar con una librería en CI).

