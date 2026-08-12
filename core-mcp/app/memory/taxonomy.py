import re
from typing import Literal

RecallTier = Literal["always", "relevance", "manual"]

DEFAULT_RECALL = "relevance"

RECALL_TIER_DESCRIPTIONS: dict[str, str] = {
    "always": "Standing rule injected verbatim into every message, past the relevance gate.",
    "relevance": "Default: surfaced only when the current message is semantically close to it.",
    "manual": "Never auto-injected; returned only by an explicit memory_search / memory_list call.",
}

_RECALL_ALIASES: dict[str, str] = {
    "always": "always",
    "always_on": "always",
    "directive": "always",
    "guideline": "always",
    "guidelines": "always",
    "instruction": "always",
    "policy": "always",
    "rule": "always",
    "rules": "always",
    "standing": "always",
    "relevance": "relevance",
    "auto": "relevance",
    "contextual": "relevance",
    "default": "relevance",
    "search": "relevance",
    "manual": "manual",
    "explicit": "manual",
    "never": "manual",
    "on_demand": "manual",
    "opt_in": "manual",
}

DIRECTIVE_TYPES = frozenset(
    {"guideline", "guidelines", "rule", "rules", "directive", "policy", "instruction"}
)


def recall_tier(recall: str | None) -> str | None:
    """Strict lookup — None when the value names no recognizable tier."""
    return _RECALL_ALIASES.get((recall or "").strip().lower().replace("-", "_"))


def normalize_recall(recall: str | None, type: str = "") -> str:
    """Map a caller-supplied recall tier onto one of the three real tiers.

    Falls back to the subject `type` so a model that only knows the older
    `type="guideline"` convention still lands on the always-on tier, and to
    `relevance` for anything unrecognized — an unknown tier must never silently
    promote an entry into every prompt."""
    tier = recall_tier(recall)
    if tier:
        return tier
    if (type or "").strip().lower() in DIRECTIVE_TYPES:
        return "always"
    return DEFAULT_RECALL


_RULE_MARKERS = re.compile(
    r"\b(never|always|don'?t|do not|must not|should not|avoid|refuse to|"
    r"under no circumstances|unless (?:explicitly|asked|i |the user)|"
    r"only (?:when|if|ever)|prefer .+ over|stop (?:using|doing))\b",
    re.IGNORECASE,
)


def rule_like_statements(text: str, limit: int = 4) -> list[str]:
    """Sentences that read like standing behavioral rules, used to flag memories
    filed under a relevance tier that are really directives in disguise. A hint
    for human review in the dashboard — deliberately never acts on its own."""
    found: list[str] = []
    for raw in re.split(r"(?<=[.!?])\s+|\n+", text or ""):
        statement = raw.strip(" -•\t*")
        if not 12 <= len(statement) <= 240:
            continue
        if _RULE_MARKERS.search(statement):
            found.append(statement)
            if len(found) >= limit:
                break
    return found


EntityType = Literal[
    "person",
    "organization",
    "place",
    "machine",
    "service",
    "technology",
    "config",
    "network",
    "project",
    "task",
    "event",
    "concept",
]

ENTITY_TYPE_DESCRIPTIONS: dict[str, str] = {
    "person": "A specific named human.",
    "organization": "A company, team, institution, or group.",
    "place": "A physical or geographic location (city, room, building).",
    "machine": "A specific host, server, device, or board (e.g. freyr, an ESP32).",
    "service": "A running program, daemon, or hosted service (e.g. Redis, xrdp, nginx).",
    "technology": "A protocol, language, library, tool, or standard (e.g. IPv6, Docker, httpx).",
    "config": "A specific setting, file, flag, or parameter (e.g. disable_ipv6, sesman.ini).",
    "network": "A network, interface, address, or connection (e.g. enp7s0, a Tailscale IP).",
    "project": "A named piece of work or product (e.g. Continuum, claude-usage).",
    "task": "An action item, TODO, or follow-up to be done.",
    "event": "A dated occurrence, session, incident, or milestone.",
    "concept": "Fallback: an abstract idea that fits none of the above.",
}

PREDICATE_GUIDANCE = (
    "Predicates must be SHORT, UPPER_SNAKE_CASE, DIRECTIONAL relational phrases "
    "(usually ending in a preposition), not active past-tense verbs.\n"
    "Prefer these canonical predicates when they fit: RUNS_ON, HOSTS, "
    "LOCATED_ON, INSTALLED_ON, DISABLED_ON, ENABLED_ON, CONFIGURED_WITH, "
    "BINDS_TO, LISTENS_ON, DEPENDS_ON, CONNECTS_TO, USES, NEEDS, REMOVED_FROM, "
    "CAUSED, RESOLVED_BY, PART_OF, HAS_STATUS, WORKS_AT, OWNS.\n"
    "DIRECTION RULE: the source is the specific/dependent entity, the target is "
    "the host/container/context. A service RUNS_ON a machine (source=service, "
    "target=machine) — never the reverse. Write 'Redis RUNS_ON freyr', NOT "
    "'freyr RUNS Redis'. Write 'IPv6 DISABLED_ON enp7s0', NOT 'enp7s0 DISABLED IPv6'.\n"
    "Never write a full sentence, and never invent an active verb when a "
    "canonical relational predicate fits."
)


def entity_type_block() -> str:
    """The described type list, formatted for the extraction prompt."""
    return "\n".join(
        f"- {name}: {desc}" for name, desc in ENTITY_TYPE_DESCRIPTIONS.items()
    )
