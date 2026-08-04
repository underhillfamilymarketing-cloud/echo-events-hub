export type ProjectDef = {
  id: string;
  name: string;
  short: string;
  color: string;
};

export const PROJECTS: ProjectDef[] = [
  { id: "echo", name: "ECHO Marketing", short: "ECHO", color: "var(--p-echo)" },
  {
    id: "underhill",
    name: "Underhill Resort & SPA",
    short: "Underhill Resort & SPA",
    color: "var(--p-underhill)",
  },
  { id: "hazard", name: "HAZARD", short: "HAZARD", color: "var(--p-hazard)" },
  { id: "arkan-group", name: "ARKAN GROUP", short: "ARKAN GROUP", color: "var(--p-arkan-group)" },
  { id: "arkan-arena", name: "ARKAN ARENA", short: "ARKAN ARENA", color: "var(--p-arkan-arena)" },
  {
    id: "pool",
    name: "Pool Cruce de Mares",
    short: "Pool Cruce de Mares",
    color: "var(--p-pool)",
  },
  { id: "gustos", name: "Cruce de gustos", short: "Cruce de gustos", color: "var(--p-gustos)" },
  { id: "el-cofre", name: "El Cofre", short: "El Cofre", color: "var(--p-el-cofre)" },
  { id: "provence", name: "La Provence", short: "La Provence", color: "var(--p-provence)" },
  { id: "rebar", name: "Rebar", short: "Rebar", color: "var(--p-rebar)" },
  {
    id: "park",
    name: "Парк історії землі",
    short: "Парк історії землі",
    color: "var(--p-park)",
  },
  { id: "hype", name: "HYPE", short: "HYPE", color: "var(--p-hype)" },
  {
    id: "passport",
    name: "Паспорт країни",
    short: "Паспорт країни",
    color: "var(--p-passport)",
  },
  { id: "other", name: "Інше", short: "Інше", color: "var(--p-other)" },
];

const map = new Map(PROJECTS.map((p) => [p.id, p]));

export function getProject(id: string): ProjectDef {
  return map.get(id) ?? { id, name: id, short: id, color: "var(--p-other)" };
}
