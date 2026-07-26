from typing import Literal

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
