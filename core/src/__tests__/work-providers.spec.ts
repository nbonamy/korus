import { describe, expect, it } from 'vitest';
import { workProviderForRepositoryId } from '../work-providers';

describe('workProviderForRepositoryId', () => {
  it('maps a repository identity to the provider that hosts it', () => {
    expect(workProviderForRepositoryId('github.com/owner/repo')).toBe('github');
    expect(workProviderForRepositoryId('gitlab.com/group/sub/project')).toBe('gitlab');
    expect(workProviderForRepositoryId('example.com/team/repo')).toBeUndefined();
    expect(workProviderForRepositoryId(null)).toBeUndefined();
  });
});
