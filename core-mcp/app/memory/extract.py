import os

from pydantic import BaseModel, Field

from . import taxonomy
from .llm import structured


class Entity(BaseModel):
    name: str = Field(description="Canonical name of the entity as it should appear as a node.")
    type: taxonomy.EntityType = Field(description="The single best-fitting type from the provided list.")
    summary: str = Field(description="One short sentence describing this entity, based only on the text.")


class Relation(BaseModel):
    source: str = Field(description="Name of the source entity (must match an entity's name).")
    target: str = Field(description="Name of the target entity (must match an entity's name).")
    predicate: str = Field(description="Short UPPER_SNAKE_CASE directed verb phrase.")
    fact: str = Field(description="A single natural-language sentence stating the fact this edge represents.")
    valid_at: str | None = Field(
        default=None,
        description="ISO-8601 date/datetime the fact became true, if the text states or implies one; else null.",
    )
    invalid_at: str | None = Field(
        default=None,
        description="ISO-8601 date/datetime the fact stopped being true, if stated; else null.",
    )


class ExtractedGraph(BaseModel):
    entities: list[Entity]
    relations: list[Relation]


_WORKED_EXAMPLE = (
    "Worked example — for the sentence 'On freyr, Redis was left bound to "
    "0.0.0.0 unauthenticated and still needs requirepass; warp-svc was removed':\n"
    "  entities: freyr (machine), Redis (service), 0.0.0.0 (network), "
    "requirepass (config), warp-svc (service)\n"
    "  relations:\n"
    "    Redis RUNS_ON freyr\n"
    "    Redis BINDS_TO 0.0.0.0\n"
    "    Redis HAS_STATUS unauthenticated   (target may be a short concept)\n"
    "    Redis NEEDS requirepass\n"
    "    warp-svc REMOVED_FROM freyr\n"
)


def _build_prompt(text: str, reference_time_iso: str) -> str:
    return (
        "Extract a knowledge graph from the text below.\n\n"
        f"Reference time (treat relative dates like 'yesterday' relative to this): {reference_time_iso}\n\n"
        "Entity types (choose the single best fit for each entity):\n"
        f"{taxonomy.entity_type_block()}\n\n"
        f"{taxonomy.PREDICATE_GUIDANCE}\n\n"
        "Rules:\n"
        "- Extract every distinct entity once. Do not create duplicate entities "
        "for the same thing mentioned multiple times.\n"
        "- Keep concrete values as their own entity: use the actual IP address, "
        "port number, or flag name (e.g. '100.111.19.69', '6379', 'requirepass'), "
        "not a vague label like 'the Tailscale IP'.\n"
        "- Capture obligations and follow-ups as NEEDS edges, states as HAS_STATUS "
        "edges, and causes as CAUSED edges. Do not drop security TODOs or the "
        "reason something was done.\n"
        "- Every relation's source and target must exactly match an extracted entity name.\n"
        "- Prefer specific, factual relations over vague ones. Skip trivia.\n\n"
        f"{_WORKED_EXAMPLE}\n"
        f"Text:\n{text}"
    )


def _glean_prompt(text: str, reference_time_iso: str, current: "ExtractedGraph") -> str:
    have_entities = ", ".join(sorted({e.name for e in current.entities})) or "(none)"
    have_relations = (
        "\n".join(f"  {r.source} {r.predicate} {r.target}" for r in current.relations) or "  (none)"
    )
    return (
        "You already extracted the following graph from the text. Find ONLY what "
        "was MISSED — entities and relations that are clearly stated in the text "
        "but absent below. Return just the additions, in the same format. Return "
        "empty lists if nothing was missed.\n"
        "Add ONLY facts stated directly in the text — never infer or invent a "
        "relationship to fill a gap. If something was done for a stated reason, "
        "capture that reason as a CAUSED edge (cause CAUSED effect), e.g. "
        "'hanging calls CAUSED IPv6 disable'.\n\n"
        f"Reference time: {reference_time_iso}\n\n"
        f"{taxonomy.PREDICATE_GUIDANCE}\n\n"
        f"Already-extracted entities: {have_entities}\n"
        f"Already-extracted relations:\n{have_relations}\n\n"
        f"Text:\n{text}"
    )


def _merge(base: "ExtractedGraph", extra: "ExtractedGraph") -> "ExtractedGraph":
    seen_entities = {e.name.strip().lower() for e in base.entities}
    for e in extra.entities:
        if e.name.strip().lower() not in seen_entities:
            base.entities.append(e)
            seen_entities.add(e.name.strip().lower())
    seen_relations = {
        (r.source.strip().lower(), r.predicate.strip().lower(), r.target.strip().lower())
        for r in base.relations
    }
    for r in extra.relations:
        key = (r.source.strip().lower(), r.predicate.strip().lower(), r.target.strip().lower())
        if key not in seen_relations:
            base.relations.append(r)
            seen_relations.add(key)
    return base


async def extract_graph(text: str, reference_time_iso: str) -> ExtractedGraph:
    graph = await structured(_build_prompt(text, reference_time_iso), ExtractedGraph)

    rounds = int(os.environ.get("CONTINUUM_KG_GLEANING_ROUNDS", "1"))
    for _ in range(max(0, rounds)):
        extra = await structured(_glean_prompt(text, reference_time_iso, graph), ExtractedGraph)
        if not extra.entities and not extra.relations:
            break
        graph = _merge(graph, extra)

    return graph
