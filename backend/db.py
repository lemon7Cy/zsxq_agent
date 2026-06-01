"""SQLite 数据库初始化 + CRUD"""
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from config import DB_PATH


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY,
            access_token TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS skills (
            id INTEGER PRIMARY KEY,
            group_id TEXT NOT NULL,
            group_name TEXT,
            title TEXT NOT NULL,
            version INTEGER DEFAULT 1,
            file_path TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS skill_topics (
            skill_id INTEGER REFERENCES skills(id),
            topic_id TEXT NOT NULL,
            added_at_version INTEGER NOT NULL,
            PRIMARY KEY (skill_id, topic_id)
        );
    """)
    conn.close()


def save_session(token: str) -> None:
    conn = get_db()
    now = datetime.now().isoformat()
    expires = (datetime.now() + timedelta(days=30)).isoformat()
    conn.execute("DELETE FROM sessions")
    conn.execute(
        "INSERT INTO sessions (access_token, created_at, expires_at) VALUES (?, ?, ?)",
        (token, now, expires),
    )
    conn.commit()
    conn.close()


def get_session() -> str | None:
    conn = get_db()
    row = conn.execute(
        "SELECT access_token, expires_at FROM sessions ORDER BY id DESC LIMIT 1"
    ).fetchone()
    conn.close()
    if not row:
        return None
    if datetime.fromisoformat(row["expires_at"]) < datetime.now():
        return None
    return row["access_token"]


def create_skill(group_id: str, group_name: str, title: str, file_path: str, topic_ids: list[str], version: int = 1) -> int:
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO skills (group_id, group_name, title, version, file_path, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (group_id, group_name, title, version, file_path, datetime.now().isoformat()),
    )
    skill_id = cur.lastrowid
    for tid in topic_ids:
        conn.execute(
            "INSERT OR IGNORE INTO skill_topics (skill_id, topic_id, added_at_version) VALUES (?, ?, ?)",
            (skill_id, tid, version),
        )
    conn.commit()
    conn.close()
    return skill_id


def get_skills(group_id: str | None = None) -> list[dict]:
    conn = get_db()
    if group_id:
        rows = conn.execute(
            "SELECT s.*, COUNT(st.topic_id) as topic_count FROM skills s LEFT JOIN skill_topics st ON s.id = st.skill_id WHERE s.group_id = ? GROUP BY s.id ORDER BY s.created_at DESC",
            (group_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT s.*, COUNT(st.topic_id) as topic_count FROM skills s LEFT JOIN skill_topics st ON s.id = st.skill_id GROUP BY s.id ORDER BY s.created_at DESC"
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_skill(skill_id: int) -> dict | None:
    conn = get_db()
    row = conn.execute("SELECT * FROM skills WHERE id = ?", (skill_id,)).fetchone()
    if not row:
        conn.close()
        return None
    skill = dict(row)
    topics = conn.execute(
        "SELECT topic_id, added_at_version FROM skill_topics WHERE skill_id = ?",
        (skill_id,),
    ).fetchall()
    skill["topics"] = [dict(t) for t in topics]
    conn.close()
    return skill


def get_skill_topic_ids(skill_id: int) -> list[str]:
    conn = get_db()
    rows = conn.execute(
        "SELECT topic_id FROM skill_topics WHERE skill_id = ?", (skill_id,)
    ).fetchall()
    conn.close()
    return [r["topic_id"] for r in rows]


def delete_skill(skill_id: int) -> bool:
    import shutil

    conn = get_db()
    row = conn.execute("SELECT file_path FROM skills WHERE id = ?", (skill_id,)).fetchone()
    if not row:
        conn.close()
        return False
    conn.execute("DELETE FROM skill_topics WHERE skill_id = ?", (skill_id,))
    conn.execute("DELETE FROM skills WHERE id = ?", (skill_id,))
    conn.commit()
    conn.close()
    fp = Path(row["file_path"])
    if fp.is_file() and fp.name == "SKILL.md" and fp.parent.parent == DB_PATH.parent / "skills":
        shutil.rmtree(fp.parent, ignore_errors=True)
    elif fp.exists():
        fp.unlink()
    return True
