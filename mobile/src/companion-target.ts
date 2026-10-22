import type { CompanionTarget } from '@workspace/core/companion-protocol';

/** Two targets name the same host, location, team, agent and session. */
export const sameTarget = (a: CompanionTarget, b: CompanionTarget) => (Object.keys(a) as (keyof CompanionTarget)[]).every(key => a[key] === b[key]);
