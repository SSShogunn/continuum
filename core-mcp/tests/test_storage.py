"""Storing: unchanged saves, capture merge planning, near-duplicate handling."""

import asyncio
from datetime import datetime, timezone

import pytest

from app.memory import capture, memory, search


def test_above_floor_keeps_only_close_semantic_hits():
    rows = [{"similarity": 0.8}, {"similarity": 0.44}, {"similarity": None}]
    assert search.above_floor(rows, 0.45) == [{"similarity": 0.8}]
    assert search.above_floor(rows, None) == rows


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("memory-save-selectivity [preference]", "memory-save-selectivity"),
        ("chat-quality-drop [project] [project]", "chat-quality-drop"),
        ("  plain-name  ", "plain-name"),
        ("[only-a-tag]", "[only-a-tag]"),
        ("uses [brackets] mid-name", "uses [brackets] mid-name"),
    ],
)
def test_clean_name_strips_trailing_type_tags(raw, expected):
    assert memory.clean_name(raw) == expected


def test_new_lines_ignores_bullets_case_and_spacing():
    existing = "- Uses FastAPI\n- deploys  via docker"
    assert capture.new_lines(existing, "* uses fastapi\n- Deploys via Docker\n- Redis 7 for queues") == "- Redis 7 for queues"


@pytest.mark.parametrize(
    "existing,content,shown,expected",
    [
        (None, "new", False, ("save", "new")),
        ({"content": "a\nb\nc"}, "a\nb\nc\nd", True, ("save", "a\nb\nc\nd")),         # full merge, model saw it
        ({"content": "line one\nline two\nline three"}, "line four", True, ("append", "line four")),  # shrink guard
        ({"content": "a\nb"}, "a\nb\nc", False, ("append", "c")),                       # never shown: append only
        ({"content": "a\nb"}, "- a", False, ("skip", "")),
    ],
)
def test_plan_write(existing, content, shown, expected):
    assert capture.plan_write(existing, content, shown) == expected


def test_identical_save_skips_embedding_and_graph(monkeypatch):
    now = datetime.now(timezone.utc)

    async def get_entry(name, owner=""):
        return {"name": name, "type": "project", "recall": "relevance", "description": "d",
                "content": "c", "updated_at": now, "archived_at": None}

    async def embed(text):
        raise AssertionError("unchanged save must not re-embed")

    monkeypatch.setattr(memory, "get_entry", get_entry)
    monkeypatch.setattr(memory, "embed", embed)
    monkeypatch.setattr(memory.kg, "schedule_extract", lambda *a: (_ for _ in ()).throw(AssertionError("no extract")))
    record = asyncio.run(memory.save("n", "project", "d", "c", owner="u:default"))
    assert record["unchanged"] is True


class CaptureStore:
    def __init__(self, entries):
        self.entries = entries  # {(owner, name): entry}
        self.saved, self.appended = [], []


@pytest.fixture
def cap(monkeypatch):
    store = CaptureStore({})

    async def get_entry(name, owner=""):
        return store.entries.get((owner, name))

    async def nearest(owner, emb):
        return store.near

    async def append(name, text, owner=""):
        store.appended.append((owner, name, text))

    async def save(name, type, description, content, owner="", recall=None, supersedes=None):
        store.saved.append((owner, name, content))
        return {"name": name}

    async def embed(text):
        return [0.0]

    store.near = None
    monkeypatch.setattr(capture.memory, "get_entry", get_entry)
    monkeypatch.setattr(capture.memory, "nearest", nearest)
    monkeypatch.setattr(capture.memory, "append", append)
    monkeypatch.setattr(capture.memory, "save", save)
    monkeypatch.setattr(capture, "embed", embed)
    return store


def cand(name, content):
    return capture.Candidate(name=name, type="preference", recall="relevance", description="d", content=content)


def test_existing_default_entry_is_updated_in_place_not_duplicated(cap):
    cap.entries[("u:default", "editor")] = {"content": "uses vim"}
    asyncio.run(capture._write_candidate(cand("editor", "uses vim\nuses tmux"), "editor", "uses vim\nuses tmux",
                                         ["u:proj", "u:default"], shown={}))
    assert cap.appended == [("u:default", "editor", "uses tmux")]
    assert cap.saved == []


def test_near_duplicate_under_new_name_merges_into_existing(cap):
    cap.entries[("u:proj", "deploy-setup")] = {"content": "docker compose on freyr"}
    cap.near = ("deploy-setup", 0.95)
    asyncio.run(capture._write_candidate(cand("deployment", "docker compose on freyr\ncaddy in front"), "deployment",
                                         "docker compose on freyr\ncaddy in front", ["u:proj", "u:default"], shown={}))
    assert cap.appended == [("u:proj", "deploy-setup", "caddy in front")]


def test_distinct_new_entry_is_saved(cap):
    cap.near = ("something-else", 0.5)
    asyncio.run(capture._write_candidate(cand("new-thing", "fact"), "new-thing", "fact", ["u:proj", "u:default"], shown={}))
    assert cap.saved == [("u:proj", "new-thing", "fact")]
