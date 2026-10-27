import { product } from '@workspace/core/product';

const missionInstructions = [
  `The user asks you to start a ${product.name} Mission for this work. A Mission runs the staged workflow (Requirements, Tickets, Implementation, Review, Ship) with its own lead, so do not start the work yourself.`,
  'Call the create-mission tool exactly once. Set outcome to a one-line title of the desired result (at most 120 characters).',
  'Set prompt to the complete first message for the Mission lead: the goal, constraints, decisions already made, relevant facts from this conversation and how success will be checked. The lead cannot see this conversation, so make the brief self-contained.',
  'If the user gave explicit instructions after /mission, follow them when writing the brief. Do not invent requirements or approvals the user has not given.',
  'When the tool returns, tell the user in one short sentence that the Mission was started.',
].join(' ');

export const MISSION_COMMAND_PROMPT = `Start a Mission for this work.\n\n<context>\n${missionInstructions}\n</context>`;

/** Turns `/mission [instructions]` into a request the model fulfils with the create-mission tool. */
export function expandMissionCommand(prompt: string): string | null {
  const match = /^\/mission(?:\s+([\s\S]*))?$/u.exec(prompt.trim());
  if (!match) return null;
  const task = match[1]?.trim();
  return task ? `${MISSION_COMMAND_PROMPT}\n\nMission request:\n${task}` : MISSION_COMMAND_PROMPT;
}
