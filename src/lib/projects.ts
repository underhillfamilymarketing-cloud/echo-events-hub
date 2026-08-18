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
  { id: "pool", name: "Pool Cruce de Mares", short: "Pool Cruce de Mares", color: "var(--p-pool)" },
  { id: "gustos", name: "Cruce de gustos", short: "Cruce de gustos", color: "var(--p-gustos)" },
  { id: "el-cofre", name: "El Cofre", short: "El Cofre", color: "var(--p-el-cofre)" },
  { id: "provence", name: "La Provence", short: "La Provence", color: "var(--p-provence)" },
  { id: "rebar", name: "Rebar", short: "Rebar", color: "var(--p-rebar)" },
  {
    id: "park",
    name: "\u041f\u0430\u0440\u043a \u0456\u0441\u0442\u043e\u0440\u0456\u0457 \u0417\u0435\u043c\u043b\u0456",
    short:
      "\u041f\u0430\u0440\u043a \u0456\u0441\u0442\u043e\u0440\u0456\u0457 \u0417\u0435\u043c\u043b\u0456",
    color: "var(--p-park)",
  },
  { id: "hype", name: "HYPE", short: "HYPE", color: "var(--p-hype)" },
  {
    id: "passport",
    name: "\u041f\u0430\u0441\u043f\u043e\u0440\u0442 \u043a\u0440\u0430\u0457\u043d\u0438",
    short: "\u041f\u0430\u0441\u043f\u043e\u0440\u0442 \u043a\u0440\u0430\u0457\u043d\u0438",
    color: "var(--p-passport)",
  },
  {
    id: "other",
    name: "\u0406\u043d\u0448\u0435",
    short: "\u0406\u043d\u0448\u0435",
    color: "var(--p-other)",
  },
];

const map = new Map(PROJECTS.map((p) => [p.id, p]));

export function getProject(id: string): ProjectDef {
  return map.get(id) ?? { id, name: id, short: id, color: "var(--p-other)" };
}
