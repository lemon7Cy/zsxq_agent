"""
知识星球接口签名辅助模块

当前 Web 客户端签名格式：
  x-signature = SHA1(url + " " + timestamp + " " + request_id)

其中:
  - url: 完整请求 URL（含 query string，单引号替换为 %27）
  - timestamp: Unix 秒级时间戳
  - request_id: 客户端生成的类 UUID 字符串
"""
import hashlib
import random
import time


X_VERSION_V2 = "2.92.0"
X_VERSION_V3 = "3.18.0"


def generate_request_id() -> str:
    chars = "0123456789abcdef"
    parts = []
    for i in range(32):
        parts.append(random.choice(chars))
        if i in (7, 11, 15, 19):
            parts.append("-")
    return "".join(parts)


def sign(url: str, timestamp: int, request_id: str) -> str:
    parts = url.split("?")
    if len(parts) > 1:
        url = parts[0] + "?" + "?".join(parts[1:]).replace("'", "%27")
    msg = f"{url} {timestamp} {request_id}"
    return hashlib.sha1(msg.encode()).hexdigest()


def build_headers(url: str, access_token: str | None = None) -> dict[str, str]:
    ts = int(time.time())
    rid = generate_request_id()
    version = X_VERSION_V3 if "/v3/" in url else X_VERSION_V2

    headers = {
        "X-Request-Id": rid,
        "X-Version": version,
        "X-Signature": sign(url, ts, rid),
        "X-Timestamp": str(ts),
    }
    if access_token:
        headers["Cookie"] = f"zsxq_access_token={access_token}"
    return headers
