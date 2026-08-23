#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Furry Content Manager — локальный агент.

Что делает:
  1. Следит за папкой с генерациями и отправляет маленькие превью на сайт.
  2. Раз в несколько секунд спрашивает сайт, какие изображения вы одобрили с телефона.
  3. Апскейлит одобренные через Automatic1111 (extra-single-image).
  4. Загружает результат на DeviantArt (Sta.sh -> публикация в галерею).
  5. Возвращает статус и ссылку обратно на сайт.

Установка:
    pip install requests pillow
Запуск:
    python furry_agent.py
"""

import base64
import io
import json
import os
import sys
import time
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlencode, urlparse, parse_qs

import requests
from PIL import Image

# ─────────────────────────── НАСТРОЙКИ ───────────────────────────
API_BASE = "https://your-app.lovable.app"      # адрес сайта
AGENT_TOKEN = "вставьте-ключ-со-страницы-Агент"

WATCH_DIR = r"C:\stable-diffusion\outputs"     # родительская папка; вложенные папки с датами сканируются автоматически
EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")
SKIP_DIRS = {"upscaled", ".git", "__pycache__", "tmp", "temp"}  # папки, которые пропускаем
SCAN_INTERVAL = 10                              # сек между сканами папки
POLL_INTERVAL = 8                               # сек между опросами очереди

PREVIEW_MAX_SIDE = 640                          # размер превью для телефона
PREVIEW_QUALITY = 72

A1111_URL = "http://127.0.0.1:7860"
UPSCALER = "R-ESRGAN 4x+"

# Режимы: "factor" — по множителю; "size" — по целевому разрешению
UPSCALE_MODE = "size"                          # "factor" или "size"
UPSCALE_FACTOR = 2                             # используется только при UPSCALE_MODE = "factor"
UPSCALE_WIDTH = 3200                           # целевая ширина
UPSCALE_HEIGHT = 4096                          # целевая высота


DA_CLIENT_ID = ""                               # DeviantArt application client_id
DA_CLIENT_SECRET = ""                           # DeviantArt application client_secret
DA_REDIRECT = "http://localhost:8721/callback"  # добавьте этот URI в настройках приложения

STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_state.json")
UPSCALED_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "upscaled")
# ─────────────────────────────────────────────────────────────────

HEADERS = {"x-agent-token": AGENT_TOKEN, "content-type": "application/json"}


def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"sent": [], "da": {}}


def save_state(state):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


STATE = load_state()


def log(*a):
    print(time.strftime("[%H:%M:%S]"), *a, flush=True)


# ─────────────────────── 1. отправка превью ──────────────────────
def make_preview(path):
    with Image.open(path) as im:
        im = im.convert("RGB")
        w, h = im.size
        scale = min(1.0, PREVIEW_MAX_SIDE / max(w, h))
        thumb = im.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        buf = io.BytesIO()
        thumb.save(buf, format="JPEG", quality=PREVIEW_QUALITY, optimize=True)
        return base64.b64encode(buf.getvalue()).decode(), w, h


def scan_and_upload():
    sent = set(STATE["sent"])
    batch = []
    # обходим WATCH_DIR рекурсивно: подойдёт любая родительская папка,
    # вложенные папки (например, по датам) подхватятся сами
    for root, dirs, files in os.walk(WATCH_DIR):
        dirs[:] = [d for d in dirs if d.lower() not in SKIP_DIRS and not d.startswith(".")]
        if os.path.abspath(root).startswith(os.path.abspath(UPSCALED_DIR)):
            continue
        for name in sorted(files):
            if not name.lower().endswith(EXTENSIONS):
                continue
            full = os.path.join(root, name)
            if full in sent:
                continue
            try:
                b64, w, h = make_preview(full)
            except Exception as e:
                log("превью не сделано:", name, e)
                sent.add(full)
                continue
            batch.append(
                {"filename": name, "local_path": full, "width": w, "height": h, "preview_b64": b64}
            )
            if len(batch) >= 10:
                break
        if len(batch) >= 10:
            break

    if not batch:
        return

    try:
        r = requests.post(
            f"{API_BASE}/api/public/agent/ingest",
            headers=HEADERS,
            data=json.dumps({"files": batch}),
            timeout=180,
        )
        r.raise_for_status()
        log("отправлено превью:", r.json())
        for f in batch:
            sent.add(f["local_path"])
        STATE["sent"] = sorted(sent)
        save_state(STATE)
    except Exception as e:
        log("ошибка отправки превью:", e)


# ───────────────────────── 2. апскейл ────────────────────────────
def safe_name(name):
    keep = "".join(c for c in str(name) if c.isalnum() or c in "-_ ").strip()
    return keep or "image"


def _out_path(path, out_name):
    os.makedirs(UPSCALED_DIR, exist_ok=True)
    base = safe_name(out_name) if out_name else os.path.splitext(os.path.basename(path))[0] + "_up"
    out_path = os.path.join(UPSCALED_DIR, base + ".png")
    n = 2
    while os.path.exists(out_path):
        out_path = os.path.join(UPSCALED_DIR, f"{base}_{n}.png")
        n += 1
    return out_path


def upscale_local(path, out_name=None):
    """Запасной апскейл средствами Pillow (Lanczos), если A1111 недоступен."""
    from PIL import Image

    img = Image.open(path).convert("RGB")
    if UPSCALE_MODE == "size":
        target = (UPSCALE_WIDTH, UPSCALE_HEIGHT)
    else:
        target = (img.width * UPSCALE_FACTOR, img.height * UPSCALE_FACTOR)
    img = img.resize(target, Image.LANCZOS)
    out_path = _out_path(path, out_name)
    img.save(out_path, "PNG")
    return out_path


def upscale(path, out_name=None):
    with open(path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()


    if UPSCALE_MODE == "size":
        payload = {
            "resize_mode": 1,
            "upscaling_resize_w": UPSCALE_WIDTH,
            "upscaling_resize_h": UPSCALE_HEIGHT,
            "upscaler_1": UPSCALER,
            "image": img_b64,
        }
    else:
        payload = {
            "resize_mode": 0,
            "upscaling_resize": UPSCALE_FACTOR,
            "upscaler_1": UPSCALER,
            "image": img_b64,
        }

    r = requests.post(f"{A1111_URL}/sdapi/v1/extra-single-image", json=payload, timeout=1800)
    r.raise_for_status()
    out_b64 = r.json()["image"]
    os.makedirs(UPSCALED_DIR, exist_ok=True)
    base = safe_name(out_name) if out_name else os.path.splitext(os.path.basename(path))[0] + "_up"
    out_path = os.path.join(UPSCALED_DIR, base + ".png")
    n = 2
    while os.path.exists(out_path):
        out_path = os.path.join(UPSCALED_DIR, f"{base}_{n}.png")
        n += 1
    with open(out_path, "wb") as f:
        f.write(base64.b64decode(out_b64.split(",")[-1]))
    return out_path



# ──────────────────── 3. DeviantArt OAuth + upload ───────────────
class _CallbackHandler(BaseHTTPRequestHandler):
    code = None

    def do_GET(self):
        qs = parse_qs(urlparse(self.path).query)
        _CallbackHandler.code = qs.get("code", [None])[0]
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write("<h2>Готово, можно закрыть вкладку.</h2>".encode())

    def log_message(self, *a):
        pass


def da_authorize():
    params = {
        "response_type": "code",
        "client_id": DA_CLIENT_ID,
        "redirect_uri": DA_REDIRECT,
        "scope": "browse stash publish user",
    }
    url = "https://www.deviantart.com/oauth2/authorize?" + urlencode(params)
    server = HTTPServer(("localhost", 8721), _CallbackHandler)
    threading.Thread(target=server.handle_request, daemon=True).start()
    log("Откройте в браузере:", url)
    webbrowser.open(url)
    for _ in range(300):
        if _CallbackHandler.code:
            break
        time.sleep(1)
    server.server_close()
    if not _CallbackHandler.code:
        raise RuntimeError("Не получен код авторизации DeviantArt")
    r = requests.post(
        "https://www.deviantart.com/oauth2/token",
        data={
            "grant_type": "authorization_code",
            "client_id": DA_CLIENT_ID,
            "client_secret": DA_CLIENT_SECRET,
            "redirect_uri": DA_REDIRECT,
            "code": _CallbackHandler.code,
        },
        timeout=60,
    )
    r.raise_for_status()
    STATE["da"] = r.json()
    save_state(STATE)


def da_token():
    da = STATE.get("da") or {}
    if not da.get("refresh_token"):
        da_authorize()
        return STATE["da"]["access_token"]
    r = requests.post(
        "https://www.deviantart.com/oauth2/token",
        data={
            "grant_type": "refresh_token",
            "client_id": DA_CLIENT_ID,
            "client_secret": DA_CLIENT_SECRET,
            "refresh_token": da["refresh_token"],
        },
        timeout=60,
    )
    if r.status_code != 200:
        da_authorize()
        return STATE["da"]["access_token"]
    STATE["da"] = r.json()
    save_state(STATE)
    return STATE["da"]["access_token"]


def da_publish(path, job):
    token = da_token()

    with open(path, "rb") as f:
        r = requests.post(
            "https://www.deviantart.com/api/v1/oauth2/stash/submit",
            headers={"Authorization": f"Bearer {token}"},
            data={"title": job["title"], "artist_comments": job.get("description", "")},
            files={"file": (os.path.basename(path), f, "image/png")},
            timeout=600,
        )
    r.raise_for_status()
    itemid = r.json()["itemid"]

    data = [
        ("itemid", str(itemid)),
        ("is_mature", "1" if job.get("is_mature") else "0"),
        ("agree_submission", "1"),
        ("agree_tos", "1"),
        ("catpath", "/digitalart"),
        ("allow_comments", "1"),
        ("feature", "1"),
    ]
    if job.get("is_mature"):
        data.append(("mature_level", "moderate"))
    for tag in job.get("tags", [])[:30]:
        data.append(("tags[]", tag))
    if job.get("gallery_folder"):
        folder_id = da_folder_id(token, job["gallery_folder"])
        if folder_id:
            data.append(("galleryids[]", folder_id))

    r = requests.post(
        "https://www.deviantart.com/api/v1/oauth2/stash/publish",
        headers={"Authorization": f"Bearer {token}"},
        data=data,
        timeout=600,
    )
    r.raise_for_status()
    return r.json().get("url")


def da_folder_id(token, name):
    try:
        r = requests.get(
            "https://www.deviantart.com/api/v1/oauth2/gallery/folders",
            headers={"Authorization": f"Bearer {token}"},
            params={"limit": 50},
            timeout=60,
        )
        r.raise_for_status()
        for f in r.json().get("results", []):
            if f.get("name", "").lower() == name.lower():
                return f.get("folderid")
    except Exception as e:
        log("папка галереи не найдена:", e)
    return None


# ───────────────────── 4. цикл обработки очереди ─────────────────
def report(image_id, status, deviation_url=None, error=None):
    try:
        requests.post(
            f"{API_BASE}/api/public/agent/status",
            headers=HEADERS,
            data=json.dumps(
                {"id": image_id, "status": status, "deviation_url": deviation_url, "error": error}
            ),
            timeout=60,
        )
    except Exception as e:
        log("не удалось отправить статус:", e)


def process_queue():
    try:
        r = requests.post(f"{API_BASE}/api/public/agent/claim", headers=HEADERS, data="{}", timeout=120)
        r.raise_for_status()
        jobs = r.json().get("jobs", [])
    except Exception as e:
        log("очередь недоступна:", e)
        return

    for job in jobs:
        log("обработка:", job["filename"], "->", job.get("asset_name", ""))
        try:
            src = job["local_path"]
            if not os.path.exists(src):
                report(job["id"], "error", error="файл не найден на компьютере")
                continue
            asset = job.get("asset_name") or os.path.splitext(job["filename"])[0]
            big = upscale(src, asset)
            report(job["id"], "uploading")
            url = da_publish(big, job)
            report(job["id"], "published", deviation_url=url)
            log("опубликовано:", url)
        except Exception as e:
            log("ошибка:", e)
            report(job["id"], "error", error=str(e)[:300])


def main():
    if "вставьте" in AGENT_TOKEN:
        print("Заполните AGENT_TOKEN в настройках скрипта.")
        sys.exit(1)
    log("агент запущен, папка:", WATCH_DIR)
    last_scan = 0.0
    while True:
        now = time.time()
        if now - last_scan >= SCAN_INTERVAL:
            scan_and_upload()
            last_scan = now
        process_queue()
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
