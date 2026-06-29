# G · Pinger externo — disparar el relay de forma puntual

El `schedule` de GitHub Actions en plan gratis se retrasa mucho (un `*/10` real acaba siendo
cada varias horas) y se desactiva tras 60 días sin commits. Para una cadencia fiable, un
servicio externo llama cada ~10–15 min al **`workflow_dispatch`** del relay.

> El relay es **idempotente** y el workflow tiene `concurrency` (no corre dos veces a la vez),
> así que pinger + cron interno conviven sin problema.

---

## 1. Crear un token de GitHub (PAT) con permiso de Actions

GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens →
Generate new token**:
- **Resource owner:** tu cuenta (omarW330)
- **Repository access:** *Only select repositories* → `factuosa`
- **Permissions → Repository permissions:**
  - **Actions:** *Read and write*  ← imprescindible (para lanzar el workflow)
  - **Metadata:** *Read-only* (se marca solo)
- Expiración: la que quieras (renuévalo cuando caduque).
- Copia el token (`github_pat_…`).

## 2. Crear el cron en cron-job.org (gratis)

https://cron-job.org → *Create cronjob*:

| Campo | Valor |
|---|---|
| **Title** | Factuosa relay |
| **URL** | `https://api.github.com/repos/omarW330/factuosa/actions/workflows/relay.yml/dispatches` |
| **Schedule** | cada 10 o 15 min (*Every 10 minutes*) |
| **Request method** | `POST` |
| **Request body** | `{"ref":"main"}` |

**Headers** (sección *Advanced* → *Headers*):
```
Authorization: Bearer github_pat_TU_TOKEN
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json
```

Opcional (recomendado): en *Advanced* marca que el job es correcto si el código de respuesta
es **204** (es lo que devuelve un dispatch OK). Activa notificación por email si falla.

## 3. Comprobar

Tras guardar, pulsa *Run now* en cron-job.org. En GitHub → **Actions → Relay** debe aparecer
una ejecución nueva con *Event: workflow_dispatch*. Si responde 204, está bien.

---

## Alternativa (sin terceros): pg_cron + pg_net en Supabase

Si prefieres no usar cron-job.org, Supabase puede llamar al dispatch desde la propia base de
datos con las extensiones `pg_cron` + `pg_net`, guardando el PAT en *Vault*. Es más robusto
(corre en la BD) pero requiere habilitar extensiones y un poco de SQL. Pídelo y te paso el SQL.

---

## Notas
- El pinger NO arregla la dependencia de Cowork: la extracción IA solo corre con la app de
  escritorio de Cowork abierta (o "Run now"). El pinger solo garantiza que el **relay**
  (subir/volcar) corra puntual.
- Si rotas/revocas el PAT, actualiza el header en cron-job.org.
