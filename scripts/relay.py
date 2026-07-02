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
import os, json, base64, re, io, urllib.request, urllib.parse, urllib.error
try:
    from PIL import Image, ImageOps
    PIL_OK = True
except Exception:
    PIL_OK = False
try:
    import pillow_heif
    pillow_heif.register_heif_opener()   # permite abrir HEIC/HEIF con PIL
except Exception:
    pass
try:
    import fitz   # PyMuPDF: render de PDF sin dependencias del sistema (no necesita poppler)
    PDF_OK = True
except Exception:
    PDF_OK = False


def _img_to_jpeg(im, maxpx, q):
    im = ImageOps.exif_transpose(im)
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    im.thumbnail((maxpx, maxpx))   # ~maxpx de ancho (mantiene proporción)
    out = io.BytesIO()
    im.save(out, format="JPEG", quality=q, optimize=True)
    return out.getvalue()


def shrink(content, maxpx=1600, q=82):
    """Reduce una imagen a JPEG (máx maxpx, corrige orientación EXIF). None si no se puede."""
    if not PIL_OK:
        return None
    try:
        return _img_to_jpeg(Image.open(io.BytesIO(content)), maxpx, q)
    except Exception:
        return None


def render_original(content, src, pagina, maxpx=1000, q=80):
    """Genera el JPEG de la factura desde el fichero original:
    PDF → renderiza la página `pagina` (~200 dpi, PyMuPDF); imagen/HEIC → directa. None si falla."""
    if not PIL_OK:
        return None
    try:
        if src.lower().endswith(".pdf"):
            if not PDF_OK:
                return None
            doc = fitz.open(stream=content, filetype="pdf")
            page = doc[max(0, int(pagina or 1) - 1)]
            pix = page.get_pixmap(dpi=200)
            im = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        else:
            im = Image.open(io.BytesIO(content))
        return _img_to_jpeg(im, maxpx, q)
    except Exception as ex:
        print(f"    · render falló ({src} p{pagina}): {ex}")
        return None

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
        if ok == len(names):
            sb_rest("PATCH", f"jobs?id=eq.{jid}", {"estado": "procesando"})
            print(f"  ✓ {jid} ({emp}): {ok}/{len(names)} ficheros → Dropbox, job=procesando")
        else:
            print(f"  ⚠ {jid} ({emp}): {ok}/{len(names)} copiados, lo dejo en_cola para reintentar")


# ---------------- Relay ↓ (Dropbox /web → Supabase) ----------------
CT = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif", "pdf": "application/pdf"}

def _src_filename(it):
    """Nombre del fichero original en /entrada: campo 'archivo'/'orig' o el [orig: ...] del obs."""
    a = it.get("archivo") or it.get("orig")
    if a:
        return str(a).strip()
    mo = re.search(r"\[orig:\s*([^\]\r\n]+?)\s*\]", str(it.get("obs") or ""), re.I)
    return mo.group(1).strip() if mo else None

def process_web_file(tok, e, move_after):
    name = e["name"]
    jid = name[:-5]  # sin .json
    job = sb_rest("GET", f"jobs?id=eq.{jid}&select=id,empresa")
    if not job:
        print(f"  · {name}: no hay job {jid}, lo ignoro"); return
    emp = job[0].get("empresa")
    try:
        data = json.loads(dbx_download(tok, e["path_lower"]).decode("utf-8"))
        items = data.get("items", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
        if items:
            muestra = {k: ((str(v)[:24] + "…") if k == "img" else v) for k, v in items[0].items()}
            print(f"  · {jid}: {len(items)} items. Muestra item[0]: {muestra}")
        rows, okimg = [], 0
        dl_cache, render_cache = {}, {}   # original bytes por fichero · jpeg por (fichero,página)
        for i, it in enumerate(items):
            iid = it.get("id") or f"r{i + 1}"
            img_path, jpeg = None, None
            imgval = str(it.get("img") or "").strip()
            m_b64 = re.match(r"^data:(image/[a-z+]+);base64,(.+)$", imgval, re.I)
            # A) compat: base64 embebido en 'img' (lotes antiguos)
            if m_b64 and len(m_b64.group(2)) > 200:
                b64 = re.sub(r"\s+", "", m_b64.group(2)); b64 += "=" * (-len(b64) % 4)
                try:
                    jpeg = shrink(base64.b64decode(b64, validate=False))
                except Exception as ex:
                    print(f"    ✗ img {iid}: base64 inválido ({ex})")
            # B) nuevo contrato: el relay RENDERiza desde el fichero original en /entrada
            if jpeg is None:
                src = it.get("src") or _src_filename(it)
                if src:
                    pagina = it.get("pagina") or 1
                    safe = re.sub(r"[^\w.\-]+", "_", str(src))
                    key = (safe, pagina)
                    if key in render_cache:
                        jpeg = render_cache[key]
                    else:
                        if safe not in dl_cache:
                            try:
                                dl_cache[safe] = dbx_download(tok, f"{ENTRADA}/{emp}/{jid}/{safe}")
                            except Exception:
                                dl_cache[safe] = None; print(f"    · img {iid}: original no encontrado ({safe})")
                        orig = dl_cache[safe]
                        jpeg = render_original(orig, safe, pagina) if orig is not None else None
                        render_cache[key] = jpeg
            # subir la miniatura
            if jpeg is not None:
                img_path = f"{jid}/{iid}.jpg"
                try:
                    sb_storage_upload("facturas", img_path, jpeg, "image/jpeg"); okimg += 1
                except Exception as ex:
                    print(f"    ✗ img {iid}: subida ({ex})"); img_path = None
            rows.append({
                "job_id": jid, "tanda": jid, "empresa": emp, "item_id": iid, "img_path": img_path,
                "rot0": int(tonum(it.get("rot0")) or 0), "fecha": it.get("fecha"), "proveedor": it.get("proveedor"),
                "num": it.get("num"), "base": tonum(it.get("base")), "iva": tonum(it.get("iva")), "total": tonum(it.get("total")),
                "timp": it.get("timp"), "conf": it.get("conf"), "flag": bool(it.get("flag")), "obs": it.get("obs"),
            })
        if rows:
            # UPSERT por (tanda,item_id): conserva el id de la factura → 'revisiones' sobrevive al reprocesar
            sb_rest("POST", "facturas?on_conflict=tanda,item_id", rows, prefer="resolution=merge-duplicates")
            # borra solo las facturas que ya no están en el JSON (huérfanas), sin tocar las conservadas
            keep = ",".join('"' + str(r["item_id"]).replace('"', '') + '"' for r in rows)
            sb_rest("DELETE", f"facturas?job_id=eq.{jid}&item_id=not.in.({keep})")
        else:
            sb_rest("DELETE", f"facturas?job_id=eq.{jid}")
        sb_rest("PATCH", f"jobs?id=eq.{jid}", {"estado": "listo", "terminado": "now()"})  # n_facturas se deja = subidas
        if move_after:
            dbx_move(tok, e["path_lower"], f"{WEB}/procesados/{name}")
            try: dbx_rpc(tok, "files/delete_v2", {"path": f"{WEB}/img/{jid}"})  # limpia las imágenes ya volcadas
            except Exception: pass
        print(f"  ✓ {jid}: {len(rows)} facturas ({okimg} imágenes) → Supabase, job=listo")
    except Exception as ex:
        print(f"  ✗ {jid}: ERROR procesando → {ex}")
        try: sb_rest("PATCH", f"jobs?id=eq.{jid}", {"estado": "error"})
        except Exception: pass

def _is_job_json(name):
    return bool(re.match(r"^[0-9a-fA-F-]{36}\.json$", name)) and bool(UUID_RE.match(name[:-5]))

def relay_down(tok):
    for e in dbx_list(tok, WEB):
        if e.get(".tag") != "file":
            continue
        if e["name"] == "status.json":
            volcar_status(tok, e["path_lower"]); continue
        if _is_job_json(e["name"]):
            process_web_file(tok, e, True)
    if os.environ.get("REPROCESS"):
        print("  (REPROCESS: re-vuelco /web/procesados)")
        for e in dbx_list(tok, f"{WEB}/procesados"):
            if e.get(".tag") == "file" and _is_job_json(e["name"]):
                process_web_file(tok, e, False)
    job_re = os.environ.get("REPROCESS_JOB")
    if job_re:
        print(f"  (REPROCESS_JOB: re-vuelco solo {job_re})")
        e = {"name": f"{job_re}.json", "path_lower": f"{WEB}/procesados/{job_re}.json".lower(), ".tag": "file"}
        if _is_job_json(e["name"]):
            process_web_file(tok, e, False)


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
