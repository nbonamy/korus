import { getLocalClaudeAuthentication as nativeCheck, logoutLocalClaude as nativeLogout } from '@korus-dev/multi-agent-sdk/providers/claude';
import { resolveClaudeLaunch } from './claude-command';
export function getLocalClaudeAuthentication() { return nativeCheck({ resolveLaunch: resolveClaudeLaunch }); }
export function logoutLocalClaude() { return nativeLogout({ resolveLaunch: resolveClaudeLaunch }); }
