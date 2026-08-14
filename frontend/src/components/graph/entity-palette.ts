export const ENTITY_TYPES = [
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
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_TYPE_DESCRIPTIONS: Record<string, string> = {
  person: "A specific named human.",
  organization: "A company, team, institution, or group.",
  place: "A physical or geographic location.",
  machine: "A specific host, server, device, or board.",
  service: "A running program, daemon, or hosted service.",
  technology: "A protocol, language, library, tool, or standard.",
  config: "A specific setting, file, flag, or parameter.",
  network: "A network, interface, address, or connection.",
  project: "A named piece of work or product.",
  task: "An action item, TODO, or follow-up.",
  event: "A dated occurrence, session, incident, or milestone.",
  concept: "An abstract idea that fits none of the above.",
};

const DARK: Record<string, string> = {
  person: "#81b7fc",
  organization: "#c5a1ef",
  place: "#84c886",
  machine: "#41cad1",
  service: "#e597cb",
  technology: "#cbb358",
  config: "#e9a364",
  network: "#51ccb4",
  project: "#a8abfc",
  task: "#f5978b",
  event: "#a8c06a",
  concept: "#a7a49c",
};

const LIGHT: Record<string, string> = {
  person: "#3472be",
  organization: "#845ab0",
  place: "#34853b",
  machine: "#008790",
  service: "#a34e8a",
  technology: "#8b6f00",
  config: "#a85b00",
  network: "#008a72",
  project: "#6765bd",
  task: "#b34d43",
  event: "#657d00",
  concept: "#6b6961",
};

export function entityColor(type: string, theme: "light" | "dark"): string {
  const palette = theme === "dark" ? DARK : LIGHT;
  return palette[type] ?? palette.concept;
}
