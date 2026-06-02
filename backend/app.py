"""知识星球 SKILL 炼化 Agent — FastAPI 后端"""
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlencode

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

import db
from config import load_config, save_config, DATA_DIR
from models import RefineRequest, LLMConfigUpdate, LLMModelsRequest, LLMTestRequest, ScreenTopicsRequest
from zsxq_client import ZsxqClient, APPID, REDIRECT_URI
from refiner import build_openai_yaml, normalize_batch_concurrency, refine_skill, safe_skill_name, save_skill_file, split_topics_into_batches, summarize_batch, synthesize_skill
from llm_client import call_llm


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="炼化星球 Agent", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── 登录相关 ───────────────────────────────────────────────

login_sessions: dict[str, dict] = {}


@app.post("/api/login/qrcode")
def create_qrcode():
    params = {
        "appid": APPID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": "snsapi_login",
        "fast_login": "1",
        "href": "https://wx.zsxq.com/assets_dweb/files/wechatCode.css",
    }
    url = "https://open.weixin.qq.com/connect/qrconnect?" + urlencode(params)
    r = httpx.get(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://wx.zsxq.com/"}, timeout=10)
    r.raise_for_status()
    m = re.search(r"/connect/qrcode/([A-Za-z0-9]+)", r.text)
    if not m:
        raise HTTPException(500, "无法获取二维码 uuid")
    uuid = m.group(1)
    qr_url = f"https://open.weixin.qq.com/connect/qrcode/{uuid}"

    login_sessions[uuid] = {"status": "pending", "last": ""}

    return {"uuid": uuid, "qr_url": qr_url}


@app.get("/api/login/check/{uuid}")
def check_login(uuid: str):
    """前端每次轮询时，直接向微信做一次短超时 long-poll，返回最新状态"""
    session = login_sessions.get(uuid)
    if not session:
        return {"status": "expired", "error": ""}

    if session["status"] in ("success", "expired", "cancelled", "error"):
        status = session["status"]
        error = session.get("error", "")
        if status == "success":
            login_sessions.pop(uuid, None)
        return {"status": status, "error": error}

    params = {"uuid": uuid}
    if session["last"]:
        params["last"] = session["last"]

    try:
        r = httpx.get(
            "https://lp.open.weixin.qq.com/connect/l/qrconnect",
            params=params,
            headers={"Referer": "https://open.weixin.qq.com/"},
            timeout=5.0,
        )
    except httpx.TimeoutException:
        return {"status": session["status"], "error": ""}
    except Exception:
        return {"status": session["status"], "error": ""}

    err_m = re.search(r"wx_errcode=(\d+)", r.text)
    code_m = re.search(r"wx_code='([^']*)'", r.text)
    errcode = int(err_m.group(1)) if err_m else -1
    wx_code = code_m.group(1) if code_m else ""

    if errcode == 404:
        session["status"] = "scanned"
        session["last"] = str(errcode)
    elif errcode == 405 and wx_code:
        session["status"] = "exchanging"
        try:
            client = ZsxqClient()
            token = client.exchange_token(wx_code)
            client.close()
            db.save_session(token)
            session["status"] = "success"
        except Exception as e:
            session["status"] = "error"
            session["error"] = str(e)
    elif errcode == 402:
        session["status"] = "expired"
    elif errcode == 403:
        session["status"] = "cancelled"
    else:
        session["last"] = str(errcode)

    status = session["status"]
    error = session.get("error", "")
    if status == "success":
        login_sessions.pop(uuid, None)
    return {"status": status, "error": error}


@app.get("/api/login/status")
def login_status():
    token = db.get_session()
    return {"logged_in": token is not None}


@app.post("/api/logout")
def logout():
    conn = db.get_db()
    conn.execute("DELETE FROM sessions")
    conn.commit()
    conn.close()
    return {"ok": True}


# ─── 星球 & 帖子 ────────────────────────────────────────────

def _get_client() -> ZsxqClient:
    token = db.get_session()
    if not token:
        raise HTTPException(401, "未登录，请先扫码登录")
    return ZsxqClient(access_token=token)


@app.get("/api/groups")
def get_groups():
    client = _get_client()
    try:
        groups = client.get_groups()
    finally:
        client.close()
    return {"groups": groups}


@app.get("/api/me")
def get_me():
    client = _get_client()
    try:
        profile = client.get_me()
    finally:
        client.close()
    return {"profile": profile}


@app.get("/api/groups/{group_id}/topics")
def get_topics(group_id: str, count: int = 20, end_time: str = ""):
    client = _get_client()
    try:
        result = client.get_topics(group_id, count=count, end_time=end_time)
        for topic in result["topics"]:
            client.save_topic(topic)
    finally:
        client.close()
    return result


@app.get("/api/files/{file_id}/download_url")
def get_file_download_url(file_id: str):
    client = _get_client()
    try:
        url = client.get_file_download_url(file_id)
    finally:
        client.close()
    return {"download_url": url}


# ─── 帖子筛选 ────────────────────────────────────────────────

SCREEN_SYSTEM_PROMPT = """You are a strict content screening tool for a knowledge-refining agent.

Decide whether each community post should be included in a technical knowledge distillation workflow.

Include only posts that contain reusable knowledge, technical analysis, implementation details, debugging notes, reverse engineering details, code, protocols, algorithms, reproducible steps, or useful attached learning material.

Exclude:
- advertisements, promotion, lead generation, sales, paid service offers, recruitment, contact solicitation
- posts whose main goal is asking people to DM/add WeChat/WhatsApp/QQ
- pure chat, greetings, announcements without technical substance
- very short posts without reusable knowledge
- product/service marketing even if it mentions AI, software, automation, or tools

Return ONLY valid JSON:
{"results":[{"topic_id":"...","include":true,"label":"知识内容","reason":"short Chinese reason"}]}

label must be one of: 知识内容, 疑似广告, 无关内容, 内容不足, 待确认.
When unsure, use include=false and label 待确认."""

SCREEN_LABELS = ("知识内容", "疑似广告", "无关内容", "内容不足", "待确认")


def _extract_json_object(text: str) -> dict:
    raw = text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    match = re.search(r"\{.*\}", raw, re.S)
    if not match:
        raise ValueError("LLM did not return a JSON object")
    return json.loads(match.group(0))


def _normalize_int_range(value, default: int, min_value: int, max_value: int) -> int:
    try:
        next_value = int(value)
    except (TypeError, ValueError):
        next_value = default
    return max(min_value, min(max_value, next_value))


def _adaptive_llm_concurrency(configured: int, total_batches: int) -> int:
    concurrency = min(configured, total_batches)
    if total_batches >= 40:
        return min(concurrency, 2)
    if total_batches >= 16:
        return min(concurrency, 3)
    return concurrency


def _chunk_items(items: list, size: int) -> list[list]:
    return [items[idx:idx + size] for idx in range(0, len(items), size)]


def _topic_screen_payload(topic) -> dict:
    return {
        "topic_id": topic.topic_id,
        "author_name": topic.author_name,
        "create_time": topic.create_time[:10],
        "text": topic.text[:1200],
        "image_count": topic.image_count,
        "file_names": topic.file_names[:8],
    }


def _normalize_screen_results(topics, data: dict) -> list[dict]:
    by_id = {topic.topic_id: topic for topic in topics}
    results = []
    for item in data.get("results", []):
        topic_id = str(item.get("topic_id", ""))
        if topic_id not in by_id:
            continue
        include = bool(item.get("include", False))
        label = str(item.get("label", "知识内容" if include else "待确认"))
        if label not in SCREEN_LABELS:
            label = "知识内容" if include else "待确认"
        results.append({
            "topic_id": topic_id,
            "include": include,
            "label": label,
            "reason": str(item.get("reason", "LLM 判断"))[:160],
        })

    seen = {item["topic_id"] for item in results}
    for topic in topics:
        if topic.topic_id not in seen:
            results.append({
                "topic_id": topic.topic_id,
                "include": False,
                "label": "待确认",
                "reason": "LLM 未返回该帖判断，默认不选",
            })
    return results


def _screen_topic_batch(group_name: str, topics, batch_index: int, total_batches: int) -> list[dict]:
    payload = [_topic_screen_payload(topic) for topic in topics]
    user_msg = (
        f"Community: {group_name or 'unknown'}\n"
        f"Batch: {batch_index}/{total_batches}\n"
        "Screen these posts for a SKILL refining workflow. "
        "Be especially strict about ads/promotions/contact solicitation. "
        "Return one result for every topic_id in the input JSON.\n\n"
        f"{json.dumps({'topics': payload}, ensure_ascii=False)}"
    )
    raw = call_llm(
        SCREEN_SYSTEM_PROMPT,
        user_msg,
        {
            "label": "screen",
            "batch_index": batch_index,
            "total_batches": total_batches,
        },
    )
    data = _extract_json_object(raw)
    return _normalize_screen_results(topics, data)


@app.post("/api/topics/screen")
def screen_topics(req: ScreenTopicsRequest):
    if not req.topics:
        return {"results": [], "batch_count": 0, "batch_size": 20, "concurrency": 1}

    cfg = load_config()
    batch_size = _normalize_int_range(cfg.get("screen_batch_size", 20), 20, 5, 50)
    batches = _chunk_items(req.topics, batch_size)
    total_batches = len(batches)
    concurrency = _adaptive_llm_concurrency(
        _normalize_int_range(cfg.get("screen_batch_concurrency", 2), 2, 1, 8),
        total_batches,
    )

    try:
        batch_results = [[] for _ in batches]
        if concurrency <= 1 or total_batches == 1:
            for idx, batch in enumerate(batches, start=1):
                batch_results[idx - 1] = _screen_topic_batch(req.group_name, batch, idx, total_batches)
        else:
            with ThreadPoolExecutor(max_workers=concurrency) as executor:
                futures = {
                    executor.submit(_screen_topic_batch, req.group_name, batch, idx, total_batches): idx
                    for idx, batch in enumerate(batches, start=1)
                }
                for future in as_completed(futures):
                    idx = futures[future]
                    batch_results[idx - 1] = future.result()
    except Exception as e:
        raise HTTPException(502, f"LLM 筛选失败: {e}") from e

    results = [item for batch in batch_results for item in batch]

    return {
        "results": results,
        "batch_count": total_batches,
        "batch_size": batch_size,
        "concurrency": concurrency,
    }


# ─── 炼化 ───────────────────────────────────────────────────

TEXT_FILE_EXTS = (
    ".txt", ".md", ".markdown", ".py", ".js", ".ts", ".tsx", ".jsx", ".java",
    ".kt", ".go", ".rs", ".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".cs",
    ".php", ".rb", ".swift", ".lua", ".r", ".m", ".sh", ".zsh", ".bash",
    ".bat", ".cmd", ".ps1", ".json", ".jsonl", ".yaml", ".yml", ".toml",
    ".xml", ".html", ".htm", ".css", ".scss", ".less", ".sql", ".ini",
    ".conf", ".cfg", ".properties", ".dockerfile", ".gitignore",
)
SPECIAL_TEXT_NAMES = (
    "dockerfile", "makefile", "readme", "license", ".env.example",
    ".env.sample", ".env.template",
)
ARCHIVE_FILE_EXTS = (".zip", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2")
UNSUPPORTED_ARCHIVE_EXTS = (".rar", ".7z")
BINARY_FILE_EXTS = (
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".png",
    ".jpg", ".jpeg", ".gif", ".webp", ".mp4", ".mp3", ".wav", ".apk",
    ".exe", ".dll", ".so", ".dylib", ".bin",
)
NOISY_DIRS = {
    ".git", "node_modules", "dist", "build", "__pycache__", ".venv", "venv",
    ".next", ".nuxt", ".cache", "target", "coverage",
}
NOISY_FILES = {
    "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "poetry.lock",
    "cargo.lock", "go.sum",
}
MAX_TEXT_FILE_CHARS = 50000
MAX_ARCHIVE_TEXT_CHARS = 240000


def _is_text_name(name: str) -> bool:
    lower = name.lower()
    basename = lower.rsplit("/", 1)[-1]
    return lower.endswith(TEXT_FILE_EXTS) or basename in SPECIAL_TEXT_NAMES


def _is_archive_name(name: str) -> bool:
    return name.lower().endswith(ARCHIVE_FILE_EXTS)


def _is_unsupported_archive_name(name: str) -> bool:
    return name.lower().endswith(UNSUPPORTED_ARCHIVE_EXTS)


def _should_skip_member(name: str) -> bool:
    parts = [p for p in name.replace("\\", "/").split("/") if p]
    if not parts:
        return True
    if any(part in NOISY_DIRS for part in parts):
        return True
    return parts[-1].lower() in NOISY_FILES


def _decode_text(raw: bytes) -> str:
    if b"\x00" in raw[:2048]:
        return ""
    for encoding in ("utf-8", "utf-8-sig", "gbk", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")


def _append_text_result(results: list[dict], name: str, raw: bytes, total_chars: int) -> int:
    text = _decode_text(raw)
    if not text.strip():
        return total_chars
    remaining = max(MAX_ARCHIVE_TEXT_CHARS - total_chars, 0)
    if remaining <= 0:
        return total_chars
    truncated = len(text) > min(MAX_TEXT_FILE_CHARS, remaining)
    content = text[:min(MAX_TEXT_FILE_CHARS, remaining)]
    if truncated:
        content += "\n\n[内容已截断]"
    results.append({"name": name, "content": content})
    return total_chars + len(content)


def _display_zip_name(filename: str) -> str:
    try:
        return filename.encode("cp437").decode("utf-8")
    except (UnicodeDecodeError, UnicodeEncodeError):
        try:
            return filename.encode("cp437").decode("gbk")
        except (UnicodeDecodeError, UnicodeEncodeError):
            return filename


def _extract_text_from_archive(archive_path) -> list[dict]:
    """Extract readable text/source files from zip or tar archives."""
    import tarfile
    import zipfile

    results = []
    total_chars = 0

    if zipfile.is_zipfile(archive_path):
        with zipfile.ZipFile(archive_path, "r") as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                name = _display_zip_name(info.filename)
                if _should_skip_member(name) or not _is_text_name(name):
                    continue
                try:
                    total_chars = _append_text_result(results, name, zf.read(info.filename), total_chars)
                except Exception:
                    continue
                if total_chars >= MAX_ARCHIVE_TEXT_CHARS:
                    break
        return results

    if tarfile.is_tarfile(archive_path):
        with tarfile.open(archive_path, "r:*") as tf:
            for member in tf.getmembers():
                if not member.isfile():
                    continue
                name = member.name
                if _should_skip_member(name) or not _is_text_name(name):
                    continue
                file_obj = tf.extractfile(member)
                if not file_obj:
                    continue
                try:
                    total_chars = _append_text_result(results, name, file_obj.read(MAX_TEXT_FILE_CHARS + 1), total_chars)
                except Exception:
                    continue
                if total_chars >= MAX_ARCHIVE_TEXT_CHARS:
                    break
    return results


def _read_text_attachment(path, name: str) -> str:
    raw = path.read_bytes()
    text = _decode_text(raw)
    if len(text) > MAX_TEXT_FILE_CHARS:
        return text[:MAX_TEXT_FILE_CHARS] + "\n\n[内容已截断]"
    return text


def _collect_file_contents(client: ZsxqClient, topic: dict, emit=None) -> list[dict]:
    def notify(event_type: str, message: str):
        if emit:
            emit(event_type, message)

    file_contents = []
    for f in topic.get("files", []):
        name = f["name"]
        try:
            if _is_text_name(name):
                notify("log", f"下载可读文件: {name}")
                path = client.download_file(f["file_id"], name)
                content = _read_text_attachment(path, name)
                if content.strip():
                    file_contents.append({"name": name, "content": content})
                notify("log", f"读取成功: {name} ({len(content)} chars)")
            elif _is_archive_name(name):
                notify("step", f"解析压缩包: {name}")
                path = client.download_file(f["file_id"], name)
                extracted = _extract_text_from_archive(path)
                file_contents.extend(extracted)
                if extracted:
                    notify("log", f"压缩包提取 {len(extracted)} 个可读文件: {name}")
                    for ef in extracted[:8]:
                        notify("log", f"提取文件: {ef['name']} ({len(ef['content'])} chars)")
                    if len(extracted) > 8:
                        notify("log", f"另有 {len(extracted) - 8} 个文件已提取，日志已折叠省略")
                else:
                    notify("log", f"压缩包内没有可参与炼化的文本/源码文件: {name}")
            elif _is_unsupported_archive_name(name):
                notify("log", f"暂不解析 {name}，rar/7z 需要额外本地依赖，本次已跳过")
            elif name.lower().endswith(BINARY_FILE_EXTS):
                notify("log", f"跳过二进制附件: {name}")
            else:
                notify("log", f"跳过未知附件类型: {name}")
        except Exception as e:
            notify("log", f"附件处理失败: {name} — {e}")
    return file_contents


def _unique_topic_ids(topic_ids: list[str]) -> list[str]:
    seen = set()
    unique_ids = []
    for topic_id in topic_ids:
        if topic_id in seen:
            continue
        seen.add(topic_id)
        unique_ids.append(topic_id)
    return unique_ids


def _load_topics_with_files(req: RefineRequest, emit=None) -> list[dict]:
    client = _get_client()
    topics = []
    try:
        for tid in _unique_topic_ids(req.topic_ids):
            topic = client.load_topic(tid)
            if not topic:
                topic = client.get_topic_detail(tid)
                if topic:
                    client.save_topic(topic)
            if not topic:
                if emit:
                    emit("log", f"帖子 {tid} 加载失败，跳过")
                continue
            if emit:
                preview = topic.get("text", "").replace("\n", " ")[:48]
                emit("log", f"已加载帖子: {topic.get('author_name', '')} - {preview}...")
            topic["file_contents"] = _collect_file_contents(client, topic, emit)
            topics.append(topic)
    finally:
        client.close()
    return topics


def _save_refine_artifacts(req: RefineRequest, file_path, emit=None):
    from pathlib import Path
    import shutil

    def notify(event_type: str, message: str):
        if emit:
            emit(event_type, message)

    def clear_dir(path):
        if not path.exists():
            return 0
        removed = 0
        for item in path.iterdir():
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink(missing_ok=True)
            removed += 1
        return removed

    skill_file = Path(file_path)
    if req.save_mode == "permanent":
        ts = time.strftime("%Y%m%d_%H%M%S")
        save_dir = DATA_DIR / f"{req.group_name}-{ts}"
        save_dir.mkdir(parents=True, exist_ok=True)
        topics_dir = DATA_DIR / "topics"
        for tid in req.topic_ids:
            src = topics_dir / f"{tid}.json"
            if src.exists():
                shutil.copy2(src, save_dir / f"{tid}.json")
        attach_dir = DATA_DIR / "attachments"
        if attach_dir.exists():
            for f in attach_dir.iterdir():
                if f.is_file():
                    shutil.copy2(f, save_dir / f.name)
        if skill_file.is_file() and skill_file.name == "SKILL.md":
            shutil.copytree(skill_file.parent, save_dir / skill_file.parent.name, dirs_exist_ok=True)
        elif skill_file.exists():
            shutil.copy2(skill_file, save_dir / skill_file.name)
        notify("log", f"永久保存到: {save_dir.name}/")

    if load_config().get("keep_topics_after_refine", False):
        notify("log", "已按配置保留临时帖子和附件")
    else:
        removed_topics = clear_dir(DATA_DIR / "topics")
        removed_attachments = clear_dir(DATA_DIR / "attachments")
        notify("log", f"已清理临时缓存: topics {removed_topics} 项, attachments {removed_attachments} 项")


@app.post("/api/refine/stream")
def refine_stream(req: RefineRequest):
    """SSE streaming refine — sends process events first, final markdown at completion."""
    import json
    from fastapi.responses import StreamingResponse

    def generate():
        def send(event_type: str, data: dict):
            return f"data: {json.dumps({'type': event_type, **data}, ensure_ascii=False)}\n\n"

        def emit(event_type: str, message: str):
            return send(event_type, {"message": message})

        if not db.get_session():
            yield send("error", {"message": "未登录"})
            return

        try:
            topic_ids = _unique_topic_ids(req.topic_ids)
            duplicate_count = len(req.topic_ids) - len(topic_ids)
            yield emit("step", f"读取 {len(topic_ids)} 条帖子和附件")
            if duplicate_count:
                yield emit("log", f"已去重 {duplicate_count} 条重复帖子，避免重复炼化")
            client = _get_client()
            topics = []
            failed_topics = 0
            attached_topics = 0
            extracted_files = 0
            extracted_chars = 0
            try:
                total_topic_ids = len(topic_ids)
                for idx, tid in enumerate(topic_ids, start=1):
                    topic = client.load_topic(tid)
                    if not topic:
                        topic = client.get_topic_detail(tid)
                        if topic:
                            client.save_topic(topic)
                    if not topic:
                        failed_topics += 1
                        continue

                    topic["file_contents"] = _collect_file_contents(
                        client,
                        topic,
                        None,
                    )
                    if topic.get("files"):
                        attached_topics += 1
                    extracted_files += len(topic["file_contents"])
                    extracted_chars += sum(len(fc.get("content", "")) for fc in topic["file_contents"])
                    topics.append(topic)
                    if idx % 20 == 0 or idx == total_topic_ids:
                        yield emit(
                            "log",
                            f"读取进度 {idx}/{total_topic_ids}: 有效 {len(topics)} 条，附件文本 {extracted_files} 个",
                        )
            finally:
                client.close()

            if not topics:
                yield send("error", {"message": "没有找到有效的帖子内容"})
                return

            yield emit(
                "step",
                f"读取完成: 有效 {len(topics)} 条，失败 {failed_topics} 条，含附件帖子 {attached_topics} 条，提取文本/源码 {extracted_files} 个 ({extracted_chars} chars)",
            )
            yield emit("step", "开始规划炼化批次")

            existing_path = None
            existing_version = 0
            if req.skill_id:
                skill = db.get_skill(req.skill_id)
                if skill:
                    existing_path = skill["file_path"]
                    existing_version = skill["version"]
                    yield emit("log", f"将基于已有 SKILL v{existing_version} 迭代")

            batches = split_topics_into_batches(topics)
            total_batches = len(batches)
            if total_batches > 1:
                yield emit("step", f"内容较长，已拆分为 {total_batches} 批中间摘要")

            cfg = load_config()
            concurrency = _adaptive_llm_concurrency(
                normalize_batch_concurrency(cfg.get("refine_batch_concurrency", 2)),
                total_batches,
            )
            if total_batches > 1 and concurrency > 1:
                yield emit("step", f"并发生成中间摘要: {total_batches} 批 / 并发 {concurrency}")

            batch_summaries = [""] * total_batches
            if concurrency <= 1 or total_batches == 1:
                for batch_idx, batch in enumerate(batches, start=1):
                    yield send("step", {
                        "message": f"生成第 {batch_idx}/{total_batches} 批中间摘要",
                        "batch_index": batch_idx,
                        "total_batches": total_batches,
                    })
                    summary = summarize_batch(req.group_name, batch, batch_idx, total_batches)
                    batch_summaries[batch_idx - 1] = summary
                    yield send("batch_summary", {
                        "message": f"第 {batch_idx} 批摘要完成",
                        "batch_index": batch_idx,
                        "total_batches": total_batches,
                        "completed_batches": batch_idx,
                        "summary": summary,
                    })
            else:
                executor = ThreadPoolExecutor(max_workers=concurrency)
                shutdown_wait = True
                try:
                    futures = {}
                    for batch_idx, batch in enumerate(batches, start=1):
                        futures[executor.submit(summarize_batch, req.group_name, batch, batch_idx, total_batches)] = batch_idx

                    completed_batches = 0
                    ready_summaries = {}
                    next_emit_batch = 1
                    for future in as_completed(futures):
                        batch_idx = futures[future]
                        try:
                            summary = future.result()
                        except Exception as e:
                            for pending in futures:
                                pending.cancel()
                            shutdown_wait = False
                            yield send("error", {"message": f"第 {batch_idx} 批摘要失败: {e}"})
                            return
                        batch_summaries[batch_idx - 1] = summary
                        ready_summaries[batch_idx] = summary
                        completed_batches += 1

                        while total_batches <= 10 and next_emit_batch in ready_summaries:
                            ready_summaries.pop(next_emit_batch)
                            yield send("batch_summary", {
                                "message": f"第 {next_emit_batch} 批摘要完成",
                                "batch_index": next_emit_batch,
                                "total_batches": total_batches,
                                "completed_batches": next_emit_batch,
                                "summary": "",
                            })
                            next_emit_batch += 1

                        if total_batches > 10 and (completed_batches % 5 == 0 or completed_batches == total_batches):
                            yield send("step", {
                                "message": f"中间摘要进度 {completed_batches}/{total_batches}",
                                "batch_index": completed_batches,
                                "total_batches": total_batches,
                            })
                finally:
                    executor.shutdown(wait=shutdown_wait, cancel_futures=not shutdown_wait)

            yield emit("step", "综合所有摘要，生成最终 SKILL.md")
            synthesize_events = []
            ai_name, skill_content = synthesize_skill(
                group_name=req.group_name,
                batch_summaries=batch_summaries,
                title=req.title or "",
                existing_skill_path=existing_path,
                existing_version=existing_version,
                source_topic_count=len(topics),
                on_progress=lambda message: synthesize_events.append(message),
            )
            for message in synthesize_events:
                yield emit("step", message)

            title = req.title or ai_name or f"{req.group_name}_skill_{int(time.time())}"
            file_path = save_skill_file(skill_content, title)
            from pathlib import Path
            skill_content = Path(file_path).read_text(encoding="utf-8")
            references_dir = Path(file_path).parent / "references"
            reference_files = sorted(p.name for p in references_dir.glob("*.md")) if references_dir.exists() else []
            if reference_files:
                yield emit("log", f"已拆分引用文档: {', '.join(reference_files)}")
            new_version = existing_version + 1
            skill_id = db.create_skill(
                group_id=req.group_id,
                group_name=req.group_name,
                title=title,
                file_path=file_path,
                topic_ids=req.topic_ids,
                version=new_version,
            )

            yield send("final", {"content": skill_content, "title": title})

            cleanup_events = []
            _save_refine_artifacts(req, file_path, lambda event_type, message: cleanup_events.append((event_type, message)))
            for event_type, message in cleanup_events:
                yield emit(event_type, message)

            yield send("done", {"skill_id": skill_id, "title": title, "version": new_version})
        except Exception as e:
            yield send("error", {"message": f"炼化失败: {e}"})

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/api/refine")
def refine(req: RefineRequest):
    """Non-streaming refine (kept for backward compat)"""
    topics = _load_topics_with_files(req)

    if not topics:
        raise HTTPException(400, "没有找到有效的帖子内容")

    existing_path = None
    existing_version = 0
    if req.skill_id:
        skill = db.get_skill(req.skill_id)
        if skill:
            existing_path = skill["file_path"]
            existing_version = skill["version"]

    title = req.title or ""
    skill_content, file_path, final_title = refine_skill(
        group_id=req.group_id,
        group_name=req.group_name,
        topics=topics,
        title=title,
        existing_skill_path=existing_path,
        existing_version=existing_version,
    )

    new_version = existing_version + 1
    skill_id = db.create_skill(
        group_id=req.group_id,
        group_name=req.group_name,
        title=final_title,
        file_path=file_path,
        topic_ids=req.topic_ids,
        version=new_version,
    )

    _save_refine_artifacts(req, file_path)

    return {
        "skill_id": skill_id,
        "version": new_version,
        "file_path": file_path,
        "content": skill_content,
    }


# ─── SKILL 管理 ─────────────────────────────────────────────

@app.get("/api/skills")
def list_skills(group_id: str = ""):
    skills = db.get_skills(group_id or None)
    return {"skills": skills}


@app.get("/api/skills/{skill_id}")
def get_skill_detail(skill_id: int):
    skill = db.get_skill(skill_id)
    if not skill:
        raise HTTPException(404, "SKILL 不存在")
    from pathlib import Path
    fp = Path(skill["file_path"])
    content = fp.read_text(encoding="utf-8") if fp.exists() else ""
    skill["content"] = content
    return skill


@app.get("/api/skills/{skill_id}/download")
def download_skill_package(skill_id: int):
    import io
    import zipfile
    from pathlib import Path
    from fastapi.responses import Response

    skill = db.get_skill(skill_id)
    if not skill:
        raise HTTPException(404, "SKILL 不存在")

    fp = Path(skill["file_path"])
    if fp.is_dir():
        skill_md = fp / "SKILL.md"
        skill_dir = fp
    elif fp.is_file():
        skill_md = fp
        skill_dir = fp.parent
    else:
        raise HTTPException(404, "SKILL 文件不存在")

    content = skill_md.read_text(encoding="utf-8") if skill_md.exists() else ""
    if not content:
        raise HTTPException(404, "SKILL 文件内容为空")

    safe_name = safe_skill_name(skill["title"]).lower()
    openai_yaml = skill_dir / "agents" / "openai.yaml"
    yaml_content = (
        openai_yaml.read_text(encoding="utf-8")
        if openai_yaml.exists()
        else build_openai_yaml(content, skill["title"])
    )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        root = safe_name
        zf.writestr(f"{root}/SKILL.md", content)
        zf.writestr(f"{root}/agents/openai.yaml", yaml_content)
        references_dir = skill_dir / "references"
        if references_dir.exists():
            for ref_file in references_dir.rglob("*"):
                if ref_file.is_file():
                    rel_path = ref_file.relative_to(skill_dir).as_posix()
                    zf.write(ref_file, f"{root}/{rel_path}")
    buf.seek(0)

    headers = {"Content-Disposition": f'attachment; filename="{safe_name}.zip"'}
    return Response(buf.getvalue(), media_type="application/zip", headers=headers)


@app.delete("/api/skills/{skill_id}")
def delete_skill(skill_id: int):
    ok = db.delete_skill(skill_id)
    if not ok:
        raise HTTPException(404, "SKILL 不存在")
    return {"ok": True}


# ─── 配置 ───────────────────────────────────────────────────

def _merge_llm_config(update: LLMConfigUpdate) -> dict:
    cfg = load_config()
    for k, v in update.model_dump(exclude_none=True).items():
        if k.endswith("_api_key") and v == "***":
            continue
        if k == "refine_batch_concurrency":
            cfg[k] = normalize_batch_concurrency(v)
            continue
        if k == "screen_batch_size":
            cfg[k] = _normalize_int_range(v, 20, 5, 50)
            continue
        if k == "screen_batch_concurrency":
            cfg[k] = _normalize_int_range(v, 2, 1, 8)
            continue
        if k == "llm_retry_attempts":
            cfg[k] = _normalize_int_range(v, 2, 1, 4)
            continue
        cfg[k] = v
    return cfg


def _api_url(base_url: str, path: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/v1"):
        return f"{base}{path}"
    return f"{base}/v1{path}"


def _active_llm_settings(cfg: dict, require_model: bool = True) -> tuple[str, str, str, str]:
    provider = cfg.get("llm_provider", "anthropic")
    if provider == "anthropic":
        base_url = (cfg.get("anthropic_base_url") or "").rstrip("/")
        api_key = cfg.get("anthropic_api_key") or ""
        model = cfg.get("anthropic_model") or ""
        label = "Anthropic"
    else:
        base_url = (cfg.get("openai_base_url") or "").rstrip("/")
        api_key = cfg.get("openai_api_key") or ""
        model = cfg.get("openai_model") or ""
        label = "OpenAI"

    missing = []
    if not base_url:
        missing.append("Base URL")
    if not api_key:
        missing.append("API Key")
    if require_model and not model:
        missing.append("Model")
    if missing:
        raise HTTPException(400, f"请先填写 {label} " + "、".join(missing))
    return provider, base_url, api_key, model


def _model_urls(base_url: str, provider: str) -> list[str]:
    base = base_url.rstrip("/")
    primary = _api_url(base, "/models")
    urls = [primary]
    # OpenAI-compatible proxy services such as NewAPI/sub2api normally expose
    # /v1/models. A plain /models fallback covers a few older adapters without
    # surfacing unrelated dashboard API paths to the user.
    if provider == "openai":
        urls.append(f"{base}/models")
    elif base.endswith("/v1"):
        urls.append(f"{base[:-3]}/models")
    return list(dict.fromkeys(urls))


@app.get("/api/config")
def get_config():
    cfg = load_config()
    safe = {k: v for k, v in cfg.items() if "key" not in k}
    safe["anthropic_api_key"] = "***" if cfg.get("anthropic_api_key") else ""
    safe["openai_api_key"] = "***" if cfg.get("openai_api_key") else ""
    return safe


@app.post("/api/config")
def update_config(update: LLMConfigUpdate):
    cfg = _merge_llm_config(update)
    save_config(cfg)
    return {"ok": True}


@app.post("/api/config/models")
def list_llm_models(update: LLMModelsRequest):
    cfg = _merge_llm_config(update)
    provider, base_url, api_key, _model = _active_llm_settings(cfg, require_model=False)

    header_candidates = []
    if provider == "anthropic":
        header_candidates.extend([
            {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            {
                "Authorization": f"Bearer {api_key}",
                "anthropic-version": "2023-06-01",
            },
        ])
    else:
        header_candidates.append({"Authorization": f"Bearer {api_key}"})

    attempts = []
    data = None
    for url in _model_urls(base_url, provider):
        for headers in header_candidates:
            try:
                r = httpx.get(url, headers=headers, timeout=20.0)
                r.raise_for_status()
                data = r.json()
                break
            except httpx.HTTPStatusError as e:
                detail = e.response.text[:300] if e.response is not None else str(e)
                status = e.response.status_code if e.response is not None else "?"
                attempts.append(f"{url} -> HTTP {status}: {detail}")
            except Exception as e:
                attempts.append(f"{url} -> {e}")
        if data is not None:
            break

    if data is None:
        tried = "；".join(attempts[:4])
        hint = "如果中转站没有开放模型列表接口，可以手动填写模型名后点击测试连接。"
        raise HTTPException(502, f"模型列表获取失败。{hint} 已尝试: {tried}")

    raw_models = data.get("data") if isinstance(data, dict) else None
    if raw_models is None and isinstance(data, dict):
        raw_models = data.get("models")
    if raw_models is None:
        raw_models = []

    models = []
    for item in raw_models:
        if isinstance(item, str):
            model_id = item
        elif isinstance(item, dict):
            model_id = str(item.get("id") or item.get("name") or item.get("model") or item.get("model_name") or "")
        else:
            model_id = ""
        if model_id:
            models.append(model_id)

    models = sorted(set(models))
    return {"models": models}


@app.post("/api/config/test")
def test_llm_config(update: LLMTestRequest):
    cfg = _merge_llm_config(update)
    provider, base_url, api_key, model = _active_llm_settings(cfg)

    if provider == "anthropic":
        url = _api_url(base_url, "/messages")
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        body = {
            "model": model,
            "max_tokens": 16,
            "temperature": 0,
            "messages": [{"role": "user", "content": "Reply with OK only."}],
        }
    else:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        if cfg.get("openai_api_mode", "responses") == "responses":
            url = _api_url(base_url, "/responses")
            body = {
                "model": model,
                "input": "Reply with OK only.",
                "max_output_tokens": 16,
            }
        else:
            url = _api_url(base_url, "/chat/completions")
            body = {
                "model": model,
                "max_tokens": 16,
                "temperature": 0,
                "messages": [{"role": "user", "content": "Reply with OK only."}],
            }

    try:
        r = httpx.post(url, json=body, headers=headers, timeout=45.0)
        r.raise_for_status()
        data = r.json()
    except httpx.HTTPStatusError as e:
        detail = e.response.text[:400] if e.response is not None else str(e)
        status = e.response.status_code if e.response is not None else "?"
        raise HTTPException(502, f"模型测试失败: HTTP {status}: {detail}") from e
    except Exception as e:
        raise HTTPException(502, f"模型测试失败: {e}") from e

    if provider == "anthropic":
        message = ""
        for block in data.get("content", []):
            if block.get("type") == "text":
                message = block.get("text", "")
                break
    else:
        if cfg.get("openai_api_mode", "responses") == "responses":
            message = data.get("output_text", "")
            if not message:
                parts = []
                for item in data.get("output", []):
                    for content in item.get("content", []):
                        if content.get("type") in ("output_text", "text"):
                            parts.append(str(content.get("text", "")))
                message = "".join(parts)
        else:
            choices = data.get("choices", [])
            message = choices[0].get("message", {}).get("content", "") if choices else ""

    return {"ok": True, "message": (message or "OK").strip()[:200]}


# ─── 健康检查 ───────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "time": int(time.time())}


# ─── 生产环境前端静态资源 ─────────────────────────────────────

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


if FRONTEND_DIST.exists():
    @app.get("/{path:path}", include_in_schema=False)
    def serve_frontend(path: str = ""):
        if path.startswith("api/"):
            raise HTTPException(404, "API 不存在")
        requested = (FRONTEND_DIST / path).resolve()
        dist_root = FRONTEND_DIST.resolve()
        if requested.is_file() and requested.is_relative_to(dist_root):
            return FileResponse(requested)
        return FileResponse(dist_root / "index.html")
