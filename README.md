# 炼化星球

`zsxq_agent` 是一个本地优先的知识星球内容炼化工具。它可以登录知识星球、加载帖子和附件，用大模型筛掉广告/低价值内容，再把选中的资料整理成可复用的 Agent `SKILL.md` 技能包。

这个项目的重点不是“多写几千行代码”，而是把一个完整的知识生产链路做通：内容采集、智能筛选、附件解析、并发分批摘要、最终 Skill 综合、模型配置、技能包导出。

## 项目背景

很多技术社区里的知识密度很高，但形态很散：帖子、评论、源码片段、压缩包、配置文件、报错记录、工具链接、版本差异、踩坑经验混在一起。普通总结容易变成一段“读后感”，无法直接指导 AI Agent 工作。

炼化星球的目标是把这些非结构化内容沉淀成 Agent 可执行的操作手册：

- `SKILL.md`：保留核心工作流、工具策略、判断规则和失败处理。
- `references/target_leads.md`：保存具体站点、接口、关键词、工具线索。
- `agents/openai.yaml`：生成 Skill 元信息，方便后续放入技能库。
- ZIP 导出：可直接下载完整 Skill 包。

## 功能特性

- 微信扫码登录知识星球。
- 星球列表、帖子列表、附件信息浏览。
- 一次性加载全部帖子，适合批量炼化。
- LLM 智能筛选帖子，排除广告、推广、闲聊和内容不足的帖子。
- 支持读取 `.txt`、`.md`、源码、配置、脚本、JSON/YAML/TOML/XML/HTML/CSS/SQL 等常见文本文件。
- 支持解析 `.zip`、`.tar`、`.tar.gz`、`.tgz`、`.tar.bz2` 等压缩包。
- 分批摘要支持可配置并发，并保证前端进度按批次顺序展示。
- 最终只生成一份 `SKILL.md`，避免边流式输出边污染最终文档。
- 支持 OpenAI 兼容接口和 Anthropic 兼容接口。
- 支持模型列表获取、模型连接测试、配置保存。
- 支持导出包含 `SKILL.md`、`agents/openai.yaml`、`references/*.md` 的 ZIP 包。
- 运行数据默认保存在本地 `data/` 目录。

## 技术架构

```text
frontend/                  React + TypeScript + Tailwind 前端
  src/pages/Topics.tsx     帖子加载、筛选、选择、批量加载
  src/pages/Refine.tsx     炼化工作台，SSE 展示处理过程
  src/pages/Config.tsx     模型配置、模型列表、连接测试

backend/                   FastAPI 后端
  app.py                   API 路由、SSE 炼化流、模型配置接口
  zsxq_client.py           知识星球接口客户端
  refiner.py               分批、Prompt、Skill 生成与打包
  llm_client.py            OpenAI/Anthropic 兼容模型调用
  db.py                    本地 SQLite 状态管理

data/                      本地运行数据目录
```

## 炼化流程

1. 选择星球和帖子。
2. 加载帖子详情、评论和附件。
3. 提取附件中的文本、Markdown、源码和配置内容。
4. 按提示词长度和帖子数量拆分批次，避免短帖被过度压缩。
5. 并发生成每批中间摘要。
6. SSE 按批次顺序返回处理进度，前端不会乱序滚动。
7. 汇总所有批次摘要，生成唯一最终 `SKILL.md`。
8. 如果具体站点/API 线索太多，自动拆到 `references/target_leads.md`。
9. 生成 `agents/openai.yaml`，保存本地记录，并支持 ZIP 下载。

## 本地运行

### Docker 部署

推荐生产或演示环境使用 Docker，一条命令同时启动前端和后端：

```bash
docker compose up -d --build
```

启动后打开：

```text
http://127.0.0.1:3002
```

容器内后端监听 `8100`，`docker-compose.yml` 会映射到宿主机 `3002`。前端已经在镜像构建阶段编译为静态文件，由 FastAPI 同源托管。

运行数据会保存在本地：

```text
./data
```

常用命令：

```bash
docker compose logs -f
docker compose restart
docker compose down
```

### 后端

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r ../requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8100
```

### 前端

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 3002
```

然后打开：

```text
http://127.0.0.1:3002
```

## 模型配置

配置文件保存在本地 `data/config.json`。

你可以直接在前端“模型配置”页面填写，也可以复制示例配置：

```bash
mkdir -p data
cp config.example.json data/config.json
```

OpenAI 兼容中转站通常这样填：

- Base URL：`https://your-gateway.example.com`
- 模型列表接口：`/v1/models`
- 调用模式：`responses` 或 `chat`
