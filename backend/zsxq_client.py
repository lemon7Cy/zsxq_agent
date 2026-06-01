"""知识星球 API 客户端封装"""
import json
import time
from pathlib import Path
from urllib.parse import quote

import httpx

from zsxq_sign import build_headers
from zsxq_crypto import ZsxqCipher
from config import DATA_DIR

APPID = "wxa8d63c1238079ec4"
REDIRECT_URI = "https://wx.zsxq.com/load"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/148.0.0.0 Safari/537.36")
BASE_HEADERS = {
    "User-Agent": UA,
    "Origin": "https://wx.zsxq.com",
    "Referer": "https://wx.zsxq.com/",
}


class ZsxqClient:
    def __init__(self, access_token: str | None = None):
        self.access_token = access_token
        self.http = httpx.Client(headers=BASE_HEADERS, timeout=15.0)

    def close(self):
        self.http.close()

    def _get(self, url: str) -> dict:
        headers = build_headers(url, self.access_token)
        r = self.http.get(url, headers=headers)
        r.raise_for_status()
        return r.json()

    def get_me(self) -> dict:
        data = self._get("https://api.zsxq.com/v2/users/self")
        if not data.get("succeeded"):
            raise RuntimeError(f"拉取账号信息失败: {data}")
        user = data.get("resp_data", {}).get("user", {}) or {}
        return {
            "user_id": str(user.get("user_id") or user.get("uid") or ""),
            "name": user.get("name", ""),
            "avatar_url": user.get("avatar_url", ""),
            "location": user.get("location", ""),
            "unique_id": user.get("unique_id", ""),
            "user_sid": user.get("user_sid", ""),
        }

    def get_groups(self) -> list[dict]:
        data = self._get("https://api.zsxq.com/v2/groups")
        if not data.get("succeeded"):
            raise RuntimeError(f"拉取星球列表失败: {data}")
        groups = data["resp_data"]["groups"]
        result = []
        for g in groups:
            owner = g.get("owner", {})
            stats = g.get("statistics", {})
            members = stats.get("members", {})
            result.append({
                "group_id": str(g["group_id"]),
                "name": g.get("name", ""),
                "type": g.get("type", ""),
                "avatar_url": (
                    g.get("avatar_url")
                    or g.get("icon_url")
                    or g.get("icon")
                    or owner.get("avatar_url", "")
                ),
                "owner_name": owner.get("name", ""),
                "owner_avatar": owner.get("avatar_url", ""),
                "background_url": g.get("background_url", ""),
                "members_count": members.get("count", 0),
            })
        return result

    def get_topics(self, group_id: str, count: int = 20, end_time: str = "") -> dict:
        url = f"https://api.zsxq.com/v2/groups/{group_id}/topics?scope=all&count={count}"
        if end_time:
            url += f"&end_time={quote(end_time, safe='')}"
        data = self._get(url)
        if not data.get("succeeded"):
            raise RuntimeError(f"拉取帖子失败: {data}")
        topics = data["resp_data"].get("topics", [])
        result = []
        for t in topics:
            topic = self._parse_topic(t)
            if topic:
                result.append(topic)
        return {"topics": result, "has_more": len(topics) == count}

    def get_topic_detail(self, topic_id: str) -> dict | None:
        url = f"https://api.zsxq.com/v2/topics/{topic_id}"
        data = self._get(url)
        if not data.get("succeeded"):
            return None
        return self._parse_topic(data["resp_data"].get("topic", {}))

    def get_file_download_url(self, file_id: str) -> str:
        url = f"https://api.zsxq.com/v2/files/{file_id}/download_url"
        data = self._get(url)
        if not data.get("succeeded"):
            raise RuntimeError(f"获取下载链接失败: {data}")
        return data["resp_data"]["download_url"]

    def _parse_topic(self, t: dict) -> dict | None:
        topic_id = str(t.get("topic_id", ""))
        if not topic_id:
            return None
        topic_type = t.get("type", "unknown")
        text = ""
        images = []
        files = []
        author_name = ""
        author_avatar = ""

        if "talk" in t:
            talk = t["talk"]
            text = talk.get("text", "")
            images = self._parse_images(talk.get("images", []))
            files = self._parse_files(talk.get("files", []))
            owner = talk.get("owner", {})
            author_name = owner.get("name", "")
            author_avatar = owner.get("avatar_url", "")
        elif "question" in t:
            q = t["question"]
            text = q.get("text", "")
            owner = q.get("owner", {})
            author_name = owner.get("name", "")
            author_avatar = owner.get("avatar_url", "")
        elif "article" in t:
            art = t["article"]
            text = art.get("title", "") + "\n" + art.get("inline_content", "")
            owner = art.get("owner", {})
            author_name = owner.get("name", "")
            author_avatar = owner.get("avatar_url", "")

        if not author_name:
            owner = t.get("owner", {})
            author_name = owner.get("name", "")
            author_avatar = owner.get("avatar_url", "")

        return {
            "topic_id": topic_id,
            "type": topic_type,
            "text": text,
            "create_time": t.get("create_time", ""),
            "author_name": author_name,
            "author_avatar": author_avatar,
            "images": images,
            "files": files,
            "likes_count": t.get("likes_count", 0),
            "comments_count": t.get("comments_count", 0),
            "reading_count": t.get("reading_count", 0),
            "comments": self._parse_comments(t.get("show_comments", [])),
        }

    def _parse_images(self, images: list) -> list[dict]:
        result = []
        for img in images:
            result.append({
                "image_id": str(img.get("image_id", "")),
                "type": img.get("type", ""),
                "thumbnail": img.get("thumbnail", {}).get("url", ""),
                "large": img.get("large", {}).get("url", ""),
                "original": img.get("original", {}).get("url", ""),
            })
        return result

    def _parse_files(self, files: list) -> list[dict]:
        result = []
        for f in files:
            result.append({
                "file_id": str(f.get("file_id", "")),
                "name": f.get("name", ""),
                "size": f.get("size", 0),
                "download_count": f.get("download_count", 0),
                "create_time": f.get("create_time", ""),
            })
        return result

    def _parse_comments(self, comments: list) -> list[dict]:
        result = []
        for c in comments:
            owner = c.get("owner", {})
            result.append({
                "author": owner.get("name", ""),
                "avatar": owner.get("avatar_url", ""),
                "text": c.get("text", ""),
                "create_time": c.get("create_time", ""),
            })
        return result

    def save_topic(self, topic: dict) -> Path:
        topics_dir = DATA_DIR / "topics"
        topics_dir.mkdir(parents=True, exist_ok=True)
        path = topics_dir / f"{topic['topic_id']}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(topic, f, ensure_ascii=False, indent=2)
        return path

    def load_topic(self, topic_id: str) -> dict | None:
        path = DATA_DIR / "topics" / f"{topic_id}.json"
        if not path.exists():
            return None
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    def download_file(self, file_id: str, filename: str) -> Path:
        download_url = self.get_file_download_url(file_id)
        attach_dir = DATA_DIR / "attachments"
        attach_dir.mkdir(parents=True, exist_ok=True)
        out_path = attach_dir / filename
        with self.http.stream("GET", download_url) as r:
            r.raise_for_status()
            with open(out_path, "wb") as f:
                for chunk in r.iter_bytes(8192):
                    f.write(chunk)
        return out_path

    def exchange_token(self, wx_code: str) -> str:
        cipher = ZsxqCipher()
        url = "https://api.zsxq.com/v3/access_tokens"
        body = {
            "req_data": {
                "client": "DWeb",
                "wechat": {"auth": {"appid": APPID, "code": wx_code}},
            }
        }
        encrypted_body = cipher.encrypt(body)
        headers = build_headers(url)
        headers.update(cipher.headers())
        headers.update(BASE_HEADERS)
        headers["Content-Type"] = "text/plain"

        r = self.http.post(url, content=encrypted_body, headers=headers)
        r.raise_for_status()
        resp = cipher.decrypt(r.text)
        if not resp.get("succeeded"):
            raise RuntimeError(f"换取 token 失败: {resp}")
        return resp["resp_data"]["access_token"]
