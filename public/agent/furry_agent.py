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
import hashlib
import io
import json
import os
import secrets
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

# Если Automatic1111 не запущен или запущен без --api, апскейлить локально (Pillow, Lanczos)
FALLBACK_TO_PIL = True


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

    try:
        r = requests.post(f"{A1111_URL}/sdapi/v1/extra-single-image", json=payload, timeout=1800)
    except requests.RequestException as e:
        if FALLBACK_TO_PIL:
            print(f"[upscale] A1111 недоступен ({e}) — апскейлю локально через Pillow")
            return upscale_local(path, out_name)
        raise RuntimeError(f"Automatic1111 недоступен по адресу {A1111_URL}: {e}")

    if r.status_code == 404:
        msg = (
            f"Automatic1111 по адресу {A1111_URL} отвечает, но API выключен (404 на "
            "/sdapi/v1/extra-single-image). Запустите WebUI с ключом --api "
            "(в webui-user.bat: set COMMANDLINE_ARGS=--api) и перезапустите его."
        )
        if FALLBACK_TO_PIL:
            print(f"[upscale] {msg}\n[upscale] Пока апскейлю локально через Pillow")
            return upscale_local(path, out_name)
        raise RuntimeError(msg)

    r.raise_for_status()
    out_b64 = r.json()["image"]
    out_path = _out_path(path, out_name)
    with open(out_path, "wb") as f:
        f.write(base64.b64decode(out_b64.split(",")[-1]))
    return out_path



# ──────────────────── 3. DeviantArt OAuth + upload ───────────────
class _CallbackHandler(BaseHTTPRequestHandler):
    code = None
    error = None

    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        # DeviantArt может вернуться на любой зарегистрированный путь ("/", "/callback", ...),
        # поэтому ориентируемся не на путь, а на наличие параметров code/error.
        if "code" not in qs and "error" not in qs and "error_description" not in qs:
            self.send_response(404)
            self.end_headers()
            return
        _CallbackHandler.code = qs.get("code", [None])[0]
        _CallbackHandler.error = qs.get("error_description", qs.get("error", [None]))[0]
        log("DeviantArt callback:", parsed.path, "code" if _CallbackHandler.code else _CallbackHandler.error)
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.end_headers()
        msg = (
            "Готово, можно закрыть вкладку."
            if _CallbackHandler.code
            else f"Авторизация не удалась: {_CallbackHandler.error or 'DeviantArt не вернул код'}"
        )
        self.wfile.write(f"<h2>{msg}</h2>".encode())


    def log_message(self, *a):
        pass


def _da_check(r, what):
    """Понятная ошибка вместо голого HTTP-кода: DeviantArt пишет причину в теле ответа."""
    if r.status_code >= 400:
        try:
            body = json.dumps(r.json(), ensure_ascii=False)
        except Exception:
            body = r.text[:300]
        raise RuntimeError(f"DeviantArt {what}: HTTP {r.status_code} {body}")
    try:
        return r.json()
    except Exception:
        raise RuntimeError(f"DeviantArt {what}: неожиданный ответ {r.text[:300]}")


def da_authorize():
    if not DA_CLIENT_ID or not DA_CLIENT_SECRET:
        raise RuntimeError("Заполните DA_CLIENT_ID и DA_CLIENT_SECRET в настройках скрипта")

    _CallbackHandler.code = None
    _CallbackHandler.error = None
    # DeviantArt требует PKCE: одноразовый verifier остаётся локально,
    # а в браузер отправляется только его SHA-256 challenge.
    code_verifier = secrets.token_urlsafe(64)
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")
    params = {
        "response_type": "code",
        "client_id": DA_CLIENT_ID,
        "redirect_uri": DA_REDIRECT,
        "scope": "browse stash publish user",
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    url = "https://www.deviantart.com/oauth2/authorize?" + urlencode(params)
    server = HTTPServer(("localhost", 8721), _CallbackHandler)
    server.timeout = 1
    log("В настройках приложения DeviantArt поле OAuth2 Redirect URI Whitelist должно содержать РОВНО:", DA_REDIRECT)
    log("Откройте в браузере (если вкладка не открылась сама):", url)
    webbrowser.open(url)
    deadline = time.time() + 300
    while time.time() < deadline and not _CallbackHandler.code and not _CallbackHandler.error:
        server.handle_request()  # обрабатываем ВСЕ запросы, пока не придёт code
    server.server_close()
    if _CallbackHandler.error:
        raise RuntimeError(f"DeviantArt отказал в авторизации: {_CallbackHandler.error}")
    if not _CallbackHandler.code:
        raise RuntimeError(
            "Не получен код авторизации DeviantArt. Проверьте, что в приложении DeviantArt "
            f"в Redirect URI Whitelist добавлен ровно {DA_REDIRECT} (без пробелов и слэша в конце)"
        )

    r = requests.post(
        "https://www.deviantart.com/oauth2/token",
        data={
            "grant_type": "authorization_code",
            "client_id": DA_CLIENT_ID,
            "client_secret": DA_CLIENT_SECRET,
            "redirect_uri": DA_REDIRECT,
            "code": _CallbackHandler.code,
            "code_verifier": code_verifier,
        },
        timeout=60,
    )
    tok = _da_check(r, "получение токена")
    if not tok.get("access_token"):
        raise RuntimeError(f"DeviantArt не выдал access_token: {tok}")
    STATE["da"] = tok
    save_state(STATE)
    log("DeviantArt: авторизация выполнена")


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
    if r.status_code != 200 or not r.json().get("access_token"):
        log("DeviantArt: refresh не сработал, нужна повторная авторизация")
        da_authorize()
        return STATE["da"]["access_token"]
    STATE["da"] = r.json()
    save_state(STATE)
    return STATE["da"]["access_token"]


def da_publish(path, job):
    """Загружаем файл в Sta.sh с нужным именем и в нужный стек (папку).
    Публикацию в галерею не делаем — её вы выполняете вручную на DeviantArt."""
    token = da_token()

    title = job.get("asset_name") or job.get("title") or os.path.splitext(os.path.basename(path))[0]
    tpl = job.get("template") or {}
    exclusive = bool(tpl.get("is_exclusive"))
    # Для эксклюзива папка (стек) не используется — работа сразу уходит в галерею.
    stack = "" if exclusive else (job.get("gallery_folder") or "")

    data = {
        "title": title,
        "artist_comments": job.get("description", ""),
    }
    if stack:
        data["stack"] = stack  # Sta.sh создаст/использует стек с таким именем

    for i, tag in enumerate(job.get("tags", [])[:30]):
        data[f"tags[{i}]"] = tag
    if job.get("is_mature") or tpl.get("is_mature"):
        data["is_dirty"] = "1"

    # Опции из шаблона сайта (как в форме публикации DeviantArt).
    # Sta.sh принимает часть из них сразу; остальные сохраняются в метаданных
    # черновика и подставляются при ручной публикации.
    if tpl:
        if tpl.get("is_ai_generated"):
            data["is_ai_generated"] = "1"
        if tpl.get("noai"):
            data["noai"] = "1"
        if tpl.get("is_mature"):
            data["mature_level"] = tpl.get("mature_level") or "moderate"
            for i, c in enumerate(tpl.get("mature_classification") or []):
                data[f"mature_classification[{i}]"] = c
        data["allow_comments"] = "1" if tpl.get("allow_comments", True) else "0"
        data["allow_free_download"] = "1" if tpl.get("allow_free_download") else "0"
        data["add_watermark"] = "1" if tpl.get("add_watermark") else "0"
        if tpl.get("display_resolution"):
            data["display_resolution"] = str(tpl["display_resolution"])
        if tpl.get("license_cc"):
            data["license_options[creative_commons]"] = "1"
            data["license_options[commercial]"] = "1" if tpl.get("license_commercial") else "0"
            data["license_options[modify]"] = tpl.get("license_modify") or "no"
        if tpl.get("category_path"):
            data["catpath"] = tpl["category_path"]
        if tpl.get("is_downloadable"):
            data["is_downloadable"] = "1"
            if tpl.get("download_price"):
                data["download_price"] = str(int(tpl["download_price"]))

    log(
        f"DeviantArt: загружаю в Sta.sh «{title}»"
        + (f" -> стек «{stack}»" if stack else "")
        + (f" [шаблон: {tpl.get('name')}]" if tpl.get("name") else "")
    )
    with open(path, "rb") as f:
        r = requests.post(
            "https://www.deviantart.com/api/v1/oauth2/stash/submit",
            headers={"Authorization": f"Bearer {token}"},
            data=data,
            files={"file": (title + os.path.splitext(path)[1], f, "image/png")},
            timeout=600,
        )
    res = _da_check(r, "stash/submit")
    itemid = res.get("itemid")
    if not itemid:
        raise RuntimeError(f"stash/submit не вернул itemid: {res}")
    log("DeviantArt: в Sta.sh, itemid =", itemid, "стек:", res.get("stackid", "-"))

    if not (tpl.get("auto_publish") or exclusive):
        return "https://sta.sh/"

    # Автопубликация в галерею (включена в шаблоне)
    pub = {
        "itemid": str(itemid),
        "agree_submission": "1",
        "agree_tos": "1",
        "is_mature": "1" if (job.get("is_mature") or tpl.get("is_mature")) else "0",
        "allow_comments": "1" if tpl.get("allow_comments", True) else "0",
        "allow_free_download": "1" if tpl.get("allow_free_download") else "0",
        "add_watermark": "1" if tpl.get("add_watermark") else "0",
        "feature": "1",
        "sharing": "allow",
    }
    if pub["is_mature"] == "1":
        pub["mature_level"] = tpl.get("mature_level") or "moderate"
        for i, c in enumerate(tpl.get("mature_classification") or []):
            pub[f"mature_classification[{i}]"] = c
    if tpl.get("display_resolution"):
        pub["display_resolution"] = str(tpl["display_resolution"])
    if tpl.get("license_cc"):
        pub["license_options[creative_commons]"] = "1"
        pub["license_options[commercial]"] = "1" if tpl.get("license_commercial") else "0"
        pub["license_options[modify]"] = tpl.get("license_modify") or "no"
    if tpl.get("category_path"):
        pub["catpath"] = tpl["category_path"]
    if exclusive:
        # Эксклюзивный (премиум) контент с ценой в долларах США
        price = max(0.0, float(tpl.get("exclusive_price") or 0))
        pub["premium_folder_data[type]"] = "cash"
        pub["premium_folder_data[price]"] = f"{price:.2f}"
        pub["allow_free_download"] = "0"
        pub["is_downloadable"] = "1"
    elif tpl.get("is_downloadable"):
        pub["is_downloadable"] = "1"
        price = int(tpl.get("download_price") or 0)
        if price > 0:
            pub["download_price"] = str(price)
            pub["allow_free_download"] = "0"

    if stack:
        fid = da_folder_id(token, stack)
        if fid:
            pub["galleryids[0]"] = fid
        else:
            log(f"DeviantArt: папка «{stack}» не найдена — публикую без папки")

    if exclusive:
        log(f"DeviantArt: публикую эксклюзив «{title}» за ${pub.get('premium_folder_data[price]')}")
    else:
        log(f"DeviantArt: публикую «{title}»")
    pres = da_publish_request(token, pub)
    url = pres.get("url") or "https://www.deviantart.com/"
    log("DeviantArt: опубликовано ->", url)
    return url


def da_publish_request(token, pub, attempt=1):
    """stash/publish с автолечением: DeviantArt отвечает 400 и списком полей,
    которые он не принял — выкидываем их и пробуем снова."""
    rp = requests.post(
        "https://www.deviantart.com/api/v1/oauth2/stash/publish",
        headers={"Authorization": f"Bearer {token}"},
        data=pub,
        timeout=300,
    )
    if rp.status_code == 400 and attempt <= 3:
        try:
            body = rp.json()
        except Exception:
            body = {}
        errors = body.get("errors") or {}
        if errors:
            log("DeviantArt отклонил поля:", json.dumps(errors, ensure_ascii=False))
            cleaned = dict(pub)
            removed = []
            for field in errors:
                base = str(field).split("[")[0]
                for key in list(cleaned):
                    if key == field or key == base or key.startswith(base + "["):
                        if key == "itemid":
                            continue
                        cleaned.pop(key, None)
                        removed.append(key)
            if removed:
                log("Повторяю публикацию без:", ", ".join(sorted(set(removed))))
                return da_publish_request(token, cleaned, attempt + 1)
    return _da_check(rp, "stash/publish")






def da_folder_id(token, name):
    """Ищем папку по имени во всех страницах галереи."""
    offset = 0
    names = []
    try:
        while True:
            r = requests.get(
                "https://www.deviantart.com/api/v1/oauth2/gallery/folders",
                headers={"Authorization": f"Bearer {token}"},
                params={"limit": 50, "offset": offset, "calculate_size": "false"},
                timeout=60,
            )
            res = _da_check(r, "gallery/folders")
            for f in res.get("results", []):
                names.append(f.get("name", ""))
                if f.get("name", "").strip().lower() == name.strip().lower():
                    return f.get("folderid")
            if not res.get("has_more"):
                break
            offset = res.get("next_offset") or (offset + 50)
    except Exception as e:
        log("не удалось получить список папок:", e)
        return None
    log("папка не найдена. Доступные папки:", ", ".join(n for n in names if n))
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
