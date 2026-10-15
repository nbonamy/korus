/** App-owned attention markers, independent of provider transcript revisions. */
export type AgentReadState = { revision: number; readRevision: number };
export function isAgentReadState(value: unknown): value is AgentReadState {
  if (!value || typeof value !== 'object') return false;
  const state = value as AgentReadState;
  return Number.isSafeInteger(state.revision) && state.revision >= 0
    && Number.isSafeInteger(state.readRevision) && state.readRevision >= 0 && state.readRevision <= state.revision;
}
export function hasUnreadActivity(agent: { readState?: AgentReadState }): boolean {
  return Boolean(agent.readState && agent.readState.revision > agent.readState.readRevision);
}
