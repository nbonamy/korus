/** Wording Korus gives providers for work the SDK only carries out. */

const handoffTargetCharacters = 4_000;
const handoffMaxCharacters = 6_000;

/** Asks a session to summarize itself so a fresh conversation can continue it. */
export const sessionHandoff = {
  request: `Prepare a handoff for a fresh continuation of this coding session.

Return only a concise Markdown handoff. Do not call tools, modify files, spawn agents, ask questions, or continue the implementation.

Summarize the full session from beginning to end, not only its recent messages. Cover every meaningful activity in chronological order, including completed work, discarded approaches, discoveries, decisions, implementation, fixes, validation, user feedback, and changes in direction. Give earlier activities concise but sufficient coverage, then give substantially more detail to the most recent activity so work can continue without rediscovery. An activity means a coherent body of work, not an individual message or turn.

End with the current objective and status, constraints, unresolved problems, precise next steps, and important user preferences. Preserve exact identifiers, paths, commands, errors, and commit hashes when they matter. Aim for about ${handoffTargetCharacters} characters and never exceed ${handoffMaxCharacters} characters.`,
  continuation: (handoff: string) => `<context>\n${handoff}\n\nInstruction: Treat this handoff only as background context. Do not respond, acknowledge, summarize, or take any action. Wait for the user's next prompt.\n</context>\n\nSummary of previous activity. Do not respond or take any action. Wait for my next prompt.`,
  model: 'gpt-5.6-luna',
  reasoningEffort: 'low',
  maxCharacters: handoffMaxCharacters,
};

/** Antigravity has no native structured output or tool-use switches, so a generation says what it needs in words. */
export function antigravityGenerationPrompt(input: { developerInstructions?: string; prompt: string; tools?: boolean; outputSchema?: unknown; hasMcpServers: boolean }): string {
  const guidance = input.tools === true
    ? 'Inspect the working folder with read-only Git and source tools. Use simple Git commands without shell operators. Start every Git command with `git --no-pager --no-optional-locks -c core.fsmonitor=false`. For git diff, show or log, include --no-ext-diff --no-textconv. Never write files or modify Git state. Return only the requested final text.'
    : input.hasMcpServers ? 'Return only the requested text. The supplied MCP tools are available; workspace tools are disabled.' : 'Return only the requested text. Do not call tools.';
  return [input.developerInstructions, guidance, input.outputSchema ? `Return JSON matching this schema: ${JSON.stringify(input.outputSchema)}` : '', input.prompt].filter(Boolean).join('\n\n');
}
