/**
 * Browsing shares one desktop profile; visualizations remain isolated per agent.
 * The renderer creates the guest element; Electron main retains navigation policy.
 */
export function browserGuestPartition(agentId: string, visualization = false): string {
  const name = safePartitionName(agentId);
  return visualization
    ? `agent-workspace-visualization-${name}`
    : 'persist:workspace-browser';
}

export function isBrowserGuestPartition(value: string): boolean {
  return /^persist:workspace-browser$|^agent-workspace-visualization-[a-zA-Z\d_-]+$/u.test(value);
}

export function safePartitionName(agentId: string): string {
  return agentId.replace(/[^a-zA-Z\d_-]/gu, '-').slice(0, 80) || 'default';
}
