#!/usr/bin/env python3
"""
Relay entre Supabase y Dropbox (Cowork solo habla con Dropbox).

  ↑ subida:    jobs 'en_cola' → copia los ficheros de Storage 'uploads' a
               Dropbox /facturas AGM/entrada/<EMPRESA>/<JOB_ID>/ y marca el job
               como 'procesando'.
  ↓ resultado: lee Dropbox /facturas AGM/web/<JOB_ID>.json (contrato de la IA),
               sube imágenes a Storage 'facturas', inserta filas en 'facturas',
               marca el job 'listo' y mueve el .json a /web/procesados/.
               También vuelca /web/status.json a la tabla 'status' (latido).

Sin librerías externas (urllib). Se ejecuta en GitHub Actions.

Variables de entorno:
  DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN
  SUPABASE_URL (o VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
  DROPBOX_ENTRADA (def. '/facturas AGM/entrada'), DROPBOX_WEB (def. '/facturas AGM/web')
"""
import os, json, base64, re, urllib.request, urllib.parse, urllib.error

APP_KEY = os.environ["DROPBOX_APP_KEY"]
APP_SECRET = os.environ["DROPBOX_APP_SECRET"]
REFRESH = os.environ["DROPBOX_REFRESH_TOKEN"]
SB_URL = (os.environ.get("SUPABASE_URL") or os.environ["VITE_SUPABASE_URL"]).rstrip("/")
SB_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ENTRADA = os.environ.get("DROPBOX_ENTRADA", "/facturas AGM/entrada")
WEB = os.environ.get("DROPBOX_WEB", "/facturas AGM/web")

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}


# ---------------- Dropbox ----------------
def dbx_token():
    data = urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": REFRESH}).encode()
    req = urllib.request.Request("https://api.dropbox.com/oauth2/token", data=data)
    req.add_header("Authorization", "Basic " + base64.b64encode(f"{APP_KEY}:{APP_SECRET}".encode()).decode())
    return json.load(urllib.request.urlopen(req))["access_token"]

def dbx_rpc(tok, endpoint, arg):
    req = urllib.request.Request("https://api.dropboxapi.com/2/" + endpoint, data=json.dumps(arg).encode())
    req.add_header("Authorization", "Bearer " + tok)
    req.add_header("Content-Type", "application/json")
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        if e.code == 409:  # not_found u otros conflictos esperables
            return None
        raise

def dbx_list(tok, path):
    r = dbx_rpc(tok, "files/list_folder", {"path": path})
    return (r or {}).get("entries", [])

def dbx_download(tok, path):
    req = urllib.request.Request("https://content.dropboxapi.com/2/files/download")
    req.add_header("Authorization", "Bearer " + tok)
    req.add_header("Dropbox-API-Arg", json.dumps({"path": path}))
    return urllib.request.urlopen(req).read()

def dbx_upload(tok, path, content):
    req = urllib.request.Request("https://content.dropboxapi.com/2/files/upload", data=content)
    req.add_header("Authorization", "Bearer " + tok)
    req.add_header("Dropbox-API-Arg", json.dumps({"path": path, "mode": "overwrite", "autorename": False, "mute": True}))
    req.add_header("Content-Type", "application/octet-stream")
    urllib.request.urlopen(req).read()

def dbx_move(tok, frm, to):
    dbx_rpc(tok, "files/move_v2", {"from_path": frm, "to_path": to, "autorename": True})


# ---------------- Supabase ----------------
def sb_headers(extra=None):
    h = {"apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY}
    if extra:
        h.update(extra)
    return h

def sb_rest(method, path, body=None, prefer=None):
    url = SB_URL + "/rest/v1/" + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in sb_headers({"Content-Type": "application/json"}).items():
        req.add_header(k, v)
    if prefer:
        req.add_header("Prefer", prefer)
    try:
        r = urllib.request.urlopen(req)
        raw = r.read()
        return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"{method} {path} → HTTP {e.code}: {detail}")

def tonum(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return v
    s = str(v).strip().replace("€", "").replace(" ", "")
    if "," in s and "." in s:      # formato 1.234,56
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except Exception:
        return None

def sb_storage_list(bucket, prefix):
    url = SB_URL + "/storage/v1/object/list/" + bucket
    body = json.dumps({"prefix": prefix, "limit": 1000}).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    for k, v in sb_headers({"Content-Type": "application/json"}).items():
        req.add_header(k, v)
    return json.load(urllib.request.urlopen(req))

def sb_storage_download(bucket, path):
    url = SB_URL + "/storage/v1/object/" + bucket + "/" + urllib.parse.quote(path)
    req = urllib.request.Request(url)
    for k, v in sb_headers().items():
        req.add_header(k, v)
    return urllib.request.urlopen(req).read()

def sb_storage_upload(bucket, path, content, content_type):
    url = SB_URL + "/storage/v1/object/" + bucket + "/" + urllib.parse.quote(path)
    req = urllib.request.Request(url, data=content, method="POST")
    for k, v in sb_headers({"Content-Type": content_type or "application/octet-stream", "x-upsert": "true"}).items():
        req.add_header(k, v)
    urllib.request.urlopen(req).read()


# ---------------- Relay ↑ (uploads → Dropbox) ----------------
def relay_up(tok):
    jobs = sb_rest("GET", "jobs?estado=eq.en_cola&select=id,empresa") or []
    print(f"[↑] {len(jobs)} job(s) en_cola")
    for job in jobs:
        jid, emp = job["id"], job.get("empresa") or "SIN_EMPRESA"
        prefix = f"{emp}/{jid}"
        try:
            files = sb_storage_list("uploads", prefix)
        except urllib.error.HTTPError as e:
            print(f"  ✗ list uploads {prefix}: {e}"); continue
        names = [f["name"] for f in files if f.get("name") and not f["name"].startswith(".")]
        if not names:
            print(f"  · {jid}: sin ficheros en uploads, lo dejo en_cola"); continue
        ok = 0
        for name in names:
            try:
                content = sb_storage_download("uploads", f"{prefix}/{name}")
                dbx_upload(tok, f"{ENTRADA}/{emp}/{jid}/{name}", content)
                ok += 1
            except Exception as e:
                print(f"  ✗ {name}: {e}")
        sb_rest("PATCH", f"jobs?id=eq.{jid}", {"estado": "procesando"})
        print(f"  ✓ {jid} ({emp}): {ok}/{len(names)} ficheros → Dropbox, job=procesando")


# ---------------- Relay ↓ (Dropbox /web → Supabase) ----------------
def relay_down(tok):
    entries = dbx_list(tok, WEB)
    for e in entries:
        if e.get(".tag") != "file":
            continue
        name = e["name"]
        if name == "status.json":
            volcar_status(tok, e["path_lower"]); continue
        m = re.match(r"^([0-9a-fA-F-]{36})\.json$", name)
        if not m or not UUID_RE.match(m.group(1)):
            continue
        jid = m.group(1)
        job = sb_rest("GET", f"jobs?id=eq.{jid}&select=id,empresa")
        if not job:
            print(f"  · {name}: no hay job {jid}, lo ignoro"); continue
        emp = job[0].get("empresa")
        try:
            data = json.loads(dbx_download(tok, e["path_lower"]).decode("utf-8"))
            items = data.get("items", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
            if items:
                muestra = {k: ((str(v)[:24] + "…") if k == "img" else v) for k, v in items[0].items()}
                print(f"  · {jid}: {len(items)} items. Muestra item[0]: {muestra}")
            # idempotente: limpia facturas previas de ese job
            sb_rest("DELETE", f"facturas?job_id=eq.{jid}")
            rows, okimg = [], 0
            for i, it in enumerate(items):
                iid = it.get("id") or f"r{i + 1}"
                img_path = None
                mm = re.match(r"^data:(image/[a-z+]+);base64,(.+)$", str(it.get("img") or ""), re.I)
                if mm:
                    ext = EXT.get(mm.group(1).lower(), "jpg")
                    img_path = f"{jid}/{iid}.{ext}"
                    try:
                        sb_storage_upload("facturas", img_path, base64.b64decode(mm.group(2)), mm.group(1)); okimg += 1
                    except Exception as ex:
                        print(f"    ✗ img {iid}: {ex}"); img_path = None
                rows.append({
                    "job_id": jid, "empresa": emp, "item_id": iid, "img_path": img_path,
                    "rot0": int(tonum(it.get("rot0")) or 0), "fecha": it.get("fecha"), "proveedor": it.get("proveedor"),
                    "num": it.get("num"), "base": tonum(it.get("base")), "iva": tonum(it.get("iva")), "total": tonum(it.get("total")),
                    "timp": it.get("timp"), "conf": it.get("conf"), "flag": bool(it.get("flag")), "obs": it.get("obs"),
                })
            if rows:
                sb_rest("POST", "facturas", rows)
            sb_rest("PATCH", f"jobs?id=eq.{jid}", {"estado": "listo", "n_facturas": len(rows), "terminado": "now()"})
            dbx_move(tok, e["path_lower"], f"{WEB}/procesados/{name}")
            print(f"  ✓ {jid}: {len(rows)} facturas ({okimg} imágenes) → Supabase, job=listo")
        except Exception as ex:
            print(f"  ✗ {jid}: ERROR procesando → {ex}")
            try: sb_rest("PATCH", f"jobs?id=eq.{jid}", {"estado": "error"})
            except Exception: pass


def volcar_status(tok, path):
    try:
        s = json.loads(dbx_download(tok, path).decode("utf-8"))
    except Exception:
        return
    row = {"id": 1, "last_run": s.get("lastRun"), "interval_min": s.get("intervalMin", 15),
           "avg_seg_por_lote": s.get("avgSegPorLote", 90), "procesando": bool(s.get("procesando"))}
    sb_rest("POST", "status", row, prefer="resolution=merge-duplicates")
    print("  ✓ status actualizado")


def main():
    tok = dbx_token()
    print("== Relay ↑ (uploads → Dropbox) ==")
    relay_up(tok)
    print("== Relay ↓ (Dropbox /web → Supabase) ==")
    relay_down(tok)
    print("Relay completado.")


if __name__ == "__main__":
    main()
