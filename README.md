# StarForge

StarForge is a local-first knowledge refinery for community content. It connects to a Knowledge Planet workspace, loads posts and attachments, filters out low-value or promotional content with an LLM, and turns selected material into reusable Agent `SKILL.md` packages.

The project is intentionally small, but the workflow is complete: content acquisition, quality screening, attachment parsing, concurrent batch summarization, final skill synthesis, model configuration, and ZIP export.

## Why It Exists

Many expert communities contain high-density but messy knowledge: posts, comments, code snippets, compressed attachments, screenshots, version notes, and scattered troubleshooting details. StarForge turns that material into operational AI skills instead of ordinary summaries.

The generated output is designed for agents:

- concise English `SKILL.md` for direct model consumption
- optional `references/target_leads.md` for concrete site/API/vendor clues
- `agents/openai.yaml` metadata for skill catalogs
- ZIP export that can be installed or shared as a skill package

## Features

- WeChat QR login flow for Knowledge Planet sessions.
- Group and topic browsing with a dense, practical dashboard UI.
- One-click pagination loading for large topic sets.
- LLM-assisted content screening to remove ads, thin posts, and unrelated material.
- Attachment extraction for text, Markdown, source files, configs, scripts, JSON/YAML/TOML/XML/HTML/CSS/SQL, ZIP and tar archives.
- Batch summarization with configurable concurrency and ordered progress events.
- Final synthesis strategy that keeps operational workflows in the main `SKILL.md` and moves concrete target leads into references when useful.
- OpenAI-compatible and Anthropic-compatible model configuration.
- Model list fetching and connection testing for OpenAI-compatible gateways such as NewAPI, One API, and sub2api.
- ZIP export containing `SKILL.md`, `agents/openai.yaml`, and generated `references/*.md`.
- Local runtime storage only; no hosted backend and no telemetry.

## Architecture

```text
frontend/                  React + TypeScript + Tailwind UI
  src/pages/Topics.tsx     topic loading, selection, LLM screening
  src/pages/Refine.tsx     streaming Agent workbench
  src/pages/Config.tsx     model gateway configuration

backend/                   FastAPI backend
  app.py                   API routes, SSE refine stream, config endpoints
  zsxq_client.py           Knowledge Planet API client
  refiner.py               batching, prompts, skill packaging
  llm_client.py            OpenAI/Anthropic-compatible model client
  db.py                    local SQLite state

data/                      local runtime directory, ignored by git
```

## Skill Generation Pipeline

1. Load selected posts and local cached topic details.
2. Download and parse supported attachments.
3. Split source material by prompt size and by post count to avoid over-compression.
4. Generate compact intermediate digests concurrently.
5. Emit progress events in batch order even when LLM calls finish out of order.
6. Synthesize one final `SKILL.md`.
7. If concrete target/API leads make the skill too noisy, move them to `references/target_leads.md`.
8. Generate `agents/openai.yaml` and save a downloadable ZIP package.

## Setup

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r ../requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8100
```

### Frontend

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 3002
```

Open `http://127.0.0.1:3002`.

## Configuration

Configuration is stored locally at `data/config.json` and is ignored by git. You can configure it from the UI, or start from:

```bash
mkdir -p data
cp config.example.json data/config.json
```

For OpenAI-compatible gateways:

- Base URL usually looks like `https://your-gateway.example.com`
- model list is requested from `/v1/models`
- `openai_api_mode` can be `responses` or `chat`

## Privacy And Safety

This repository does not include real community posts, attachments, model keys, access tokens, cookies, local databases, generated skills, HAR files, or logs.

Before publishing or sharing your own fork, check that these paths are not committed:

- `data/`
- `.cache/`
- `*.har`
- `js_dump/`
- `frontend/dist/`
- `node_modules/`

Use StarForge only for content and communities you are authorized to access. Generated skills should preserve operational knowledge without exposing private member content or confidential attachments.

## Public Demo Data

This repo intentionally ships without real Knowledge Planet content. If you want a public demo, create synthetic posts or a mock connector instead of committing private community data.

## Resume-Friendly Summary

Built a local-first community knowledge refinery that transforms unstructured posts and attachments into reusable AI Agent skills. The system includes authenticated content loading, LLM-based relevance screening, archive/source parsing, concurrent batch summarization, ordered SSE progress reporting, model gateway configuration, and skill package export.

