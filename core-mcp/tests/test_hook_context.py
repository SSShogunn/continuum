"""Hook context assembly: session dedup, per-item floor, cross-owner ranking.

Postgres, Redis and the embedding model are replaced with in-memory fakes; the
code under test is the assembly logic in app.memory.prompt.
"""

import asyncio

import pytest

from app.memory import hook_session, prompt


class FakeRedis:
    def __init__(self):
        self.kv, self.sets = {}, {}

    async def get(self, key):
        return self.kv.get(key)

    async def set(self, key, value, ex=None):
        self.kv[key] = value.encode()

    async def delete(self, *keys):
        for k in keys:
            self.kv.pop(k, None)
            self.sets.pop(k, None)

    async def smismember(self, key, members):
        return [m in self.sets.get(key, set()) for m in members]

    async def sadd(self, key, *members):
        self.sets.setdefault(key, set()).update(members)

    async def expire(self, key, ttl):
        pass


def entry(name, score, description="d"):
    return {"name": name, "type": "project", "recall": "relevance", "description": description,
            "content": "", "score": score, "updated_at": "2026-01-01"}


def fact(text, score):
    return {"source": "a", "predicate": "IS", "target": "b", "fact": text, "episode_name": "e", "score": score}


@pytest.fixture
def store(monkeypatch):
    data = {
        "directives": {"u:proj": [], "u:default": [
            {"name": "no-emojis", "type": "guideline", "description": "Never use emojis", "content": "No emojis."}
        ]},
        "entries": {"u:proj": [entry("proj-arch", 0.02)], "u:default": [entry("user-role", 0.03), entry("proj-arch", 0.01)]},
        "facts": {"u:proj": [fact("api uses fastapi", 0.02)], "u:default": [fact("api uses fastapi", 0.01)]},
        "relevant": {"u:proj": True, "u:default": True},
        "search_kwargs": [],
        "embeds": 0,
    }

    async def embed(text):
        data["embeds"] += 1
        return [0.0]

    async def list_directives(owner):
        return data["directives"][owner]

    async def is_relevant(owner, emb):
        return data["relevant"][owner]

    async def msearch(query, top_k=5, owner="", recall_in=None, **kw):
        data["search_kwargs"].append(kw)
        return data["entries"][owner]

    async def fsearch(owner, query, top_k=5, **kw):
        data["search_kwargs"].append(kw)
        return data["facts"][owner]

    async def list_by_names(names, owner=""):
        return []

    monkeypatch.setattr(prompt, "embed", embed)
    monkeypatch.setattr(prompt.memory, "list_directives", list_directives)
    monkeypatch.setattr(prompt.memory, "search", msearch)
    monkeypatch.setattr(prompt.memory, "list_by_names", list_by_names)
    monkeypatch.setattr(prompt.search, "is_relevant", is_relevant)
    monkeypatch.setattr(prompt.search, "fact_search", fsearch)
    return data


def run(coro):
    return asyncio.run(coro)


def build(session=None, query="how is the proj api structured"):
    return run(prompt.build_hook_context("u:proj", query, extra_owner="u:default", workspace="proj", session=session))


def test_legacy_hook_without_session_gets_everything_every_time(store):
    for _ in range(2):
        result = build()
        assert "Never use emojis" in result["context"]
        assert result["memories"] == ["user-role", "proj-arch"]


def test_query_is_embedded_once_and_reused_with_floor(store):
    build()
    assert store["embeds"] == 1
    assert all(kw["query_embedding"] == [0.0] and kw["min_similarity"] == prompt.HOOK_ITEM_FLOOR
               for kw in store["search_kwargs"])


def test_owners_are_merged_ranked_and_deduped(store):
    result = build()
    assert result["memories"] == ["user-role", "proj-arch"]  # by score across owners, one proj-arch
    assert result["facts"] == 1
    assert result["context"].count("api uses fastapi") == 1


def test_session_sends_rules_and_items_once(store):
    session = hook_session.HookSession(FakeRedis(), "u", "sess-1")
    first = build(session)
    assert "Never use emojis" in first["context"] and first["memories"]

    second = build(session)
    assert second["context"] is None
    assert second["skipped_seen"] == 3 and second["directives"] == []


def test_new_match_later_in_session_is_still_sent(store):
    session = hook_session.HookSession(FakeRedis(), "u", "sess-1")
    build(session)
    store["entries"]["u:proj"].append(entry("deploy-notes", 0.05))
    result = build(session)
    assert result["memories"] == ["deploy-notes"]
    assert "Never use emojis" not in result["context"]


def test_changed_rules_are_resent_marked_updated(store):
    session = hook_session.HookSession(FakeRedis(), "u", "sess-1")
    build(session)
    store["directives"]["u:default"][0]["content"] = "No emojis, ever."
    result = build(session)
    assert "Standing rules (updated this session)" in result["context"]


def test_session_start_resets_what_was_seen(store):
    redis = FakeRedis()
    session = hook_session.HookSession(redis, "u", "sess-1")
    build(session)
    start = run(prompt.build_session_start_context("u:proj", extra_owner="u:default", workspace="proj", session=session))
    assert "Never use emojis" in start["context"]
    after = build(session)  # after compaction: items again, rules not (just delivered)
    assert after["memories"] == ["user-role", "proj-arch"]
    assert "Never use emojis" not in after["context"]


def test_irrelevant_message_injects_nothing_once_rules_delivered(store):
    store["relevant"] = {"u:proj": False, "u:default": False}
    session = hook_session.HookSession(FakeRedis(), "u", "sess-1")
    run(prompt.build_session_start_context("u:proj", extra_owner="u:default", workspace="proj", session=session))
    assert build(session, query="thanks")["context"] is None


def test_redis_failure_degrades_to_sending(store):
    class Broken(FakeRedis):
        async def smismember(self, key, members):
            raise ConnectionError("down")

        async def get(self, key):
            raise ConnectionError("down")

    result = build(hook_session.HookSession(Broken(), "u", "sess-1"))
    assert result["memories"] and "Never use emojis" in result["context"]
