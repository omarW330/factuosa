# Factuosa · Estado de la arquitectura v2 (handoff)

Documento para coordinar el **lado app (React/Supabase, este repo)** con el **lado cerebro (Cowork)**.
Sirve para confirmar que ambos lados hablan el mismo idioma (carpetas, nombres, contrato de datos).

Repo: `github.com/omarW330/factuosa` · Supabase: `https://pefyekqsyxxrinaemhkl.supabase.co`

---

## 1. Resumen del flujo (objetivo v2)

```
1. Usuario entra a la app (login Supabase) y pulsa "Subir facturas" (elige empresa + ficheros).
2. App  → sube los ficheros a Supabase Storage 'uploads' y crea un JOB (estado: en_cola).
3. RELAY ↑ (GitHub Action) → copia esos ficheros a Dropbox /facturas AGM/entrada/<EMP>/<JOB_ID>/
           y marca el JOB como 'procesando'.
4. COWORK (cada ~15 min / "Run now") → lee la entrada, extrae con IA, y escribe en Dropbox:
           /facturas AGM/web/<JOB_ID>.json   y   /facturas AGM/web/status.json
5. RELAY ↓ (GitHub Action) → vuelca <JOB_ID>.json a Supabase (tabla 'facturas' + imágenes a
           Storage 'facturas'), marca el JOB 'listo' y actualiza el latido 'status'.
6. App  → Realtime avisa → el usuario revisa (foto vs datos) → exporta Excel.
```

Estados de un JOB: `en_cola → procesando → listo` (o `error`).

---

## 2. Lo que YA está implementado (lado app, este repo)

- **Login** usuario+contraseña (Supabase Auth). El "usuario" se mapea a `usuario@factuosa.com`.
  Usuarios se crean en el panel de Supabase con *Auto Confirm*; registro público desactivado.
- **Panel** que lista los **jobs** (empresa, estado, nº facturas, progreso) + KPIs globales.
- **Subida de lote**: modal con selector de empresa → Storage `uploads` + crea el job (`en_cola`).
- **Barra de estado / latido**: "próxima ejecución en ~X min", "última hace Y", aviso si parece pausada.
- **Revisión** (foto vs datos, modo tipo Tinder, edición, zoom/giro) leyendo de `facturas` y
  guardando marcas/correcciones en la tabla `revisiones` (multi-dispositivo).
- **Estadísticas** (base/IVA/total acumulados, por mes, top proveedores).
- **Realtime** sobre `jobs` y `status`.
- **Relay** (GitHub Action) que conecta Supabase ↔ Dropbox en ambos sentidos.
- Export **Excel** propio (`src/xlsx.js`) + "Copiar tabla".

Pendiente operativo: añadir el secret `SUPABASE_SERVICE_ROLE_KEY` y que **Cowork** respete la
convención del punto 5.

---

## 3. Modelo de datos en Supabase

RLS = **equipo**: cualquier usuario autenticado ve/edita todo (`user_id` solo para auditoría).
SQL completo en `supabase/schema-v2.sql`.

| Tabla | Campos clave |
|---|---|
| `empresas` | `id` (código, ej. AGM), `nombre`. Valores: **AGM, SISGEAN, GEOTECNIA, ARGADRIL** |
| `jobs` | `id` (uuid), `user_id`, `empresa`, `estado` (en_cola/procesando/listo/error), `n_facturas`, `creado`, `terminado` |
| `facturas` | `id` (uuid), `job_id`, `empresa`, `item_id`, `img_path`, `rot0`, `fecha`, `proveedor`, `num`, `base`, `iva`, `total`, `timp`, `conf`, `flag`, `obs` |
| `revisiones` | `factura_id` (pk), `user_id`, `status` (ver/rev), `correcciones` (jsonb), `updated_at` |
| `status` | fila única id=1: `last_run`, `interval_min`, `avg_seg_por_lote`, `procesando` |

Storage buckets (privados): **`uploads`** (entrada del usuario) y **`facturas`** (imágenes a mostrar).

---

## 4. El relay (GitHub Action) — `scripts/relay.py` + `.github/workflows/relay.yml`

Cron cada ~10 min + "Run workflow" manual. Dos sentidos:

- **↑ subida**: jobs `en_cola` → copia ficheros de Storage `uploads/<EMP>/<JOB_ID>/`
  a Dropbox `/facturas AGM/entrada/<EMP>/<JOB_ID>/` → job `procesando`.
- **↓ resultado**: lee Dropbox `/facturas AGM/web/<JOB_ID>.json` → sube imágenes a Storage
  `facturas`, inserta filas en `facturas`, job `listo`, mueve el `.json` a `/web/procesados/`.
  Lee `/web/status.json` y lo vuelca a la tabla `status`.

---

## 5. ⚠️ CONTRATO DEL PUENTE DROPBOX (esto es lo que Cowork debe respetar)

Carpetas (transparentes para el usuario):

```
Entrada (la deja el relay, la lee Cowork):
  /facturas AGM/entrada/<EMPRESA>/<JOB_ID>/<ficheros imagen o PDF>

Salida (la escribe Cowork, la lee el relay):
  /facturas AGM/web/<JOB_ID>.json        ← MISMO <JOB_ID> que la carpeta de entrada
  /facturas AGM/web/status.json          ← latido en cada ejecución
```

- `<EMPRESA>` = uno de: `AGM`, `SISGEAN`, `GEOTECNIA`, `ARGADRIL`.
- `<JOB_ID>` = el uuid de la carpeta de entrada. **Cowork debe conservarlo** al nombrar su salida.
- El relay, tras procesar, mueve `<JOB_ID>.json` a `/web/procesados/` (para no reprocesar).

### `<JOB_ID>.json` — contrato de cada factura (no cambia respecto a v1)

```json
{
  "items": [
    {
      "id": "r1",
      "img": "data:image/jpeg;base64,...",   // foto embebida (base64)
      "rot0": 0,                               // rotación inicial 0/90/180/270
      "fecha": "13/05/2026",                   // SIEMPRE DD/MM/AAAA
      "proveedor": "Mercadona S.A.",
      "num": "A-V2026-000...",
      "base": 9.67, "iva": 0.98, "total": 10.65,
      "timp": "IVA mixto 4/10/21%",
      "conf": "alta",                          // alta | media | baja
      "flag": false,                           // true = caso a revisar
      "obs": "..."
    }
  ]
}
```

### `status.json` — latido

```json
{ "lastRun": "2026-06-27T16:00:00Z", "intervalMin": 15, "avgSegPorLote": 90, "procesando": false }
```

---

## 6. Secrets (GitHub → Settings → Secrets and variables → Actions)

| Secret | Uso | Estado |
|---|---|---|
| `DROPBOX_APP_KEY` | relay (Dropbox) | ✅ |
| `DROPBOX_APP_SECRET` | relay (Dropbox) | ✅ |
| `DROPBOX_REFRESH_TOKEN` | relay (Dropbox) | ✅ |
| `VITE_SUPABASE_URL` | build Pages + relay | ✅ |
| `VITE_SUPABASE_ANON_KEY` | build Pages (login web) | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | relay (escribir en Supabase) | ⬜ **falta** |

> La app de Dropbox necesita el scope **`files.content.write`** (además de read), porque el relay ↑ escribe.

---

## 7. Checklist para confirmar que todo está OK

**Lado app / infra (este repo):**
- [x] Esquema v2 aplicado en Supabase (tablas + RLS + buckets)
- [x] Empresas insertadas (AGM, SISGEAN, GEOTECNIA, ARGADRIL)
- [x] Login funciona (usuario `omar`)
- [x] Subir lote crea job `en_cola` y sube a Storage `uploads`
- [x] Revisión guarda en `revisiones`; estadísticas OK
- [ ] `SUPABASE_SERVICE_ROLE_KEY` añadido en GitHub
- [ ] Deploy a Pages relanzado con los secrets `VITE_SUPABASE_*` (web online con login)
- [ ] Workflow "Relay" ejecutado manualmente: el ↑ deja ficheros en `/entrada/<EMP>/<JOB_ID>/`

**Lado cerebro (Cowork) — a confirmar:**
- [ ] La tarea lee de `/facturas AGM/entrada/<EMPRESA>/<JOB_ID>/`
- [ ] Escribe el resultado en `/facturas AGM/web/<JOB_ID>.json` **conservando el `<JOB_ID>`**
- [ ] Respeta el contrato de cada factura (fechas DD/MM/AAAA, conf alta|media|baja, img base64…)
- [ ] Escribe/actualiza `/facturas AGM/web/status.json` en cada ejecución
- [ ] No borra la carpeta de entrada (el relay no la necesita, pero conviene dejar limpieza a un lado)

---

## 8. Cómo probar el ↑ ahora mismo

1. Añadir `SUPABASE_SERVICE_ROLE_KEY` en GitHub.
2. App → "Subir facturas" (un par de imágenes) → queda `en_cola`.
3. GitHub → Actions → "Relay Supabase ↔ Dropbox" → **Run workflow**.
4. Revisar el log (`[↑] 1 job(s) en_cola … job=procesando`) y comprobar que en Dropbox
   aparece `/facturas AGM/entrada/<EMP>/<JOB_ID>/` con los ficheros.
5. Cuando Cowork deje el `<JOB_ID>.json` en `/web`, el siguiente relay lo volcará y el job
   pasará a `listo` (la app se actualiza por Realtime).

---

## Actualización (PDFs A4 + imágenes fiables)

**A. Imágenes/JSON por código (lado Cowork/SKILL).** El modelo solo extrae datos; un paso
en Python hace la imagen (`pdftoppm` ~200 dpi / HEIC con `pillow_heif`, reorientar, ~1200–1500 px
ancho JPEG q80, `base64`/escritura por código, `json.dump`). Un LLM no puede teclear base64
grande de forma fiable (salían miniaturas de ~1 KB y truncadas).

**B. Imagen como FICHERO, no base64 (recomendado).** En `web/<JOB_ID>.json`, cada item lleva
`"img"` = ruta relativa, y el JPEG real va aparte:
```
web/<JOB_ID>.json     → item.img = "img/<JOB_ID>/<id>.jpg"   (no base64)
web/img/<JOB_ID>/<id>.jpg   → el JPEG (~1200–1500 px, q80)
```
El relay ↓ ya soporta los dos: si `img` es `data:image/...;base64,` decodifica (compat); si es
ruta, descarga `web/<img>` y la sube a Storage. Si una imagen falla, esa factura queda sin foto
pero el lote entra completo. Al terminar, el relay borra `web/img/<JOB_ID>/`.

**C.** Relay ↑: si no copia TODOS los ficheros a Dropbox, deja el job en `en_cola` (no lo marca
`procesando`) para reintentar. **D.** Estados exactos `en_cola|procesando|listo|error` (CHECK en
Postgres). **E.** Empresa unificada: **ARGADRIL** (la app ya lo usa; alinear Dropbox y SKILL).
**F.** El contador ya no promete "próxima en X min" (el cron de GitHub no es puntual): muestra
"última ejecución hace Y · se ejecuta de forma periódica" + aviso "puede estar pausada".
