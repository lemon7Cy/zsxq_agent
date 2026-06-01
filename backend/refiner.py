"""SKILL refining logic"""
import re
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from config import DATA_DIR, load_config
from llm_client import call_llm

MAX_PROMPT_CHARS = 100000
MAX_BATCH_CONCURRENCY = 8
MAX_TOPICS_PER_BATCH = 20
MAIN_SKILL_REFERENCE_SPLIT_LINES = 450

SYSTEM_PROMPT = """You are a SKILL.md refinery for AI agents. Transform posts, attachments, source files, and discussion into a coverage-aware operational skill, not a tutorial or a source-code summary.

Final SKILL requirements:
- Write the final SKILL in concise operational English.
- Preserve Chinese only when it is an exact domain term, UI label, filename, search keyword, or quoted error that an agent should search for.
- Follow the detail budget in the user message. Large corpora must not be collapsed into a generic short skill; preserve distinct workflows as separate playbooks.
- Capture reusable workflow, tool strategy, decision rules, validation checks, and failure recovery.
- Do not copy source code. Avoid fenced code blocks. Keep only short inline commands, API names, filenames, function names, or search terms when essential.
- If the source mentions a GitHub repo, library, CLI, local project, MCP, script, or tool, describe how the agent should first search locally, then clone/download/install only if missing, then use it.
- Do not write introductions, conclusions, learning notes, or generic summaries.
- Add an "authorized targets only" boundary for reverse engineering, scraping, automation, or security-sensitive workflows when relevant.
- Prefer dense bullets over paragraphs. A longer skill is acceptable only when it preserves materially different tools, workflows, validation gates, or failure modes.

Output format:
1. First line exactly: SKILL_NAME: <short_english_snake_case_name>
2. Then output a complete SKILL.md body with YAML frontmatter:
---
name: <same snake_case skill name>
description: <one sentence describing when Codex should use this skill>
---
# <English title>
## When to use
## Inputs to collect
## Workflow
## Workflow playbooks
## Tool playbook
## Decision rules
## Failure handling"""

BATCH_SYSTEM_PROMPT = """You compress source material into intermediate notes for a later SKILL.md synthesis. Your job is preserving operational coverage, not producing a tiny summary.

Requirements:
- Write in concise operational English.
- Preserve Chinese only as exact search terms, UI labels, filenames, error strings, or domain aliases.
- Keep only agent-useful facts: trigger conditions, tools/libraries/projects, workflow, decision rules, validation checks, and pitfalls.
- Do not copy source code, do not quote long text, and do not write the final SKILL.
- Target 20-45 compact bullets when the batch contains many distinct techniques; fewer is fine only for genuinely narrow/noisy batches.
- Group notes under short labels: `Scope`, `Workflow candidates`, `Named tools`, `Validation signals`, `Failure modes`, `Low-value/noise`.
- Preserve exact names of repos, libraries, CLIs, MCP tools, scripts, files, token/header/cookie names, endpoint patterns, and error strings that an agent should search for.
- If there are multiple unrelated techniques in the batch, keep them separate instead of merging them into generic advice.
- If you see GitHub repos, libraries, CLIs, MCPs, scripts, or source projects, turn them into a tool strategy: search locally first, clone/download/install only if absent, then use the named entrypoint."""

REFINE_PROMPT_TEMPLATE = """Below are selected posts from the community "{group_name}", including comments and attachment contents. Refine them into a final SKILL.md:

{topics_content}

Output the complete SKILL.md."""

BATCH_DIGEST_PROMPT_TEMPLATE = """Community: {group_name}
Batch: {batch_index}/{total_batches}
Batch source size: {batch_topic_count} posts.

Below are the posts, comments, and attachment contents for this batch:

{topics_content}

Output the intermediate batch digest."""

SYNTHESIZE_PROMPT_TEMPLATE = """Community: {group_name}
Requested title: {title}
Source scale: {source_topic_count} posts summarized into {total_batches} batch digests.
Detail budget:
{detail_budget}

{existing_block}

Below are all intermediate batch digests. Synthesize them into one final SKILL.md.

Coverage rules:
- Preserve breadth before polish. Do not collapse distinct workflows/tools into one generic reverse-engineering/checklist paragraph.
- Use `## Workflow playbooks` with named sub-playbooks when the material spans multiple concrete task types.
- Keep tool names, repos, package names, MCP names, API/token/header names, filenames, and exact searchable strings when they affect how an agent acts.
- Remove examples, story context, repeated wording, ads, and source snippets.
- If batch digests disagree, express a decision rule instead of pretending there is one universal path.
- The final skill should be long enough to guide an agent through the source corpus, but still concise enough to load as a skill.

{batch_summaries}

Output the complete SKILL.md."""

EXPAND_SKILL_PROMPT_TEMPLATE = """Community: {group_name}
Requested title: {title}
Source scale: {source_topic_count} posts summarized into {total_batches} batch digests.
The first synthesis below is too compressed for this source scale. Rewrite it into a richer but still operational SKILL.md.

Detail budget:
{detail_budget}

Expansion rules:
- Add missing workflow playbooks, named tools, validation signals, and failure handling from the batch digests.
- Keep concise English bullets. Do not add tutorial prose, source code, long examples, or filler.
- Preserve the same output format with `SKILL_NAME:` followed by complete SKILL.md frontmatter/body.

First synthesis:
---
{draft_skill}
---

Batch digests:
{batch_summaries}

Output the complete expanded SKILL.md."""

ITERATE_PROMPT_TEMPLATE = """Below is the existing SKILL.md (version {version}):

---
{existing_skill}
---

New posts and attachment contents:

{topics_content}

Merge the existing skill and new material under the compact operational English SKILL format. Output the complete updated SKILL.md."""

def format_topics_for_prompt(topics: list[dict]) -> str:
    parts = []
    for t in topics:
        header = f"### Post {t['topic_id']} ({t.get('create_time', '')[:10]}) by {t.get('author_name', 'unknown')}"
        text = t.get("text", "").strip()

        comments = ""
        if t.get("comments"):
            comment_lines = [f"  - {c['author']}: {c['text']}" for c in t["comments"]]
            comments = "\nComments:\n" + "\n".join(comment_lines)

        file_contents = ""
        if t.get("file_contents"):
            fc_parts = []
            for fc in t["file_contents"]:
                fc_parts.append(f"\n#### File: {fc['name']}\n```\n{fc['content']}\n```")
            file_contents = "\n".join(fc_parts)

        parts.append(f"{header}\n{text}{comments}{file_contents}")
    return "\n\n---\n\n".join(parts)


def split_topics_into_batches(topics: list[dict]) -> list[list[dict]]:
    """Split topics by prompt size and count so large short-post corpora keep coverage."""
    batches = []
    current_batch = []
    current_size = 0

    for t in topics:
        topic_content = format_topics_for_prompt([t])
        topic_size = len(topic_content)

        if topic_size > MAX_PROMPT_CHARS:
            # Single topic too large — truncate file contents
            if t.get("file_contents"):
                for fc in t["file_contents"]:
                    fc["content"] = fc["content"][:MAX_PROMPT_CHARS // 2]
            if current_batch:
                batches.append(current_batch)
                current_batch = []
                current_size = 0
            batches.append([t])
            continue

        if current_size + topic_size > MAX_PROMPT_CHARS or len(current_batch) >= MAX_TOPICS_PER_BATCH:
            batches.append(current_batch)
            current_batch = [t]
            current_size = topic_size
        else:
            current_batch.append(t)
            current_size += topic_size

    if current_batch:
        batches.append(current_batch)

    return batches if batches else [topics]


def normalize_batch_concurrency(value: int | str | None) -> int:
    try:
        concurrency = int(value or 1)
    except (TypeError, ValueError):
        concurrency = 1
    return max(1, min(MAX_BATCH_CONCURRENCY, concurrency))


def _detail_budget(source_topic_count: int, total_batches: int) -> tuple[str, int]:
    """Return prompt guidance plus a soft minimum line count for coverage checks."""
    topics = max(0, int(source_topic_count or 0))
    batches = max(1, int(total_batches or 1))
    if topics >= 150 or batches >= 10:
        return (
            "- Corpus size: large.\n"
            "- Target roughly 120-220 concise lines if the digests contain enough distinct material.\n"
            "- Preserve 8-16 named workflow playbooks when present; do not force all posts into one generic method.\n"
            "- Keep SKILL.md under 500 lines and avoid detailed references/code; move only operational patterns into the skill.",
            95,
        )
    if topics >= 60 or batches >= 4:
        return (
            "- Corpus size: medium-large.\n"
            "- Target roughly 80-150 concise lines when multiple workflows/tools are present.\n"
            "- Preserve 5-10 named workflow playbooks when present.",
            70,
        )
    if topics >= 20 or batches >= 2:
        return (
            "- Corpus size: medium.\n"
            "- Target roughly 55-110 concise lines when the material has real breadth.\n"
            "- Preserve distinct workflows instead of compressing them into generic bullets.",
            45,
        )
    return (
        "- Corpus size: small.\n"
        "- Target roughly 35-75 concise lines unless the source is genuinely more complex.",
        25,
    )


def _meaningful_line_count(text: str) -> int:
    return sum(1 for line in text.splitlines() if line.strip() and not line.strip().startswith("---"))


def _should_extract_reference_heading(heading: str) -> bool:
    return bool(re.search(r"\b(specific site|site/api|target[- ]specific|signature leads)\b", heading, re.I))


def _extract_reference_sections(skill_content: str) -> tuple[str, dict[str, str]]:
    """Move concrete target-lead sections into references while keeping workflows in SKILL.md."""
    if _meaningful_line_count(skill_content) <= MAIN_SKILL_REFERENCE_SPLIT_LINES:
        return skill_content, {}

    lines = skill_content.strip().splitlines()
    main_lines: list[str] = []
    reference_blocks: list[str] = []
    idx = 0
    extracted = False

    while idx < len(lines):
        line = lines[idx]
        if line.startswith("### ") and _should_extract_reference_heading(line):
            extracted = True
            block = [re.sub(r"^###\s+\d+\.\s+", "## ", line)]
            idx += 1
            while idx < len(lines) and not lines[idx].startswith("### ") and not lines[idx].startswith("## "):
                block.append(lines[idx])
                idx += 1
            reference_blocks.append("\n".join(block).strip())
            if not any("references/target_leads.md" in existing for existing in main_lines[-8:]):
                main_lines.extend([
                    "### Target-specific site/API leads",
                    "- For named sites, vendors, headers, tokens, or challenge aliases, read `references/target_leads.md` first.",
                    "- Treat entries there as search leads: look for local artifacts/captures before implementing target-specific logic.",
                    "- If no artifact exists, ask for fresh captures instead of inventing code-level details.",
                    "",
                ])
            continue
        main_lines.append(line)
        idx += 1

    if not extracted:
        return skill_content, {}

    reference_content = (
        "# Target-Specific Leads\n\n"
        "Use this reference only after the main workflow applies and the task names a concrete site, vendor, token, header, API, or local archive keyword. "
        "Entries are search leads, not complete implementations; verify against local artifacts and fresh captures.\n\n"
        + "\n\n".join(reference_blocks).strip()
        + "\n"
    )
    main_content = "\n".join(main_lines).strip() + "\n"
    return main_content, {"references/target_leads.md": reference_content}


def extract_skill_name(skill_content: str) -> tuple[str, str]:
    """Return (ai_name, markdown_without_name_line)."""
    if skill_content.startswith("SKILL_NAME:"):
        first_line, _, rest = skill_content.partition("\n")
        return first_line.replace("SKILL_NAME:", "").strip(), rest.strip()
    return "", skill_content.strip()


def safe_skill_name(title: str) -> str:
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in title)
    safe_name = re.sub(r"_+", "_", safe_name).strip("_")
    return safe_name or f"skill_{int(time.time())}"


def _yaml_quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ").strip() + '"'


def _title_from_name(name: str) -> str:
    return " ".join(part for part in re.split(r"[-_]+", name) if part).title() or "Generated Skill"


def extract_skill_metadata(skill_content: str, fallback_title: str) -> dict:
    fallback_name = safe_skill_name(fallback_title).lower()
    metadata = {
        "name": fallback_name,
        "description": f"Use this skill for {fallback_title or 'the refined workflow'}.",
        "display_name": fallback_title or _title_from_name(fallback_name),
    }
    match = re.match(r"^---\n(.*?)\n---\n?", skill_content, re.DOTALL)
    if not match:
        return metadata

    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        clean = value.strip().strip("'\"")
        if key.strip() == "name" and clean:
            metadata["name"] = safe_skill_name(clean).lower()
        elif key.strip() == "description" and clean:
            metadata["description"] = clean
    metadata["display_name"] = _title_from_name(metadata["name"])
    return metadata


def ensure_skill_frontmatter(skill_content: str, title: str) -> str:
    if re.match(r"^---\n.*?\n---\n?", skill_content, re.DOTALL):
        return skill_content.strip() + "\n"
    name = safe_skill_name(title).lower()
    description = f"Use this skill for {title or 'the refined workflow'}."
    return (
        "---\n"
        f"name: {name}\n"
        f"description: {description}\n"
        "---\n"
        f"# {_title_from_name(name)}\n\n"
        f"{skill_content.strip()}\n"
    )


def build_openai_yaml(skill_content: str, title: str) -> str:
    meta = extract_skill_metadata(skill_content, title)
    display_name = _title_from_name(meta["name"])
    short_description = meta["description"][:96]
    default_prompt = f"Use ${meta['name']} to handle this task with the matching operational workflow."
    return (
        "interface:\n"
        f"  display_name: {_yaml_quote(display_name)}\n"
        f"  short_description: {_yaml_quote(short_description)}\n"
        f"  default_prompt: {_yaml_quote(default_prompt)}\n"
        "\n"
        "policy:\n"
        "  allow_implicit_invocation: true\n"
    )


def summarize_batch(
    group_name: str,
    batch: list[dict],
    batch_index: int,
    total_batches: int,
) -> str:
    topics_content = format_topics_for_prompt(batch)
    user_msg = BATCH_DIGEST_PROMPT_TEMPLATE.format(
        group_name=group_name,
        batch_index=batch_index,
        total_batches=total_batches,
        batch_topic_count=len(batch),
        topics_content=topics_content,
    )
    return call_llm(
        BATCH_SYSTEM_PROMPT,
        user_msg,
        {
            "label": "digest",
            "batch_index": batch_index,
            "total_batches": total_batches,
        },
    ).strip()


def summarize_batches_parallel(
    group_name: str,
    batches: list[list[dict]],
    concurrency: int | str | None = None,
) -> list[str]:
    total_batches = len(batches)
    if total_batches == 0:
        return []

    worker_count = min(normalize_batch_concurrency(concurrency), total_batches)
    if worker_count <= 1 or total_batches == 1:
        return [
            summarize_batch(group_name, batch, idx, total_batches)
            for idx, batch in enumerate(batches, start=1)
        ]

    summaries = [""] * total_batches
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {
            executor.submit(summarize_batch, group_name, batch, idx, total_batches): idx
            for idx, batch in enumerate(batches, start=1)
        }
        for future in as_completed(futures):
            idx = futures[future]
            summaries[idx - 1] = future.result()
    return summaries


def synthesize_skill(
    group_name: str,
    batch_summaries: list[str],
    title: str = "",
    existing_skill_path: str | None = None,
    existing_version: int = 0,
    source_topic_count: int = 0,
    on_progress: Callable[[str], None] | None = None,
) -> tuple[str, str]:
    existing_block = ""
    if existing_skill_path and Path(existing_skill_path).exists():
        existing_skill = Path(existing_skill_path).read_text(encoding="utf-8")
        existing_block = f"""Existing SKILL.md (version {existing_version}); preserve useful capabilities while integrating the new digests:

---
{existing_skill}
---"""

    summaries = []
    for idx, summary in enumerate(batch_summaries, start=1):
        summaries.append(f"### Batch {idx}\n{summary}")

    detail_budget, min_lines = _detail_budget(source_topic_count, len(batch_summaries))
    joined_summaries = "\n\n".join(summaries)
    user_msg = SYNTHESIZE_PROMPT_TEMPLATE.format(
        group_name=group_name,
        title=title or "let the model derive a title from the material",
        source_topic_count=source_topic_count or "unknown",
        total_batches=len(batch_summaries),
        detail_budget=detail_budget,
        existing_block=existing_block or "No existing SKILL is provided; create one from the new digests.",
        batch_summaries=joined_summaries,
    )
    skill_content = call_llm(
        SYSTEM_PROMPT,
        user_msg,
        {
            "label": "synthesize",
            "total_batches": len(batch_summaries),
        },
    )
    if _meaningful_line_count(skill_content) < min_lines and (source_topic_count >= 20 or len(batch_summaries) >= 2):
        if on_progress:
            on_progress(f"初稿覆盖不足，正在按 {source_topic_count or '多'} 条帖子规模补全工作流细节")
        expand_msg = EXPAND_SKILL_PROMPT_TEMPLATE.format(
            group_name=group_name,
            title=title or "let the model derive a title from the material",
            source_topic_count=source_topic_count or "unknown",
            total_batches=len(batch_summaries),
            detail_budget=detail_budget,
            draft_skill=skill_content,
            batch_summaries=joined_summaries,
        )
        skill_content = call_llm(
            SYSTEM_PROMPT,
            expand_msg,
            {
                "label": "expand_synthesis",
                "total_batches": len(batch_summaries),
                "source_topic_count": source_topic_count,
            },
        )
    return extract_skill_name(skill_content)


def save_skill_file(skill_content: str, title: str) -> str:
    skills_dir = DATA_DIR / "skills"
    safe_name = safe_skill_name(title)
    skill_dir = skills_dir / safe_name
    agents_dir = skill_dir / "agents"
    references_dir = skill_dir / "references"
    agents_dir.mkdir(parents=True, exist_ok=True)

    skill_content = ensure_skill_frontmatter(skill_content, title)
    skill_content, references = _extract_reference_sections(skill_content)
    file_path = skill_dir / "SKILL.md"
    file_path.write_text(skill_content, encoding="utf-8")
    (agents_dir / "openai.yaml").write_text(build_openai_yaml(skill_content, title), encoding="utf-8")
    if references:
        references_dir.mkdir(parents=True, exist_ok=True)
        for stale_ref in references_dir.rglob("*"):
            if stale_ref.is_file():
                stale_ref.unlink(missing_ok=True)
        for rel_path, content in references.items():
            ref_path = skill_dir / rel_path
            ref_path.parent.mkdir(parents=True, exist_ok=True)
            ref_path.write_text(content, encoding="utf-8")
    else:
        (references_dir / "target_leads.md").unlink(missing_ok=True)
        (references_dir / "workflow_playbooks.md").unlink(missing_ok=True)
    return str(file_path)


def refine_skill(
    group_id: str,
    group_name: str,
    topics: list[dict],
    title: str = "",
    existing_skill_path: str | None = None,
    existing_version: int = 0,
) -> tuple[str, str, str]:
    batches = split_topics_into_batches(topics)
    cfg = load_config()
    batch_summaries = summarize_batches_parallel(
        group_name,
        batches,
        cfg.get("refine_batch_concurrency", 2),
    )
    ai_name, skill_content = synthesize_skill(
        group_name=group_name,
        batch_summaries=batch_summaries,
        title=title,
        existing_skill_path=existing_skill_path,
        existing_version=existing_version,
        source_topic_count=len(topics),
    )

    if not title and ai_name:
        title = ai_name
    elif not title:
        title = f"{group_name}_skill_{int(time.time())}"

    file_path = save_skill_file(skill_content, title)
    skill_content = Path(file_path).read_text(encoding="utf-8")

    return skill_content, str(file_path), title
