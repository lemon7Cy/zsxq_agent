"""应用配置"""
import json
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "zsxq.db"
CONFIG_PATH = DATA_DIR / "config.json"

DEFAULT_CONFIG = {
    "llm_provider": "anthropic",
    "anthropic_base_url": "",
    "anthropic_api_key": "",
    "anthropic_model": "claude-sonnet-4-5",
    "openai_base_url": "",
    "openai_api_key": "",
    "openai_model": "gpt-4o",
    "openai_api_mode": "responses",
    "keep_topics_after_refine": False,
    "refine_batch_concurrency": 2,
    "screen_batch_size": 20,
    "screen_batch_concurrency": 2,
    "llm_retry_attempts": 2,
}


def load_config() -> dict:
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH) as f:
            saved = json.load(f)
        return {**DEFAULT_CONFIG, **saved}
    return DEFAULT_CONFIG.copy()


def save_config(cfg: dict) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
