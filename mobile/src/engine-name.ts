const known: Record<string, string> = { codex: 'Codex', claude: 'Claude', antigravity: 'Antigravity' };

/** How an engine id reads in the interface; an engine this app has not met is capitalized. */
export const engineName = (id: string) => known[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
