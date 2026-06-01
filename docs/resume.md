# Resume Notes

## One-Line Version

StarForge is a local-first Agent knowledge refinery that converts community posts and attachments into reusable AI `SKILL.md` packages.

## Bullet Version

- Built a FastAPI + React application for authenticated community content collection, LLM relevance screening, attachment parsing, and Agent skill generation.
- Designed a batch summarization pipeline with configurable concurrency, ordered SSE progress events, and final `SKILL.md` synthesis.
- Added model gateway configuration, model-list fetching, connection testing, and ZIP export with `openai.yaml` metadata.
- Implemented local-only storage and a public-release workflow that excludes API keys, access tokens, databases, downloaded attachments, and private generated content.

