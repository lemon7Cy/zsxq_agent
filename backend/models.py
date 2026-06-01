"""Pydantic 数据模型"""
from pydantic import BaseModel


class GroupInfo(BaseModel):
    group_id: str
    name: str
    description: str = ""
    member_count: int = 0


class TopicBrief(BaseModel):
    topic_id: str
    type: str
    text: str = ""
    create_time: str = ""
    author_name: str = ""
    images: list[str] = []


class RefineRequest(BaseModel):
    group_id: str
    group_name: str = ""
    topic_ids: list[str]
    skill_id: int | None = None
    title: str = ""
    save_mode: str = "temp"  # "temp" or "permanent"


class ScreenTopic(BaseModel):
    topic_id: str
    text: str = ""
    author_name: str = ""
    create_time: str = ""
    image_count: int = 0
    file_names: list[str] = []


class ScreenTopicsRequest(BaseModel):
    group_name: str = ""
    topics: list[ScreenTopic]


class SkillInfo(BaseModel):
    id: int
    group_id: str
    group_name: str
    title: str
    version: int
    file_path: str
    created_at: str
    topic_count: int = 0


class LLMConfigUpdate(BaseModel):
    llm_provider: str | None = None
    anthropic_base_url: str | None = None
    anthropic_api_key: str | None = None
    anthropic_model: str | None = None
    openai_base_url: str | None = None
    openai_api_key: str | None = None
    openai_model: str | None = None
    openai_api_mode: str | None = None
    keep_topics_after_refine: bool | None = None
    refine_batch_concurrency: int | None = None
    screen_batch_size: int | None = None
    screen_batch_concurrency: int | None = None
    llm_retry_attempts: int | None = None


class LLMModelsRequest(LLMConfigUpdate):
    pass


class LLMTestRequest(LLMConfigUpdate):
    pass
