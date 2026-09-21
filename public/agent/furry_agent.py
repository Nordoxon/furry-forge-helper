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
import subprocess
import sys
import tempfile

import time
import threading
import webbrowser
import zipfile
import zlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlencode, urlparse, parse_qs

try:
    import requests
    from PIL import Image
except ImportError as _e:
    print("Не хватает библиотек:", _e)
    print("Выполните в командной строке:  pip install requests pillow")
    try:
        input("\nНажмите Enter, чтобы закрыть окно...")
    except Exception:
        pass
    raise SystemExit(1)


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
# Путь к webui-user.bat: если Stable Diffusion не отвечает, агент сам его запустит.
# Пусто = искать автоматически рядом с папкой генераций. Пример: r"D:\stable-diffusion-webui\webui-user.bat"
A1111_LAUNCH_BAT = ""
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
GEN_RESTARTS = 0              # сколько раз перезапустить (0 — бесконечно)
GEN_IDLE_SECONDS = 15         # сколько секунд простоя считать «остановилось»
GEN_RETRY_WAIT = 30           # пауза перед повтором при ошибке
GEN_MAX_ERRORS = 5            # после скольких ошибок подряд остановиться
GEN_PAUSE_SECONDS = 0         # паузы больше нет: генерацией управляет сайт (кнопки «Пауза»/«Начать»)
GEN_PHASE_CHECK = 30          # как часто (сек) спрашивать сайт про этап отбора

# ── НОВЫЙ РЕЖИМ: ОЧЕРЕДЬ ЧЕРЕЗ FORGE API (одно изображение = одно задание) ──
# Агент не трогает браузер: берёт с сайта задание, вызывает txt2img напрямую
# и просит следующее только после успешной загрузки результата.
# Старые режимы (attach/hotkey/ui/api) остаются как запасной вариант.
FORGE_QUEUE = False           # True — включить надёжный режим очереди
FORGE_API_URL = ""            # пусто = A1111_URL (Forge нужно запускать с --api)
FORGE_JOB_TIMEOUT = 1800      # максимум ожидания ответа txt2img (сек)
FORGE_UPLOAD_RETRIES = 12     # попыток отправить готовый кадр на сайт
FORGE_UPLOAD_WAIT = 20        # пауза между попытками отправки (сек)
FORGE_IDLE_WAIT = 20          # пауза, когда сайт заданий не даёт (сек)
FORGE_ERROR_WAIT = 30         # пауза после ошибки генерации (сек)
FORGE_HEARTBEAT = 30          # как часто подтверждать сайту, что задание живо (сек)




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
    """Загружаем файл в Sta.sh с нужным именем (без папок — прямо в корень)."""
    token = da_token()

    title = job.get("asset_name") or job.get("title") or os.path.splitext(os.path.basename(path))[0]
    tpl = job.get("template") or {}
    stack = ""

    data = {
        "title": title,
        "artist_comments": job.get("description", ""),
    }


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
        return False

    if not jobs:
        return False
    log(f"получено заданий на апскейл: {len(jobs)}")
    _pack_busy.set()  # пока идёт работа по паку — не забираем новые генерации

    for job in jobs:
        log("обработка:", job["filename"], "->", job.get("asset_name", ""))
        try:
            src = job["local_path"]
            if not os.path.exists(src):
                report(job["id"], "error", error="файл не найден на компьютере")
                continue
            asset = job.get("asset_name") or os.path.splitext(job["filename"])[0]
            big = upscale(src, asset, heartbeat=lambda: report(job["id"], "upscaling"))
            if not job.get("upload_to_da"):
                # обычное изображение пака: только апскейл, дальше пойдёт в zip
                report(job["id"], "ready")
                log("готово (в архив):", os.path.basename(big))
                continue
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

    return True


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


_sd_offline_since = [0.0]
_sd_launch_attempted = [0.0]
_sd_last_notice = [0.0]
_sd_bat_cache = [None]


def sd_find_bat():
    """Находит webui-user.bat: сначала настройка, потом папки рядом с WATCH_DIR, потом типовые пути."""
    if _sd_bat_cache[0] is not None:
        return _sd_bat_cache[0]

    cands = []
    if A1111_LAUNCH_BAT:
        cands.append(A1111_LAUNCH_BAT)

    # outputs -> корень webui (поднимаемся на несколько уровней вверх)
    d = os.path.abspath(WATCH_DIR)
    for _ in range(4):
        cands.append(os.path.join(d, "webui-user.bat"))
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent

    for drive in ("C:", "D:", "E:"):
        for name in ("stable-diffusion-webui", "stable-diffusion-webui-master", "stable-diffusion",
                     "stable-diffusion-webui-forge", "sd"):
            cands.append(os.path.join(drive + os.sep, name, "webui-user.bat"))

    for c in cands:
        try:
            if c and os.path.isfile(c):
                _sd_bat_cache[0] = os.path.abspath(c)
                return _sd_bat_cache[0]
        except OSError:
            pass
    _sd_bat_cache[0] = ""
    return ""


def sd_try_launch():
    """Если Stable Diffusion не отвечает — сам запускает webui-user.bat и ждёт готовности."""
    bat = sd_find_bat()
    if not bat:
        log("Stable Diffusion не запущен, а webui-user.bat не найден — "
            "укажите путь в строке A1111_LAUNCH_BAT вверху файла")
        return False
    now = time.time()
    if now - _sd_launch_attempted[0] < 600:  # не чаще раза в 10 минут
        return False
    _sd_launch_attempted[0] = now
    log("Stable Diffusion не отвечает — запускаю сам:", bat)
    try:
        bat_dir = os.path.dirname(bat)
        subprocess.Popen(
            [bat], cwd=bat_dir,
            creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0),
        )
    except Exception as e:
        log("не удалось запустить Stable Diffusion:", str(e)[:150])
        return False
    # SD стартует долго (модели грузятся) — ждём до 10 минут
    for _ in range(150):
        time.sleep(4)
        try:
            r = requests.get(f"{A1111_URL}/sdapi/v1/progress?skip_current_image=true", timeout=15)
            if r.ok:
                log("Stable Diffusion запустился и отвечает")
                return True
        except requests.exceptions.RequestException:
            pass
    log("Stable Diffusion за 10 минут не поднялся — жду дальше")
    return False


def gen_busy_safe():
    """gen_busy(), но без падений: возвращает None, если Stable Diffusion недоступен."""
    try:
        busy = gen_busy()
        if _sd_offline_since[0]:
            log("Stable Diffusion снова на связи")
            _sd_offline_since[0] = 0.0
            _sd_last_notice[0] = 0.0
        return busy
    except requests.exceptions.RequestException:
        now = time.time()
        if not _sd_offline_since[0]:
            _sd_offline_since[0] = now
        if now - _sd_last_notice[0] > 120:
            _sd_last_notice[0] = now
            log(f"Stable Diffusion не отвечает на {A1111_URL} — генерация не идёт")
        if now - _sd_offline_since[0] > 30:
            sd_try_launch()
        return None


_gen_lock = threading.Lock()
_gen_restarts = 0
_gen_browser = {"pw": None, "browser": None, "page": None}


def _gen_pw():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise RuntimeError(
            "не установлен playwright. Выполните: pip install playwright && python -m playwright install chromium"
        )
    pw = _gen_browser.get("pw")
    if pw is None:
        pw = sync_playwright().start()
        _gen_browser["pw"] = pw
    return pw


def _gen_chrome_exe():
    cands = [
        os.path.join(os.environ.get("PROGRAMFILES", r"C:\Program Files"), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(os.environ.get("PROGRAMFILES", r"C:\Program Files"), "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"), "Microsoft", "Edge", "Application", "msedge.exe"),
    ]
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None


def _gen_cdp_ready(timeout=25):
    end = time.time() + timeout
    while time.time() < end:
        try:
            requests.get(f"{GEN_CDP_URL}/json/version", timeout=2).raise_for_status()
            return True
        except Exception:
            time.sleep(1)
    return False


def _gen_launch_chrome():
    """Сам запускает отдельное окно браузера с отладочным портом и вкладкой A1111."""
    exe = _gen_chrome_exe()
    if not exe:
        return False
    profile = os.path.join(tempfile.gettempdir(), "sd-agent-profile")
    port = urlparse(GEN_CDP_URL).port or 9222
    target = GEN_UI_URL or A1111_URL
    try:
        subprocess.Popen(
            [exe, f"--remote-debugging-port={port}", f"--user-data-dir={profile}",
             "--no-first-run", "--no-default-browser-check", target],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception:
        return False
    log("авто-рестарт: открываю отдельное окно браузера с отладочным портом")
    return _gen_cdp_ready()


def gen_attach_page():
    """Находит УЖЕ ОТКРЫТУЮ вкладку с интерфейсом Automatic1111 через отладочный порт."""
    pw = _gen_pw()
    try:
        browser = pw.chromium.connect_over_cdp(GEN_CDP_URL, timeout=15000)
    except Exception as e:
        if _gen_launch_chrome():
            try:
                browser = pw.chromium.connect_over_cdp(GEN_CDP_URL, timeout=20000)
            except Exception as e2:
                raise RuntimeError("не подключился к браузеру: " + str(e2)[:120])
        else:
            raise RuntimeError(
                "не подключился к открытому браузеру ("
                + str(e)[:120]
                + "). Закройте ВСЕ окна Chrome и запустите его заново командой: "
                'chrome.exe --remote-debugging-port=9222 --user-data-dir="%TEMP%\\sd-agent-profile"'
            )

    target = (GEN_UI_URL or A1111_URL).rstrip("/")
    host = urlparse(target).netloc
    for ctx in browser.contexts:
        for page in ctx.pages:
            try:
                url = page.url or ""
            except Exception:
                continue
            if host and host in url and page.locator("#txt2img_generate").count() > 0:
                _gen_browser.update({"browser": browser, "page": page})
                return page
    # вкладки с интерфейсом нет — открываем её сами в подключённом браузере
    try:
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        page = ctx.new_page()
        page.goto(target, wait_until="domcontentloaded", timeout=120000)
        page.wait_for_selector("#txt2img_generate", timeout=120000)
        _gen_browser.update({"browser": browser, "page": page})
        log("авто-рестарт: открыл вкладку Automatic1111 в подключённом браузере")
        return page
    except Exception as e:
        raise RuntimeError(
            f"не смог открыть вкладку с интерфейсом Automatic1111 ({target}): {str(e)[:120]}"
        )



def gen_ui_page():
    """Возвращает страницу с интерфейсом A1111: уже открытую (attach) или своё окно (ui)."""
    page = _gen_browser.get("page")
    if page is not None:
        try:
            page.title()
            return page
        except Exception:
            _gen_browser.update({"browser": None, "page": None})

    if GEN_MODE == "attach":
        page = gen_attach_page()
        log("авто-рестарт: подключился к открытой вкладке Automatic1111")
        return page

    pw = _gen_pw()
    browser = pw.chromium.launch(headless=GEN_BROWSER_HEADLESS)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    page.goto(GEN_UI_URL or A1111_URL, wait_until="domcontentloaded", timeout=120000)
    page.wait_for_selector("#txt2img_generate", timeout=120000)
    _gen_browser.update({"browser": browser, "page": page})
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
            gen_apply_prompt(page, _gen_prompts.get("prompt") or "")
            gen_apply_negative_prompt(page, _gen_prompts.get("negative_prompt") or "")
            gen_apply_settings(page, _gen_prompts.get("settings") or {})
            _st = _gen_prompts.get("settings") or {}
            log(
                "настройки с сайта подставлены:",
                f"фаза={_gen_prompts.get('phase') or '-'}",
                f"{_st.get('width')}x{_st.get('height')}",
                f"steps={_st.get('steps')} cfg={_st.get('cfg_scale')}",
                f"sampler={_st.get('sampler_name')} style={_st.get('style') or '-'}",
            )
            btn = page.locator("#txt2img_generate")
            btn.wait_for(state="visible", timeout=60000)
            btn.click()
            result_box["ok"] = True
        except Exception as e:
            result_box["error"] = str(e)[:300]
        finally:
            result_box["done"].set()


def gen_hotkey_click_generate():
    """Активирует окно браузера и жмёт Ctrl+Enter — горячую клавишу Generate в A1111."""
    try:
        import pyautogui
    except ImportError:
        raise RuntimeError("не установлен pyautogui. Выполните: pip install pyautogui pygetwindow")
    try:
        import pygetwindow as gw

        wins = [w for w in gw.getAllWindows() if GEN_WINDOW_TITLE.lower() in (w.title or "").lower()]
        if not wins:
            raise RuntimeError(
                f"не нашёл окно браузера с заголовком «{GEN_WINDOW_TITLE}» — откройте вкладку A1111"
            )
        win = wins[0]
        try:
            if win.isMinimized:
                win.restore()
            win.activate()
        except Exception:
            pass
        time.sleep(1.5)
    except ImportError:
        log("авто-рестарт: pygetwindow не установлен — жму по активному окну")
    pyautogui.hotkey("ctrl", "enter")
    return True


def gen_ui_click_generate():
    """Нажимает Generate в уже открытом интерфейсе — со всеми настройками и dynamic prompts."""
    global _gen_ui_thread
    if GEN_MODE == "hotkey":
        return gen_hotkey_click_generate()

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


_gen_prompts = {"sfw": "", "nsfw": "", "phase": "", "character": ""}
_gen_running_phase = ""  # этап, под который сейчас идёт генерация



def site_gen_plan():
    """Спрашивает у сайта: какая сейчас фаза, какой промпт и нужно ли ещё генерировать."""
    try:
        r = requests.post(f"{API_BASE}/api/public/agent/gen", headers=HEADERS, data="{}", timeout=60)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log("промпт с сайта недоступен:", str(e)[:150])
        return None


def gen_apply_prompt(page, prompt):
    """Подставляет промпт с сайта в поле txt2img интерфейса A1111."""
    if not prompt:
        return
    try:
        box = page.locator("#txt2img_prompt textarea").first
        box.wait_for(state="visible", timeout=30000)
        box.fill(prompt)
        log("промпт с сайта подставлен в интерфейс")
    except Exception as e:
        log("не подставил промпт:", str(e)[:150])

def gen_apply_negative_prompt(page, negative_prompt):
    """Подставляет негативный промпт с сайта в поле txt2img_neg_prompt."""
    if negative_prompt in (None, ""):
        return
    try:
        box = page.locator("#txt2img_neg_prompt textarea").first
        if box.count() == 0:
            return
        box.wait_for(state="visible", timeout=30000)
        box.fill(negative_prompt)
        log("негативный промпт с сайта подставлен в интерфейс")
    except Exception as e:
        log("не подставил негативный промпт:", str(e)[:150])

def _ui_set_number(page, selector, value):
    if value in (None, ""):
        return
    box = page.locator(selector).first
    if box.count() == 0:
        return
    box.fill(str(value))
    box.press("Tab")


def gen_apply_settings(page, settings):
    """Подставляет разрешение, CFG, шаги, сэмплер, batch count и стиль персонажа."""
    if not settings:
        return
    try:
        _ui_set_number(page, "#txt2img_width input[type=number]", settings.get("width"))
        _ui_set_number(page, "#txt2img_height input[type=number]", settings.get("height"))
        _ui_set_number(page, "#txt2img_cfg_scale input[type=number]", settings.get("cfg_scale"))
        _ui_set_number(page, "#txt2img_steps input[type=number]", settings.get("steps"))
        _ui_set_number(page, "#txt2img_batch_count input[type=number]", settings.get("batch_count"))

        sampler = settings.get("sampler_name")
        if sampler:
            for sel in ("#txt2img_sampling input", "#txt2img_sampling select"):
                node = page.locator(sel).first
                if node.count() == 0:
                    continue
                try:
                    node.fill(str(sampler))
                    node.press("Enter")
                except Exception:
                    node.select_option(label=str(sampler))
                break

        style = settings.get("style")
        if style:
            gen_apply_style(page, str(style))
        log("настройки генерации с сайта применены в интерфейсе")
    except Exception as e:
        log("не применил настройки генерации:", str(e)[:150])


def _style_selected(page, style):
    """Проверяет, что стиль реально выбран в поле Styles."""
    try:
        txt = page.locator("#txt2img_styles").first.inner_text(timeout=3000)
    except Exception:
        return False
    return style.lower() in (txt or "").lower()


def gen_apply_style(page, style):
    """Выбирает стиль (styles.csv) в Forge/A1111: поле — мультиселект, его нужно
    открыть, очистить старые токены и выбрать пункт из выпадающего списка."""
    for attempt in range(3):
        try:
            if _style_selected(page, style):
                if attempt:
                    log("стиль выбран:", style)
                return True

            box = page.locator("#txt2img_styles").first
            if box.count() == 0:
                log("поле Styles не найдено в интерфейсе")
                return False

            # убираем ранее выбранные стили, чтобы не смешивать промпты
            for _ in range(10):
                rm = box.locator(".token-remove, .remove, li.token .token-remove").first
                if rm.count() == 0:
                    break
                rm.click()
                page.wait_for_timeout(100)

            inp = box.locator("input").first
            inp.click()
            page.wait_for_timeout(200)
            try:
                inp.fill("")
            except Exception:
                pass
            inp.type(style, delay=25)
            page.wait_for_timeout(500)

            # выбираем именно пункт списка, а не просто Enter по тексту
            opt = page.locator("ul.options li, .options .item, li[role=option]").filter(
                has_text=style
            ).first
            if opt.count() > 0:
                opt.click()
            else:
                inp.press("Enter")
            page.wait_for_timeout(400)
            inp.press("Escape")
            page.wait_for_timeout(200)

            if _style_selected(page, style):
                log("стиль выбран:", style)
                return True
        except Exception as e:
            log("стиль: попытка", attempt + 1, "не удалась:", str(e)[:120])
        page.wait_for_timeout(600)
    log("не удалось выбрать стиль:", style, "— проверьте, что он есть в styles.csv")
    return False





def upload_pack_file(pack_id, file_path, name=None, content_type="application/zip"):
    """Заливает файл пака (архив, превью, обложку) в облако — скачивается с телефона."""
    payload = {"pack_id": pack_id}
    if name:
        payload["name"] = name
    r = requests.post(
        f"{API_BASE}/api/public/agent/zip",
        headers=HEADERS,
        data=json.dumps(payload),
        timeout=60,
    )
    r.raise_for_status()
    info = r.json()
    with open(file_path, "rb") as fh:
        up = requests.put(
            info["upload_url"],
            data=fh,
            headers={"content-type": content_type},
            timeout=60 * 60,
        )
    up.raise_for_status()
    return info["path"]


def upload_pack_zip(pack_id, zip_path):
    return upload_pack_file(pack_id, zip_path)



def gen_interrupt(reason=""):
    """Останавливает текущую генерацию в Stable Diffusion."""
    try:
        requests.post(f"{A1111_URL}/sdapi/v1/interrupt", timeout=15)
        log("генерация остановлена" + (f": {reason}" if reason else ""))
        for _ in range(20):
            time.sleep(2)
            if not gen_busy_safe():
                break
        return True
    except Exception as e:
        log("не удалось остановить генерацию:", str(e)[:150])
        return False


def gen_pause_and_restart(reason="", force_now=False):
    """Пауза на апскейл/загрузку, ожидание свободного SD и повторный «Generate»."""
    global _gen_restarts
    if not _gen_lock.acquire(blocking=False):
        return False  # цикл уже запускается другим потоком
    try:

        if GEN_RESTARTS and _gen_restarts >= GEN_RESTARTS:
            return False

        payload = None
        if GEN_MODE == "api":
            src = gen_newest_png()
            if src:
                try:
                    payload = gen_parse_params(gen_read_png_parameters(src))
                except Exception as e:
                    log("авто-рестарт: не прочитал параметры:", str(e)[:150])
            if not payload:
                log("авто-рестарт: не нашёл параметры последней генерации, жду")
                return False

        plan = site_gen_plan()
        skip_pause = False
        if plan is not None:
            try:
                skip_pause = int(plan.get("pending") or 0) == 0
            except Exception:
                skip_pause = False
            _gen_prompts["prompt"] = plan.get("prompt") or ""
            _gen_prompts["negative_prompt"] = plan.get("negative_prompt") or ""
            _gen_prompts["phase"] = plan.get("phase") or ""
            _gen_prompts["character"] = plan.get("character") or ""
            _gen_prompts["settings"] = plan.get("settings") or {}
            if not plan.get("generate"):
                log("авто-рестарт: сайт говорит не генерировать —", plan.get("reason") or "этап закрыт")
                return False
            if not (_gen_prompts["prompt"] or "").strip():
                log(
                    f"авто-рестарт: нет промпта для персонажа {_gen_prompts['character'] or '-'} "
                    f"на этапе {_gen_prompts['phase'] or '-'} — жду"
                )
                return False
            log(
                f"промпт с сайта: персонаж {_gen_prompts['character'] or '-'}, "
                f"этап {_gen_prompts['phase'] or '-'}"
            )
            _s = _gen_prompts["settings"]

            if _s:
                payload = payload or {}
                payload["prompt"] = _gen_prompts["prompt"] or payload.get("prompt", "")
                payload["negative_prompt"] = _gen_prompts.get("negative_prompt") or payload.get("negative_prompt", "")
                payload["width"] = _s.get("width", payload.get("width"))
                payload["height"] = _s.get("height", payload.get("height"))
                payload["cfg_scale"] = _s.get("cfg_scale", payload.get("cfg_scale"))
                payload["steps"] = _s.get("steps", payload.get("steps"))
                payload["sampler_name"] = _s.get("sampler_name", payload.get("sampler_name"))
                if _s.get("style"):
                    payload["styles"] = [_s["style"]]
            if not plan.get("generate"):
                log("сайт говорит: генерация не нужна (" + str(plan.get("phase") or "нет задачи") + ")")
                return False
            log(f"этап {plan.get('phase')}: отобрано {plan.get('done')}/{plan.get('target')}")

        if reason:
            log("авто-рестарт:", reason)

        # пауза перед новым циклом: даём агенту апскейлить и залить отобранное
        if force_now:
            log("авто-рестарт: этап сменился — запускаю новый промпт сразу, без паузы")
        elif skip_pause:
            log("авто-рестарт: отобранных кадров нет — паузу пропускаю, запускаю генерацию сразу")

        elif GEN_PAUSE_SECONDS > 0:
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
        while gen_busy_safe():
            if not busy_logged:
                log("авто-рестарт: пауза закончилась, жду завершения апскейла/задачи SD")
                busy_logged = True
            time.sleep(5)

        _gen_restarts += 1
        global _gen_running_phase
        _gen_running_phase = f"{_gen_prompts.get('character') or ''}:{_gen_prompts.get('phase') or ''}"
        if GEN_MODE != "api":
            log(
                f"авто-рестарт #{_gen_restarts}: нажимаю Generate в интерфейсе "
                f"({_gen_prompts.get('character') or '-'} / этап {_gen_prompts.get('phase') or '-'})"
            )
            gen_ui_click_generate()


            # ждём, пока интерфейс реально начнёт генерацию
            started = False
            for _ in range(30):
                time.sleep(2)
                try:
                    if gen_busy():
                        started = True
                        break
                except Exception:
                    pass
            log(
                f"авто-рестарт #{_gen_restarts}: "
                + ("генерация запущена из интерфейса" if started else "нажал Generate, генерация пока не видна")
            )
            return True

        payload["batch_size"] = 1
        payload["n_iter"] = int((_gen_prompts.get("settings") or {}).get("batch_count") or 100)
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


def phase_watch_loop():
    """Следит за этапом отбора на сайте: останавливает генерацию, когда категория набрана,
    и сразу перезапускает её с промптом следующего этапа."""
    global _gen_running_phase
    log("контроль этапов отбора включён")
    while True:
        try:
            plan = site_gen_plan()
            if plan is None:
                time.sleep(GEN_PHASE_CHECK)
                continue
            phase = plan.get("phase") or ""
            character = plan.get("character") or ""
            key = f"{character}:{phase}"
            want = bool(plan.get("generate"))
            busy = gen_busy_safe()
            if busy is None:
                time.sleep(GEN_PHASE_CHECK)
                continue

            if busy and not want:
                gen_interrupt(f"{character or '-'} / этап {phase or '-'} закрыт, нужное количество набрано")
                _gen_running_phase = ""
            elif busy and _gen_running_phase and phase and key != _gen_running_phase:
                gen_interrupt(f"сменился персонаж/этап на {character or '-'} / {phase} — меняю промпт")
                _gen_running_phase = ""
                if not _gen_lock.locked():
                    threading.Thread(
                        target=gen_pause_and_restart,
                        args=(f"новый промпт: {character or '-'} / {phase}",),
                        kwargs={"force_now": True},
                        daemon=True,
                    ).start()
            elif not busy and want and not _gen_lock.locked():
                threading.Thread(
                    target=gen_pause_and_restart,
                    args=(
                        f"{character or '-'} / этап {phase}: набрано "
                        f"{plan.get('done')}/{plan.get('target')} — продолжаю генерацию",
                    ),
                    kwargs={"force_now": key != _gen_running_phase},
                    daemon=True,
                ).start()

        except Exception as e:
            log("контроль этапов: ошибка:", str(e)[:150])
        time.sleep(GEN_PHASE_CHECK)


def gen_loop():

    """Ждёт остановки генерации и «нажимает Generate» снова с теми же параметрами."""
    log("авто-рестарт генерации включён")
    idle_since = None
    while GEN_RESTARTS == 0 or _gen_restarts < GEN_RESTARTS:
        try:
            busy = gen_busy_safe()
            if busy is None:
                idle_since = None
                time.sleep(GEN_RETRY_WAIT)
                continue
            if busy:
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
            if _pack_busy.is_set():
                log("идёт сборка пака — новые изображения пока не забираю")
            else:
                log("сканирую папку outputs на новые изображения")
                scan_and_upload()
            # перезапуском генерации управляет только сайт (phase_watch_loop)
        except Exception as e:
            log("ошибка сканирования:", e)
        time.sleep(SCAN_INTERVAL)



PACKS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "packs")

# пока идёт сборка пака (апскейл + zip + обложка) новые генерации не забираем
_pack_busy = threading.Event()


def _safe_name(text):
    keep = "-_() "
    out = "".join(c for c in str(text) if c.isalnum() or c in keep).strip()
    return out or "pack"


COVER_FOLDER = ""  # стек на DA для обложек; пусто — как у превью


def make_cover(src, caption, title, out_path):
    """Обложка из одного кадра: картинка + надпись «8 SFW + 23 NSFW images»."""
    from PIL import Image, ImageDraw, ImageFont

    W, H = 1600, 2048
    base = Image.open(src).convert("RGB")
    scale = max(W / base.width, H / base.height)
    base = base.resize((int(base.width * scale), int(base.height * scale)), Image.LANCZOS)
    canvas = base.crop(
        (
            (base.width - W) // 2,
            (base.height - H) // 2,
            (base.width - W) // 2 + W,
            (base.height - H) // 2 + H,
        )
    )
    shade = Image.new("RGBA", (W, int(H * 0.35)), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    for y in range(shade.height):
        sd.line([(0, y), (W, y)], fill=(0, 0, 0, int(225 * y / shade.height)))
    canvas = canvas.convert("RGBA")
    canvas.alpha_composite(shade, (0, H - shade.height))
    canvas = canvas.convert("RGB")

    draw = ImageDraw.Draw(canvas)

    def font(size):
        for name in ("arialbd.ttf", "arial.ttf", "DejaVuSans-Bold.ttf"):
            try:
                return ImageFont.truetype(name, size)
            except Exception:
                continue
        return ImageFont.load_default()

    def centered(text, f, y, fill):
        if not text:
            return
        box = draw.textbbox((0, 0), text, font=f)
        draw.text(((W - (box[2] - box[0])) / 2, y), text, font=f, fill=fill)

    centered(title, font(80), H - 330, (235, 235, 235))
    centered(caption, font(130), H - 210, (255, 255, 255))
    canvas.save(out_path, "PNG")
    return out_path


def process_packs():
    """Собирает zip-архив для паков, у которых все изображения уже отапскейлены."""
    try:
        r = requests.post(f"{API_BASE}/api/public/agent/packs", headers=HEADERS, data="{}", timeout=120)
        r.raise_for_status()
        packs = r.json().get("packs", [])
    except Exception as e:
        log("паки недоступны:", e)
        return False

    if not packs:
        return False
    _pack_busy.set()

    for pack in packs:
        try:
            os.makedirs(PACKS_DIR, exist_ok=True)
            label = _safe_name(pack.get("title") or pack["id"][:8])
            zip_path = os.path.join(PACKS_DIR, f"{label}.zip")
            added = 0
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for idx, f in enumerate(pack.get("files", []), start=1):
                    asset = f.get("asset_name") or os.path.splitext(f.get("filename", ""))[0]
                    disk = f.get("output_name") or asset
                    src = os.path.join(UPSCALED_DIR, str(disk) + ".png")
                    if not os.path.exists(src):
                        src = os.path.join(UPSCALED_DIR, str(asset) + ".png")
                    if not os.path.exists(src):
                        continue
                    # нумерация внутри пака всегда с единицы
                    zf.write(src, arcname=f"{label}_{idx:03d}.png")
                    added += 1
            log(f"пак «{label}»: {added} изображений -> {zip_path}")

            preview_paths = []
            cover = pack.get("cover") or {}
            cover_asset = cover.get("asset_name") or os.path.splitext(cover.get("filename", ""))[0]
            cover_disk = cover.get("output_name") or cover_asset
            cover_src = os.path.join(UPSCALED_DIR, str(cover_disk) + ".png") if cover_disk else ""
            if cover_src and not os.path.exists(cover_src):
                cover_src = os.path.join(UPSCALED_DIR, str(cover_asset) + ".png")
            if cover_src and os.path.exists(cover_src):
                try:
                    cover_path = make_cover(
                        cover_src,
                        pack.get("caption") or "",
                        pack.get("title") or "",
                        os.path.join(PACKS_DIR, f"{label}_cover.png"),
                    )
                    log("обложка:", cover_path)
                    try:
                        preview_paths.append(
                            upload_pack_file(
                                pack["id"], cover_path, name=f"{label}_cover.png", content_type="image/png"
                            )
                        )
                    except Exception as e:
                        log("обложка не залилась в облако:", str(e)[:200])
                    da_publish(
                        cover_path,
                        {
                            "asset_name": f"{pack.get('title') or label} cover",
                            "description": pack.get("caption") or "",
                            "tags": [],
                            "gallery_folder": "",
                            "is_mature": False,
                        },
                    )
                    log("обложка загружена на DeviantArt")
                except Exception as e:
                    log("обложка: ошибка:", str(e)[:200])

            # превью пака — рядом с архивом, чтобы скачать их с телефона
            for pidx, f in enumerate(
                [x for x in pack.get("files", []) if x.get("is_preview")], start=1
            ):
                asset = f.get("asset_name") or os.path.splitext(f.get("filename", ""))[0]
                disk = f.get("output_name") or asset
                src = os.path.join(UPSCALED_DIR, str(disk) + ".png")
                if not os.path.exists(src):
                    src = os.path.join(UPSCALED_DIR, str(asset) + ".png")
                if not os.path.exists(src):
                    continue
                try:
                    preview_paths.append(
                        upload_pack_file(
                            pack["id"], src, name=f"{label}_preview_{pidx:02d}.png", content_type="image/png"
                        )
                    )
                except Exception as e:
                    log("превью не залилось в облако:", str(e)[:150])
            if preview_paths:
                log(f"превью в облаке: {len(preview_paths)} — можно скачать с телефона")

            # архив остаётся на компьютере, в облако уходят только превью
            log("архив сохранён на компьютере:", zip_path)
            requests.post(
                f"{API_BASE}/api/public/agent/packs",
                headers=HEADERS,
                data=json.dumps(
                    {
                        "pack_id": pack["id"],
                        "zip_path": None,
                        "zip_local": zip_path,
                        "preview_paths": preview_paths,
                    }
                ),
                timeout=60,
            )

        except Exception as e:
            log("ошибка сборки пака:", str(e)[:200])

    return True


# ───────── очередь через Forge API: одно задание = одно изображение ─────────
FORGE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "generated")


def forge_base():
    return (FORGE_API_URL or A1111_URL).rstrip("/")


def forge_pending():
    return STATE.setdefault("forge_pending", {})


def forge_job_status(job_id, status, error=None, seed=None):
    """Сообщает сайту текущее состояние задания."""
    body = {"generation_job_id": job_id, "status": status}
    if error is not None:
        body["error"] = str(error)[:500]
    if seed is not None:
        body["seed"] = seed
    try:
        r = requests.post(
            f"{API_BASE}/api/public/agent/job/status",
            headers=HEADERS,
            data=json.dumps(body),
            timeout=60,
        )
        r.raise_for_status()
        return True
    except Exception as e:
        log("не сообщил состояние задания:", str(e)[:150])
        return False


def forge_claim_job():
    """Берёт с сайта ровно одно задание (или то же самое, если оно не доведено до конца)."""
    try:
        r = requests.post(
            f"{API_BASE}/api/public/agent/job/claim",
            headers=HEADERS,
            data=json.dumps({"worker": os.environ.get("COMPUTERNAME") or "agent"}),
            timeout=60,
        )
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log("очередь недоступна:", str(e)[:150])
        return None


def forge_txt2img(job):
    """Одна генерация через Forge API. Возвращает (путь к файлу, фактический seed, настройки)."""
    s = job.get("settings") or {}
    payload = {
        "prompt": job.get("prompt") or "",
        "negative_prompt": job.get("negative_prompt") or "",
        "width": int(s.get("width") or 832),
        "height": int(s.get("height") or 1216),
        "steps": int(s.get("steps") or 28),
        "cfg_scale": float(s.get("cfg_scale") or 5),
        "sampler_name": s.get("sampler_name") or "Euler a",
        # в режиме очереди всегда ровно одно изображение за запрос
        "batch_size": 1,
        "n_iter": 1,
        "send_images": True,
        "save_images": False,
    }
    if s.get("seed") not in (None, ""):
        payload["seed"] = int(s["seed"])
    if s.get("style"):
        payload["styles"] = [s["style"]]

    r = requests.post(f"{forge_base()}/sdapi/v1/txt2img", json=payload, timeout=FORGE_JOB_TIMEOUT)
    r.raise_for_status()
    data = r.json()
    images = data.get("images") or []
    if not images:
        raise RuntimeError("Forge вернул пустой ответ без изображения")

    # фактический seed берём из ответа, а не из запроса (-1 означал «случайный»)
    seed = None
    info = {}
    try:
        info = json.loads(data.get("info") or "{}")
        seeds = info.get("all_seeds") or []
        seed = int(seeds[0]) if seeds else int(info.get("seed"))
    except Exception:
        seed = None

    os.makedirs(FORGE_DIR, exist_ok=True)
    path = os.path.join(FORGE_DIR, f"{job['generation_job_id']}.png")
    with open(path, "wb") as f:
        f.write(base64.b64decode(images[0].split(",", 1)[-1]))

    settings = dict(payload)
    settings.pop("send_images", None)
    settings.pop("save_images", None)
    settings["seed"] = seed
    settings["phase"] = job.get("phase")
    if info.get("infotexts"):
        settings["infotext"] = str(info["infotexts"][0])[:2000]
    return path, seed, settings


def forge_send_result(job_id, entry):
    """Отправляет готовый кадр на сайт. Повторяется, пока не получит подтверждение."""
    path = entry.get("path")
    if not path or not os.path.exists(path):
        return False
    b64, w, h = make_preview(path)
    payload = {
        "files": [
            {
                "filename": os.path.basename(path),
                "local_path": path,
                "width": w,
                "height": h,
                "preview_b64": b64,
                "seed": entry.get("seed"),
                "prompt": entry.get("prompt"),
                "negative_prompt": entry.get("negative_prompt"),
                "generation_job_id": job_id,
                "generation_settings": entry.get("settings"),
            }
        ]
    }
    r = requests.post(
        f"{API_BASE}/api/public/agent/ingest",
        headers=HEADERS,
        data=json.dumps(payload),
        timeout=300,
    )
    r.raise_for_status()
    res = r.json()
    acks = res.get("acks") or []
    ok = any(a.get("generation_job_id") == job_id for a in acks)
    if ok:
        log("кадр принят сайтом" + (" (повтор, дубликат не создан)" if acks[0].get("duplicate") else ""))
    return ok


def forge_flush_pending():
    """Досылает кадры, которые уже сгенерированы, но не были приняты сайтом."""
    pending = forge_pending()
    for job_id in list(pending.keys()):
        entry = pending[job_id]
        try:
            if forge_send_result(job_id, entry):
                forge_job_status(job_id, "COMPLETED", seed=entry.get("seed"))
                pending.pop(job_id, None)
                save_state(STATE)
            else:
                return False
        except Exception as e:
            log("повторная отправка кадра не удалась:", str(e)[:150])
            return False
    return True


def forge_queue_loop():
    """Строго последовательный цикл: задание → генерация → загрузка → подтверждение → следующее."""
    log("режим очереди Forge API включён:", forge_base())
    idle_logged = False
    while True:
        try:
            # незавершённые загрузки важнее новых заданий — заново не генерируем
            if not forge_flush_pending():
                time.sleep(FORGE_UPLOAD_WAIT)
                continue

            res = forge_claim_job()
            if not res:
                time.sleep(FORGE_ERROR_WAIT)
                continue
            job = res.get("job")
            if not job:
                if not idle_logged:
                    log("заданий нет:", res.get("reason") or res.get("phase") or "этап закрыт")
                    idle_logged = True
                time.sleep(FORGE_IDLE_WAIT)
                continue
            idle_logged = False

            job_id = job["generation_job_id"]
            log(
                f"задание {job_id[:8]} — этап {job.get('phase')}"
                + (" (продолжаю прерванное)" if job.get("resume") else "")
            )
            forge_job_status(job_id, "GENERATING")
            try:
                path, seed, settings = forge_txt2img(job)
            except Exception as e:
                log("генерация не удалась:", str(e)[:200])
                forge_job_status(job_id, "FAILED", error=e)
                time.sleep(FORGE_ERROR_WAIT)
                continue

            entry = {
                "path": path,
                "seed": seed,
                "prompt": job.get("prompt"),
                "negative_prompt": job.get("negative_prompt"),
                "settings": settings,
            }
            forge_pending()[job_id] = entry
            save_state(STATE)
            forge_job_status(job_id, "UPLOADING", seed=seed)

            sent = False
            for attempt in range(1, FORGE_UPLOAD_RETRIES + 1):
                try:
                    sent = forge_send_result(job_id, entry)
                except Exception as e:
                    log(f"отправка кадра, попытка {attempt}:", str(e)[:150])
                if sent:
                    break
                time.sleep(FORGE_UPLOAD_WAIT)

            if sent:
                forge_job_status(job_id, "COMPLETED", seed=seed)
                forge_pending().pop(job_id, None)
                save_state(STATE)
            else:
                # кадр сохранён на диске и будет дослан позже, повторная генерация не нужна
                log("сайт не принял кадр — оставляю его на диске и повторю отправку")
                time.sleep(FORGE_UPLOAD_WAIT)
        except Exception as e:
            log("очередь: ошибка:", str(e)[:200])
            time.sleep(FORGE_ERROR_WAIT)


def preflight():
    """Понятные сообщения вместо мгновенного закрытия окна."""
    problems = []
    if "вставьте" in AGENT_TOKEN or not AGENT_TOKEN.strip():
        problems.append("Не заполнен AGENT_TOKEN — скопируйте ключ со страницы «Агент» на сайте.")
    if "your-app" in API_BASE or not API_BASE.startswith("http"):
        problems.append("Не заполнен API_BASE — вставьте адрес вашего сайта.")
    if not os.path.isdir(WATCH_DIR):
        problems.append(f"Папка с генерациями не найдена: {WATCH_DIR}")
    return problems


def main():
    problems = preflight()
    if problems:
        print("\nСкрипт не может стартовать:\n")
        for p in problems:
            print("  •", p)
        print("\nОткройте furry_agent.py в блокноте и поправьте блок НАСТРОЙКИ вверху файла.")
        raise SystemExit(1)

    log("агент запущен, папка:", WATCH_DIR)
    if FORGE_QUEUE:
        # новый режим: генерация напрямую через Forge API, по одному заданию
        threading.Thread(target=forge_queue_loop, daemon=True).start()
    else:
        if GEN_ENABLED:
            # генерацией управляет сайт: старт/пауза/смена этапа
            threading.Thread(target=phase_watch_loop, daemon=True).start()

        # сканирование папки идёт своим потоком, чтобы долгий апскейл/загрузка его не тормозили
        threading.Thread(target=scan_loop, daemon=True).start()
    while True:
        try:
            busy = process_queue()
            busy = process_packs() or busy
            if not busy:
                _pack_busy.clear()
        except Exception as e:
            log("ошибка обработки очереди:", e)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nОстановлено вручную.")
    except SystemExit:
        pass
    except Exception:
        import traceback

        print("\n=== Скрипт остановился из-за ошибки ===")
        traceback.print_exc()
    finally:
        # окно не закрывается мгновенно — ошибку видно
        try:
            input("\nНажмите Enter, чтобы закрыть окно...")
        except Exception:
            pass

