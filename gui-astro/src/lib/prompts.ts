// Default statusi (10) — isti kao u Next app-u.
// Default promptovi — samo ne-AI placeholder; AI generisanje emaila je uklonjeno.
export interface DefaultStatus {
  name: string;
  color: string;
  isTerminalWon?: boolean;
  isTerminalLost?: boolean;
  sortOrder: number;
  systemDefault?: boolean;
}

export const DEFAULT_STATUSES: DefaultStatus[] = [
  { name: "Novi", color: "#64748b", sortOrder: 1 },
  { name: "Zovem", color: "#0ea5e9", sortOrder: 2 },
  { name: "Zvao sam", color: "#3b82f6", sortOrder: 3 },
  { name: "Javio se", color: "#10b981", sortOrder: 4 },
  { name: "Nije se javio", color: "#f59e0b", sortOrder: 5 },
  { name: "Dogovoren sastanak", color: "#8b5cf6", sortOrder: 6 },
  { name: "Odgovorio", color: "#22c55e", sortOrder: 7 },
  { name: "Klijent", color: "#16a34a", isTerminalWon: true, sortOrder: 8 },
  { name: "Odbijen", color: "#ef4444", isTerminalLost: true, sortOrder: 9 },
  { name: "Ne kontaktiraj", color: "#9ca3af", isTerminalLost: true, sortOrder: 10 },
];

export interface DefaultPrompt {
  name: string;
  type: string;
  body: string;
}

export const DEFAULT_PROMPTS: DefaultPrompt[] = []; // AI promptovi uklonjeni
