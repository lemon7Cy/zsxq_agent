# Architecture Notes

StarForge is a two-process local application:

- FastAPI backend for login, source loading, attachment parsing, LLM calls, and skill packaging.
- Vite React frontend for browsing, screening, streaming progress, and reviewing generated skills.

## Data Flow

```text
Knowledge Planet
  -> backend/zsxq_client.py
  -> local SQLite and topic cache
  -> LLM screening
  -> attachment extraction
  -> batch digest generation
  -> final SKILL synthesis
  -> local skill package
  -> frontend review/download
```

## Design Decisions

- Runtime data stays local and is excluded from git.
- LLM calls are configurable through the UI instead of hard-coded backend constants.
- Large corpora are split by prompt size and by topic count to avoid losing short-post coverage.
- Batch LLM calls can run concurrently, but SSE events are emitted in order for a readable UI.
- Final skills keep core workflows in `SKILL.md`; concrete target leads can move into references.

