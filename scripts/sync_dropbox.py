#!/usr/bin/env python3
"""Descarga los .json de revisión desde una carpeta de Dropbox a public/data/.
Usa un refresh token de una app de Dropbox (no caduca). Variables de entorno:
  DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN, DROPBOX_WEB_FOLDER
Se ejecuta dentro de la GitHub Action (tiene internet); no necesita librerías externas.
"""
import os, json, base64, urllib.request, urllib.parse, pathlib

APP_KEY = os.environ["DROPBOX_APP_KEY"]
APP_SECRET = os.environ["DROPBOX_APP_SECRET"]
REFRESH = os.environ["DROPBOX_REFRESH_TOKEN"]
FOLDER = os.environ.get("DROPBOX_WEB_FOLDER", "/facturas AGM/web")

def access_token():
    data = urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": REFRESH}).encode()
    req = urllib.request.Request("https://api.dropbox.com/oauth2/token", data=data)
    auth = base64.b64encode(f"{APP_KEY}:{APP_SECRET}".encode()).decode()
    req.add_header("Authorization", "Basic " + auth)
    return json.load(urllib.request.urlopen(req))["access_token"]

def list_folder(tok):
    req = urllib.request.Request("https://api.dropboxapi.com/2/files/list_folder",
                                 data=json.dumps({"path": FOLDER}).encode())
    req.add_header("Authorization", "Bearer " + tok)
    req.add_header("Content-Type", "application/json")
    return json.load(urllib.request.urlopen(req)).get("entries", [])

def download(tok, path):
    req = urllib.request.Request("https://content.dropboxapi.com/2/files/download")
    req.add_header("Authorization", "Bearer " + tok)
    req.add_header("Dropbox-API-Arg", json.dumps({"path": path}))
    return urllib.request.urlopen(req).read()

def main():
    tok = access_token()
    out = pathlib.Path("public/data"); out.mkdir(parents=True, exist_ok=True)
    n = 0
    for e in list_folder(tok):
        if e.get(".tag") == "file" and e["name"].lower().endswith(".json"):
            (out / e["name"]).write_bytes(download(tok, e["path_lower"]))
            print("descargado", e["name"]); n += 1
    print("total", n, "ficheros")

if __name__ == "__main__":
    main()
