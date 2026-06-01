"""LLM client — supports Anthropic and OpenAI protocols, both blocking and streaming"""
from collections.abc import Generator
import json
import time

import httpx

from config import DATA_DIR, load_config


LLM_LOG_PATH = DATA_DIR / "logs" / "llm_calls.log"


def _with_api_path(base_url: str, path: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/v1"):
        return f"{base}{path}"
    return f"{base}/v1{path}"


def _log_llm(event: str, data: dict) -> None:
    try:
        LLM_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        record = {"ts": time.strftime("%Y-%m-%d %H:%M:%S"), "event": event, **data}
        with open(LLM_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _context_label(context: dict | None) -> str:
    if not context:
        return "unknown"
    label = str(context.get("label") or "llm")
    batch_index = context.get("batch_index")
    total_batches = context.get("total_batches")
    if batch_index and total_batches:
        return f"{label} {batch_index}/{total_batches}"
    return label


def _should_retry(error: Exception) -> bool:
    if isinstance(error, httpx.HTTPStatusError):
        status = error.response.status_code
        return status == 429 or status >= 500
    return isinstance(error, (httpx.TimeoutException, httpx.TransportError, ValueError))


def _json_response(response: httpx.Response, context: dict | None = None) -> dict:
    try:
        return response.json()
    except ValueError as e:
        preview = response.text.strip().replace("\n", " ")[:240]
        detail = preview or "empty response"
        _log_llm("json_error", {
            "context": _context_label(context),
            "status_code": response.status_code,
            "content_type": response.headers.get("content-type", ""),
            "response_preview": detail,
        })
        raise ValueError(f"模型网关返回了非 JSON/空响应: {detail}") from e


def _post_json(url: str, body: dict, headers: dict, timeout: float, context: dict | None = None) -> dict:
    started = time.time()
    try:
        response = httpx.post(url, json=body, headers=headers, timeout=timeout)
        elapsed_ms = int((time.time() - started) * 1000)
        preview = response.text.strip().replace("\n", " ")[:240] if response.status_code >= 400 else ""
        _log_llm("http", {
            "context": _context_label(context),
            "url_path": "/" + url.split("/", 3)[-1] if "://" in url else url,
            "status_code": response.status_code,
            "elapsed_ms": elapsed_ms,
            "content_type": response.headers.get("content-type", ""),
            "response_preview": preview,
        })
        response.raise_for_status()
        return _json_response(response, context)
    except Exception as e:
        elapsed_ms = int((time.time() - started) * 1000)
        _log_llm("exception", {
            "context": _context_label(context),
            "elapsed_ms": elapsed_ms,
            "error_type": type(e).__name__,
            "error": str(e)[:300],
        })
        raise


def call_llm(system_prompt: str, user_message: str, context: dict | None = None) -> str:
    cfg = load_config()
    provider = cfg["llm_provider"]
    model = cfg.get("anthropic_model") if provider == "anthropic" else cfg.get("openai_model")

    attempts = max(1, int(cfg.get("llm_retry_attempts", 2) or 2))
    for attempt in range(attempts):
        _log_llm("start", {
            "context": _context_label(context),
            "attempt": attempt + 1,
            "provider": provider,
            "model": model,
            "openai_api_mode": cfg.get("openai_api_mode", ""),
            "system_chars": len(system_prompt),
            "user_chars": len(user_message),
        })
        try:
            if provider == "anthropic":
                result = _call_anthropic(cfg, system_prompt, user_message, context)
            else:
                result = _call_openai(cfg, system_prompt, user_message, context)
            if not result.strip():
                raise ValueError("模型返回了空内容，可能是中转站限流或上游响应异常")
            _log_llm("success", {
                "context": _context_label(context),
                "attempt": attempt + 1,
                "output_chars": len(result),
            })
            return result
        except Exception as e:
            _log_llm("failure", {
                "context": _context_label(context),
                "attempt": attempt + 1,
                "error_type": type(e).__name__,
                "error": str(e)[:300],
                "will_retry": attempt < attempts - 1 and _should_retry(e),
            })
            if attempt >= attempts - 1 or not _should_retry(e):
                raise
            time.sleep(1.2 * (attempt + 1))
    return ""



def call_llm_stream(system_prompt: str, user_message: str) -> Generator[str, None, None]:
    cfg = load_config()
    provider = cfg["llm_provider"]

    if provider == "anthropic":
        yield from _stream_anthropic(cfg, system_prompt, user_message)
    else:
        yield from _stream_openai(cfg, system_prompt, user_message)


def _call_anthropic(cfg: dict, system_prompt: str, user_message: str, context: dict | None = None) -> str:
    url = _with_api_path(cfg["anthropic_base_url"], "/messages")
    headers = {
        "x-api-key": cfg["anthropic_api_key"],
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body = {
        "model": cfg["anthropic_model"],
        "max_tokens": 8192,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_message}],
    }
    data = _post_json(url, body, headers, 120.0, context)
    for block in data.get("content", []):
        if block.get("type") == "text":
            return block["text"]
    return ""


def _stream_anthropic(cfg: dict, system_prompt: str, user_message: str) -> Generator[str, None, None]:
    url = _with_api_path(cfg["anthropic_base_url"], "/messages")
    headers = {
        "x-api-key": cfg["anthropic_api_key"],
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body = {
        "model": cfg["anthropic_model"],
        "max_tokens": 8192,
        "stream": True,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_message}],
    }
    with httpx.stream("POST", url, json=body, headers=headers, timeout=180.0) as r:
        r.raise_for_status()
        for line in r.iter_lines():
            if line.startswith("data: "):
                import json
                try:
                    event = json.loads(line[6:])
                except (json.JSONDecodeError, ValueError):
                    continue
                if event.get("type") == "content_block_delta":
                    delta = event.get("delta", {})
                    if delta.get("type") == "text_delta":
                        yield delta["text"]


def _call_openai(cfg: dict, system_prompt: str, user_message: str, context: dict | None = None) -> str:
    if cfg.get("openai_api_mode", "responses") == "responses":
        return _call_openai_responses(cfg, system_prompt, user_message, context)

    url = _with_api_path(cfg["openai_base_url"], "/chat/completions")
    headers = {
        "Authorization": f"Bearer {cfg['openai_api_key']}",
        "Content-Type": "application/json",
    }
    body = {
        "model": cfg["openai_model"],
        "max_tokens": 8192,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
    }
    data = _post_json(url, body, headers, 120.0, context)
    return data["choices"][0]["message"]["content"]


def _call_openai_responses(cfg: dict, system_prompt: str, user_message: str, context: dict | None = None) -> str:
    url = _with_api_path(cfg["openai_base_url"], "/responses")
    headers = {
        "Authorization": f"Bearer {cfg['openai_api_key']}",
        "Content-Type": "application/json",
    }
    body = {
        "model": cfg["openai_model"],
        "instructions": system_prompt,
        "input": user_message,
        "max_output_tokens": 8192,
    }
    return _extract_openai_response_text(_post_json(url, body, headers, 120.0, context))


def _extract_openai_response_text(data: dict) -> str:
    if data.get("output_text"):
        return str(data["output_text"])

    parts = []
    for item in data.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in ("output_text", "text"):
                parts.append(str(content.get("text", "")))
    return "".join(parts)


def _stream_openai(cfg: dict, system_prompt: str, user_message: str) -> Generator[str, None, None]:
    if cfg.get("openai_api_mode", "responses") == "responses":
        yield from _stream_openai_responses(cfg, system_prompt, user_message)
        return

    url = _with_api_path(cfg["openai_base_url"], "/chat/completions")
    headers = {
        "Authorization": f"Bearer {cfg['openai_api_key']}",
        "Content-Type": "application/json",
    }
    body = {
        "model": cfg["openai_model"],
        "max_tokens": 8192,
        "stream": True,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
    }
    with httpx.stream("POST", url, json=body, headers=headers, timeout=180.0) as r:
        r.raise_for_status()
        for line in r.iter_lines():
            if line.startswith("data: "):
                if line.strip() == "data: [DONE]":
                    return
                import json
                try:
                    event = json.loads(line[6:])
                except (json.JSONDecodeError, ValueError):
                    continue
                choices = event.get("choices", [])
                if choices:
                    delta = choices[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        yield content


def _stream_openai_responses(cfg: dict, system_prompt: str, user_message: str) -> Generator[str, None, None]:
    url = _with_api_path(cfg["openai_base_url"], "/responses")
    headers = {
        "Authorization": f"Bearer {cfg['openai_api_key']}",
        "Content-Type": "application/json",
    }
    body = {
        "model": cfg["openai_model"],
        "instructions": system_prompt,
        "input": user_message,
        "max_output_tokens": 8192,
        "stream": True,
    }
    with httpx.stream("POST", url, json=body, headers=headers, timeout=180.0) as r:
        r.raise_for_status()
        for line in r.iter_lines():
            if not line.startswith("data: "):
                continue
            if line.strip() == "data: [DONE]":
                return
            import json
            try:
                event = json.loads(line[6:])
            except (json.JSONDecodeError, ValueError):
                continue
            if event.get("type") in ("response.output_text.delta", "response.refusal.delta"):
                delta = event.get("delta", "")
                if delta:
                    yield delta
