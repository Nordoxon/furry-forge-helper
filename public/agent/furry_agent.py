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
import queue
import secrets
import struct
import sys
import time
import threading
import webbrowser
import zlib
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
SCAN_INTERVAL = 60                              # скрипт сам проверяет папку outputs на новые изображения (минимум раз в минуту)
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

# ── ПОВЕДЕНИЕ, КОГДА STABLE DIFFUSION ЗАНЯТ ГЕНЕРАЦИЕЙ ──
# A1111 выполняет запросы по очереди: пока идёт txt2img, апскейл просто висит.
UPSCALE_WAIT_FOR_IDLE = True   # ждать, пока генерация закончится, прежде чем апскейлить
UPSCALE_MAX_WAIT = 1800        # сколько максимум ждать освобождения (сек)
UPSCALE_BUSY_ACTION = "pil"    # что делать, если так и занят: "pil" | "defer" | "wait"
UPSCALE_TIMEOUT = 900          # таймаут самого запроса апскейла (сек)


# Эксклюзив (платная работа). DeviantArt не даёт выставить цену через API —
# «Submit as Exclusive» + цена доступны только в окне публикации на сайте.
# Поэтому эксклюзивы агент готовит в Sta.sh (имя, теги, описание, стек),
# а цену и исходник вы задаёте вручную в окне Edit deviation.



DA_CLIENT_ID = ""                               # DeviantArt application client_id
DA_CLIENT_SECRET = ""                           # DeviantArt application client_secret
DA_REDIRECT = "http://localhost:8721/callback"  # добавьте этот URI в настройках приложения

# ── АВТОГЕНЕРАЦИЯ (обход лимита batch count = 100) ──
# Агент сам гоняет txt2img в Automatic1111 порциями и перезапускает цикл,
# пока не наберётся GEN_TOTAL изображений.
# ── АВТО-РЕСТАРТ ГЕНЕРАЦИИ («нажать Generate снова») ──
# Параметры вы задаёте сами в окне Stable Diffusion и запускаете первый прогон.
# Агент видит, что генерация остановилась (лимит batch count = 100),
# и запускает её заново с теми же параметрами.
GEN_ENABLED = False           # True — включить авто-рестарт
GEN_MODE = "attach"           # "attach" — работать по УЖЕ ОТКРЫТОЙ вкладке Automatic1111
                              #            (все ваши настройки и dynamic prompts сохраняются).
                              #            Браузер нужно запустить с отладочным портом, например:
                              #            chrome.exe --remote-debugging-port=9222
                              # "hotkey" — не трогает вкладки: активирует окно браузера и жмёт
                              #            Ctrl+Enter (горячая клавиша Generate в A1111).
                              #            Нужен pip install pyautogui pygetwindow
                              # "ui"     — агент сам открывает своё окно с интерфейсом
                              # "api"    — старый режим: запуск через txt2img API
GEN_CDP_URL = "http://127.0.0.1:9222"  # отладочный порт браузера для режима "attach"
GEN_WINDOW_TITLE = "Stable Diffusion"  # часть заголовка окна браузера для режима "hotkey"
GEN_BROWSER_HEADLESS = False  # для режима "ui": False — окно браузера видно
GEN_UI_URL = ""               # пусто = A1111_URL
GEN_RESTARTS = 10             # сколько раз перезапустить (0 — бесконечно)
GEN_IDLE_SECONDS = 15         # сколько секунд простоя считать «остановилось»
GEN_RETRY_WAIT = 30           # пауза перед повтором при ошибке
GEN_MAX_ERRORS = 5            # после скольких ошибок подряд остановиться
GEN_PAUSE_SECONDS = 600       # пауза после цикла (10 мин) на апскейл/загрузку отобранного



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


class A1111Busy(Exception):
    """Automatic1111 занят генерацией — задание вернём в очередь."""


def a1111_busy():
    """True, если A1111 сейчас генерирует. Ошибки связи считаем «не занят»."""
    try:
        return gen_busy()
    except Exception:
        return False


def wait_for_a1111(heartbeat=None):
    """Ждёт, пока A1111 освободится. Возвращает False, если так и занят."""
    if not UPSCALE_WAIT_FOR_IDLE:
        return True
    deadline = time.time() + UPSCALE_MAX_WAIT
    announced = False
    while a1111_busy():
        if not announced:
            print("[upscale] Stable Diffusion занят генерацией — жду освобождения")
            announced = True
        if UPSCALE_BUSY_ACTION != "wait" and time.time() > deadline:
            return False
        if heartbeat:
            heartbeat()
        time.sleep(10)
    return True


def upscale(path, out_name=None, heartbeat=None):
    if not wait_for_a1111(heartbeat):
        if UPSCALE_BUSY_ACTION == "pil" and FALLBACK_TO_PIL:
            print("[upscale] SD всё ещё занят — апскейлю локально через Pillow")
            return upscale_local(path, out_name)
        raise A1111Busy("Stable Diffusion занят генерацией")

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
        r = requests.post(f"{A1111_URL}/sdapi/v1/extra-single-image", json=payload, timeout=UPSCALE_TIMEOUT)
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
    """Загружаем файл в Sta.sh с нужным именем и в нужный стек (папку)."""
    token = da_token()

    title = job.get("asset_name") or job.get("title") or os.path.splitext(os.path.basename(path))[0]
    tpl = job.get("template") or {}
    stack = job.get("gallery_folder") or ""

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
    # Важно передавать и выключенные значения явно ("0"), иначе DeviantArt
    # подставляет свои настройки по умолчанию (например включённый NoAI).
    if tpl:
        data["is_ai_generated"] = "1" if tpl.get("is_ai_generated") else "0"
        data["noai"] = "1" if tpl.get("noai") else "0"
        if tpl.get("is_mature"):
            data["mature_level"] = tpl.get("mature_level") or "moderate"
            for i, c in enumerate(tpl.get("mature_classification") or []):
                data[f"mature_classification[{i}]"] = c
        data["allow_comments"] = "1" if tpl.get("allow_comments", True) else "0"
        data["allow_free_download"] = "1" if tpl.get("allow_free_download") else "0"
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

    if not tpl.get("auto_publish"):
        if tpl.get("add_watermark") or tpl.get("display_resolution"):
            log(
                "DeviantArt: размер показа и водяной знак применяются API только "
                "при публикации; в черновике Sta.sh их нужно выбрать вручную."
            )
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
        "is_ai_generated": "1" if tpl.get("is_ai_generated") else "0",
        "noai": "1" if tpl.get("noai") else "0",
        "feature": "1",
        "sharing": "allow",
    }
    if pub["is_mature"] == "1":
        pub["mature_level"] = tpl.get("mature_level") or "moderate"
        for i, c in enumerate(tpl.get("mature_classification") or []):
            pub[f"mature_classification[{i}]"] = c
    # API принимает не число пикселей, а enum 0..8. Интерфейс хранит понятное
    # пользователю значение в пикселях, поэтому преобразуем его перед запросом.
    resolution_codes = {
        0: 0,
        400: 1,
        600: 2,
        800: 3,
        900: 4,
        1024: 5,
        1280: 6,
        1600: 7,
        1920: 8,
    }
    selected_resolution = int(tpl.get("display_resolution") or 0)
    if selected_resolution:
        pub["display_resolution"] = str(resolution_codes.get(selected_resolution, selected_resolution))
    if tpl.get("license_cc"):
        pub["license_options[creative_commons]"] = "1"
        pub["license_options[commercial]"] = "1" if tpl.get("license_commercial") else "0"
        pub["license_options[modify]"] = tpl.get("license_modify") or "no"
    if tpl.get("category_path"):
        pub["catpath"] = tpl["category_path"]
    if tpl.get("is_downloadable"):
        pub["is_downloadable"] = "1"
        dprice = int(tpl.get("download_price") or 0)
        if dprice > 0:
            pub["download_price"] = str(dprice)
            pub["allow_free_download"] = "0"

    if stack:

        fid = da_folder_id(token, stack)
        if fid:
            pub["galleryids[0]"] = fid
        else:
            log(f"DeviantArt: папка «{stack}» не найдена — публикую без папки")

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
    if rp.status_code == 400 and attempt <= 6:
        try:
            body = rp.json()
        except Exception:
            body = {}
        # DeviantArt возвращает подробности в error_details (иногда в errors)
        errors = body.get("error_details") or body.get("errors") or {}
        if isinstance(errors, list):
            errors = {str(f): "" for f in errors}
        log("DeviantArt 400:", json.dumps(body, ensure_ascii=False)[:800])
        cleaned = dict(pub)
        price_key = "premium_folder_data[price]"

        if errors:
            # 1) Цена премиума: пробуем целое число долларов
            if any(str(f).startswith("premium_folder_data") for f in errors) and price_key in cleaned:
                whole = str(int(round(float(cleaned[price_key]) or 0)))
                if whole != cleaned[price_key]:
                    cleaned[price_key] = whole
                    log("Повторяю публикацию с целой ценой $", whole)
                    return da_publish_request(token, cleaned, attempt + 1)
            removed = []
            for field in errors:
                base = str(field).split("[")[0]
                for key in list(cleaned):
                    if key == field or key == base or key.startswith(base + "["):
                        if key in ("itemid", "agree_submission", "agree_tos"):
                            continue
                        cleaned.pop(key, None)
                        removed.append(key)
            if removed:
                log("Повторяю публикацию без:", ", ".join(sorted(set(removed))))
                return da_publish_request(token, cleaned, attempt + 1)

        # Подробностей нет (или они не помогли) — снимаем поля по очереди
        fallbacks = [
            [k for k in cleaned if k.startswith("premium_folder_data")],
            [k for k in cleaned if k.startswith("license_options")],
            [k for k in cleaned if k.startswith("mature_classification")],
            ["catpath"],
            ["display_resolution", "add_watermark", "feature", "sharing", "is_downloadable",
             "download_price", "allow_free_download"],
        ]
        for group in fallbacks:
            present = [k for k in group if k in cleaned]
            if present:
                for k in present:
                    cleaned.pop(k, None)
                log("Повторяю публикацию без:", ", ".join(present))
                return da_publish_request(token, cleaned, attempt + 1)

        # Последняя попытка — минимальный набор полей
        minimal = {
            "itemid": cleaned.get("itemid"),
            "agree_submission": "1",
            "agree_tos": "1",
            "is_mature": cleaned.get("is_mature", "0"),
        }
        if minimal["is_mature"] == "1":
            minimal["mature_level"] = pub.get("mature_level") or "moderate"
        for k, v in pub.items():
            if k.startswith("galleryids"):
                minimal[k] = v
        if minimal != cleaned:
            log("Повторяю публикацию с минимальным набором полей")
            return da_publish_request(token, minimal, attempt + 1)

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


def da_folder_ensure(token, name):
    """Находит папку галереи по имени, а если её нет — создаёт автоматически."""
    name = (name or "").strip()
    if not name:
        return None
    fid = da_folder_id(token, name)
    if fid:
        return fid
    try:
        r = requests.post(
            "https://www.deviantart.com/api/v1/oauth2/gallery/folders/create",
            headers={"Authorization": f"Bearer {token}"},
            data={"folder": name},
            timeout=60,
        )
        res = _da_check(r, "gallery/folders/create")
        fid = res.get("folderid")
        log(f"DeviantArt: создал папку галереи «{name}»")
        return fid
    except Exception as e:
        log("не удалось создать папку галереи:", e)
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
            big = upscale(src, asset, heartbeat=lambda: report(job["id"], "upscaling"))
            report(job["id"], "uploading")
            url = da_publish(big, job)
            report(job["id"], "published", deviation_url=url)
            log("опубликовано:", url)
        except A1111Busy as e:
            log("SD занят генерацией — возвращаю в очередь:", job["filename"])
            report(job["id"], "approved")
            break
        except Exception as e:
            log("ошибка:", e)
            report(job["id"], "error", error=str(e)[:300])


def gen_newest_png():
    """Самый свежий PNG в папке генераций — из него берём параметры прогона."""
    newest, newest_mtime = None, 0.0
    for root, dirs, files in os.walk(WATCH_DIR):
        dirs[:] = [d for d in dirs if d.lower() not in SKIP_DIRS]
        for name in files:
            if not name.lower().endswith(".png"):
                continue
            p = os.path.join(root, name)
            try:
                m = os.path.getmtime(p)
            except OSError:
                continue
            if m > newest_mtime:
                newest, newest_mtime = p, m
    return newest


def gen_parse_params(text):
    """Разбирает строку параметров Automatic1111 из метаданных PNG."""
    lines = [l for l in text.splitlines() if l.strip() != ""]
    if not lines:
        return None
    negative, tail = "", ""
    prompt_lines = []
    for l in lines:
        if l.startswith("Negative prompt:"):
            negative = l.split(":", 1)[1].strip()
        elif l.startswith("Steps:"):
            tail = l
        elif not negative and not tail:
            prompt_lines.append(l)
    payload = {
        "prompt": "\n".join(prompt_lines).strip(),
        "negative_prompt": negative,
        "save_images": True,
    }
    parts = {}
    for chunk in tail.split(","):
        if ":" in chunk:
            k, v = chunk.split(":", 1)
            parts[k.strip().lower()] = v.strip()
    def num(key, cast=int):
        try:
            return cast(parts[key])
        except Exception:
            return None
    if (v := num("steps")) is not None:
        payload["steps"] = v
    if (v := num("cfg scale", float)) is not None:
        payload["cfg_scale"] = v
    if parts.get("sampler"):
        payload["sampler_name"] = parts["sampler"]
    if parts.get("schedule type"):
        payload["scheduler"] = parts["schedule type"]
    size = parts.get("size", "")
    if "x" in size:
        try:
            w, h = size.split("x")
            payload["width"], payload["height"] = int(w), int(h)
        except Exception:
            pass
    payload["seed"] = -1  # каждый перезапуск — новые сиды
    return payload if payload["prompt"] else None


def gen_read_png_parameters(path):
    """Читает параметры A1111 прямо из PNG-метаданных, не декодируя пиксели.

    Это позволяет повторно запускать генерацию даже по очень большим grid PNG,
    которые Pillow блокирует защитой DecompressionBombError.
    """
    with open(path, "rb") as f:
        if f.read(8) != b"\x89PNG\r\n\x1a\n":
            return ""
        while True:
            raw_length = f.read(4)
            if len(raw_length) != 4:
                return ""
            length = struct.unpack(">I", raw_length)[0]
            chunk_type = f.read(4)
            # Метаданные A1111 малы; не загружаем подозрительно огромный chunk в память.
            if length > 64 * 1024 * 1024:
                f.seek(length + 4, os.SEEK_CUR)
                continue
            data = f.read(length)
            f.read(4)  # CRC

            try:
                if chunk_type == b"tEXt":
                    keyword, text = data.split(b"\x00", 1)
                    if keyword == b"parameters":
                        return text.decode("utf-8", errors="replace")
                elif chunk_type == b"zTXt":
                    keyword, compressed = data.split(b"\x00", 1)
                    if keyword == b"parameters" and len(compressed) > 1:
                        return zlib.decompress(compressed[1:]).decode("utf-8", errors="replace")
                elif chunk_type == b"iTXt":
                    keyword, rest = data.split(b"\x00", 1)
                    if keyword == b"parameters" and len(rest) >= 2:
                        compressed = rest[0] == 1
                        rest = rest[2:]  # compression flag + compression method
                        _, rest = rest.split(b"\x00", 1)  # language tag
                        _, text = rest.split(b"\x00", 1)  # translated keyword
                        if compressed:
                            text = zlib.decompress(text)
                        return text.decode("utf-8", errors="replace")
            except (ValueError, zlib.error):
                pass

            if chunk_type == b"IEND":
                return ""


def gen_busy():
    """True, если Automatic1111 сейчас что-то генерирует."""
    r = requests.get(f"{A1111_URL}/sdapi/v1/progress?skip_current_image=true", timeout=15)
    r.raise_for_status()
    data = r.json()
    state = data.get("state") or {}
    return bool(state.get("job_count", 0) > 0 or (data.get("progress") or 0) > 0.001)


_gen_lock = threading.Lock()
_gen_restarts = 0
_gen_browser = {"pw": None, "browser": None, "page": None}


def gen_ui_page():
    """Открывает (один раз) окно браузера с интерфейсом Automatic1111 и возвращает страницу."""
    page = _gen_browser.get("page")
    if page is not None:
        try:
            page.title()
            return page
        except Exception:
            _gen_browser.update({"pw": None, "browser": None, "page": None})

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise RuntimeError(
            "не установлен playwright. Выполните: pip install playwright && python -m playwright install chromium"
        )

    pw = sync_playwright().start()
    browser = pw.chromium.launch(headless=GEN_BROWSER_HEADLESS)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    page.goto(GEN_UI_URL or A1111_URL, wait_until="domcontentloaded", timeout=120000)
    page.wait_for_selector("#txt2img_generate", timeout=120000)
    _gen_browser.update({"pw": pw, "browser": browser, "page": page})
    log("авто-рестарт: открыт интерфейс Automatic1111 в браузере")
    return page


_gen_ui_requests = queue.Queue()
_gen_ui_thread = None


def _gen_ui_worker():
    """Единственный поток, владеющий браузером (Playwright не потокобезопасен)."""
    while True:
        result_box = _gen_ui_requests.get()
        try:
            page = gen_ui_page()
            try:
                page.bring_to_front()
            except Exception:
                pass
            btn = page.locator("#txt2img_generate")
            btn.wait_for(state="visible", timeout=60000)
            btn.click()
            result_box["ok"] = True
        except Exception as e:
            result_box["error"] = str(e)[:300]
        finally:
            result_box["done"].set()


def gen_ui_click_generate():
    """Нажимает кнопку Generate прямо в интерфейсе — со всеми настройками и dynamic prompts."""
    global _gen_ui_thread
    if _gen_ui_thread is None or not _gen_ui_thread.is_alive():
        _gen_ui_thread = threading.Thread(target=_gen_ui_worker, daemon=True)
        _gen_ui_thread.start()

    box = {"done": threading.Event()}
    _gen_ui_requests.put(box)
    if not box["done"].wait(timeout=300):
        raise RuntimeError("браузер не ответил на нажатие Generate")
    if box.get("error"):
        raise RuntimeError(box["error"])

    # ждём, пока интерфейс реально начнёт генерацию
    for _ in range(30):
        time.sleep(2)
        try:
            if gen_busy():
                return True
        except Exception:
            pass
    return True


def gen_pause_and_restart(reason=""):
    """Пауза на апскейл/загрузку, ожидание свободного SD и повторный «Generate»."""
    global _gen_restarts
    if not _gen_lock.acquire(blocking=False):
        return False  # цикл уже запускается другим потоком
    try:
        if GEN_RESTARTS and _gen_restarts >= GEN_RESTARTS:
            return False

        payload = None
        if GEN_MODE != "ui":
            src = gen_newest_png()
            if src:
                try:
                    payload = gen_parse_params(gen_read_png_parameters(src))
                except Exception as e:
                    log("авто-рестарт: не прочитал параметры:", str(e)[:150])
            if not payload:
                log("авто-рестарт: не нашёл параметры последней генерации, жду")
                return False

        if reason:
            log("авто-рестарт:", reason)

        # пауза перед новым циклом: даём агенту апскейлить и залить отобранное
        if GEN_PAUSE_SECONDS > 0:
            log(f"авто-рестарт: пауза {GEN_PAUSE_SECONDS // 60} мин на апскейл и загрузку отобранного")
            waited = 0
            while waited < GEN_PAUSE_SECONDS:
                step = min(15, GEN_PAUSE_SECONDS - waited)
                time.sleep(step)
                waited += step
                if waited % 120 == 0:
                    log(f"авто-рестарт: пауза {waited}/{GEN_PAUSE_SECONDS} сек")

        # Во время паузы очередь может запустить апскейл через тот же A1111 API.
        # Это не новый цикл генерации: просто ждём, пока SD освободится.
        busy_logged = False
        while gen_busy():
            if not busy_logged:
                log("авто-рестарт: пауза закончилась, жду завершения апскейла/задачи SD")
                busy_logged = True
            time.sleep(5)

        _gen_restarts += 1
        if GEN_MODE == "ui":
            log(f"авто-рестарт #{_gen_restarts}: нажимаю Generate в интерфейсе")
            gen_ui_click_generate()
            log(f"авто-рестарт #{_gen_restarts}: генерация запущена из интерфейса")
            return True

        payload["batch_size"] = 1
        payload["n_iter"] = 100  # максимум batch count в интерфейсе
        log(f"авто-рестарт #{_gen_restarts}: запускаю генерацию заново")
        r = requests.post(f"{A1111_URL}/sdapi/v1/txt2img", json=payload, timeout=60 * 60 * 12)
        r.raise_for_status()
        log(f"авто-рестарт #{_gen_restarts}: прогон завершён")
        return True
    except Exception as e:
        log("авто-рестарт: ошибка:", str(e)[:200])
        time.sleep(GEN_RETRY_WAIT)
        return False
    finally:
        _gen_lock.release()


def gen_loop():
    """Ждёт остановки генерации и «нажимает Generate» снова с теми же параметрами."""
    log("авто-рестарт генерации включён")
    idle_since = None
    while GEN_RESTARTS == 0 or _gen_restarts < GEN_RESTARTS:
        try:
            if gen_busy():
                idle_since = None
                time.sleep(5)
                continue
            if idle_since is None:
                idle_since = time.time()
                time.sleep(5)
                continue
            if time.time() - idle_since < GEN_IDLE_SECONDS:
                time.sleep(5)
                continue
            gen_pause_and_restart()
            idle_since = None
        except Exception as e:
            log("авто-рестарт: ошибка:", str(e)[:200])
            time.sleep(GEN_RETRY_WAIT)

    log("авто-рестарт остановлен, перезапусков:", _gen_restarts)


def scan_loop():
    while True:
        try:
            log("сканирую папку outputs на новые изображения")
            scan_and_upload()
            if GEN_ENABLED:
                try:
                    if gen_busy():
                        log("проверка генерации: идёт, всё ок")
                    elif not _gen_lock.locked():
                        log("проверка генерации: остановлена — беру паузу и перезапущу")
                        threading.Thread(
                            target=gen_pause_and_restart,
                            args=("генерация не идёт (проверка при сканировании)",),
                            daemon=True,
                        ).start()
                except Exception as e:
                    log("проверка генерации: ошибка:", str(e)[:150])
        except Exception as e:
            log("ошибка сканирования:", e)
        time.sleep(SCAN_INTERVAL)



def main():
    if "вставьте" in AGENT_TOKEN:
        print("Заполните AGENT_TOKEN в настройках скрипта.")
        sys.exit(1)
    log("агент запущен, папка:", WATCH_DIR)
    if GEN_ENABLED:
        threading.Thread(target=gen_loop, daemon=True).start()
    # сканирование папки идёт своим потоком, чтобы долгий апскейл/загрузка его не тормозили
    threading.Thread(target=scan_loop, daemon=True).start()
    while True:
        try:
            process_queue()
        except Exception as e:
            log("ошибка обработки очереди:", e)
        time.sleep(POLL_INTERVAL)



if __name__ == "__main__":
    main()
