import { describe, expect, it } from 'vitest';
import {
  projectOverviewBucketOf,
  projectOverviewChapters,
  projectOverviewCommitKind,
  projectOverviewIntegrationRisk,
  projectOverviewMergedBranch,
  projectOverviewWindowBuckets,
  validProjectOverviewInput,
} from '../project-overview';

describe('project overview commit kinds', () => {
  it.each([
    ['feat: add project overview', 'feat'],
    ['Feat(sidebar): open the overview', 'feat'],
    ['fix(git)!: count merges once', 'fix'],
    ['test: cover drift', 'test'],
    ['chore: release prep', 'chore'],
    ['docs: describe the overview', 'chore'],
    ['refactor: split the reader', 'chore'],
    ['perf: bound history', 'chore'],
    ["Merge branch 'feat/missions'", 'other'],
    ['update readme', 'other'],
  ] as const)('classifies %j as %s', (subject, kind) => {
    expect(projectOverviewCommitKind(subject)).toBe(kind);
  });
});

describe('project overview windows', () => {
  const now = Date.parse('2026-11-11T03:00:00Z');

  it('lists the last seven local days, ending on the reader\'s today', () => {
    expect(projectOverviewWindowBuckets('7d', now, 'America/Chicago')).toStrictEqual({
      bucket: 'day',
      starts: ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'],
    });
  });

  it('lists twelve Monday-started weeks ending with the current week', () => {
    const weeks = projectOverviewWindowBuckets('12w', now, 'UTC');
    expect(weeks.bucket).toBe('week');
    expect(weeks.starts).toHaveLength(12);
    expect(weeks.starts[0]).toBe('2026-08-24');
    expect(weeks.starts.at(-1)).toBe('2026-11-09');
  });

  it('sizes the thirty day and one year windows', () => {
    expect(projectOverviewWindowBuckets('30d', now, 'UTC').starts).toHaveLength(30);
    const year = projectOverviewWindowBuckets('1y', now, 'UTC');
    expect(year.bucket).toBe('week');
    expect(year.starts).toHaveLength(52);
  });

  it('places an instant in the local day or the Monday of its local week', () => {
    const sundayEvening = Date.parse('2026-11-09T02:30:00Z');
    expect(projectOverviewBucketOf(sundayEvening, 'day', 'America/Chicago')).toBe('2026-11-08');
    expect(projectOverviewBucketOf(sundayEvening, 'week', 'America/Chicago')).toBe('2026-11-02');
    expect(projectOverviewBucketOf(sundayEvening, 'week', 'UTC')).toBe('2026-11-09');
  });

  it('accepts only known windows and real time zones', () => {
    expect(validProjectOverviewInput(undefined)).toBe(true);
    expect(validProjectOverviewInput({})).toBe(true);
    expect(validProjectOverviewInput({ window: '30d', timeZone: 'Europe/Paris' })).toBe(true);
    expect(validProjectOverviewInput({ window: 'forever' })).toBe(false);
    expect(validProjectOverviewInput({ timeZone: 'Mars/Olympus' })).toBe(false);
    expect(validProjectOverviewInput({ window: '7d', path: '/etc' })).toBe(false);
    expect(validProjectOverviewInput('7d')).toBe(false);
  });
});

describe('project overview merged branches', () => {
  it.each([
    ["Merge branch 'feat/missions'", 'feat/missions'],
    ["Merge branch 'feat/git-log' into main", 'feat/git-log'],
    ['Merge pull request #12 from acme/feat/design-mode', 'feat/design-mode'],
    ["Merge branch 'main' into feat/missions", null],
    ["Merge remote-tracking branch 'origin/main' into feat/work-routing", null],
    ["Merge branch 'feat/git-log' into release", null],
    ['chore: merge main into missions', null],
  ] as const)('reads %j as %j', (subject, branch) => {
    expect(projectOverviewMergedBranch(subject, 'main')).toBe(branch);
  });
});

describe('project overview chapters', () => {
  const bucket = (start: string, mergedBranches: string[] = []) => ({ start, mergedBranches });

  it('names spans of buckets after the feature branches merged in them', () => {
    const chapters = projectOverviewChapters([
      bucket('2026-08-24'), bucket('2026-08-31'),
      bucket('2026-09-07'), bucket('2026-09-14', ['feat/missions', 'fix/gh-27', 'feat/design-mode']),
      bucket('2026-09-21', ['feat/visualize-excalidraw']), bucket('2026-09-28'),
      bucket('2026-10-05'), bucket('2026-10-12'),
      bucket('2026-10-19', ['mission/add-gitlab-alongside-github-across-projects-and--dd72f4']), bucket('2026-10-26'),
      bucket('2026-11-02'), bucket('2026-11-09'),
    ]);
    expect(chapters).toStrictEqual([
      { start: '2026-09-07', buckets: 2, title: 'Missions, Design mode', branches: ['feat/missions', 'feat/design-mode'] },
      { start: '2026-09-21', buckets: 2, title: 'Visualize excalidraw', branches: ['feat/visualize-excalidraw'] },
      { start: '2026-10-19', buckets: 2, title: 'Add gitlab alongside github across projects and', branches: ['mission/add-gitlab-alongside-github-across-projects-and--dd72f4'] },
    ]);
  });

  it('keeps one chapter per bucket in a short window and notes further branches', () => {
    const chapters = projectOverviewChapters([
      bucket('2026-11-08', ['feat/a', 'feat/b', 'feat/c', 'feat/a']),
      bucket('2026-11-09'),
    ]);
    expect(chapters).toStrictEqual([
      { start: '2026-11-08', buckets: 1, title: 'A, B +1', branches: ['feat/a', 'feat/b', 'feat/c'] },
    ]);
  });
});

describe('project overview integration risk', () => {
  it('is low with no reasons for a branch that matches a quiet base', () => {
    expect(projectOverviewIntegrationRisk({ behind: 0, changedFiles: 4, overlapFiles: 0, overlapBranches: 0, baseCommitsPerDay: 2, latestPipeline: null }))
      .toStrictEqual({ level: 'low', gitOnly: true, reasons: [] });
  });

  it('is medium when drift, overlap and a fast base add up', () => {
    expect(projectOverviewIntegrationRisk({ behind: 14, changedFiles: 9, overlapFiles: 3, overlapBranches: 2, baseCommitsPerDay: 22.4, latestPipeline: 'passed' }))
      .toStrictEqual({
        level: 'medium',
        gitOnly: false,
        reasons: [
          { kind: 'behind', commits: 14 },
          { kind: 'overlap', files: 3, branches: 2 },
          { kind: 'velocity', commitsPerDay: 22 },
        ],
      });
  });

  it('is high for a far-behind branch whose latest pipeline run failed', () => {
    const risk = projectOverviewIntegrationRisk({ behind: 31, changedFiles: 12, overlapFiles: 0, overlapBranches: 0, baseCommitsPerDay: 22, latestPipeline: 'failed' });
    expect(risk.level).toBe('high');
    expect(risk.reasons).toStrictEqual([{ kind: 'behind', commits: 31 }, { kind: 'velocity', commitsPerDay: 22 }, { kind: 'failingPipeline' }]);
  });

  it('is high for a very large change even when it is up to date', () => {
    const risk = projectOverviewIntegrationRisk({ behind: 0, changedFiles: 273, overlapFiles: 40, overlapBranches: 3, baseCommitsPerDay: 22, latestPipeline: null });
    expect(risk.level).toBe('high');
    expect(risk.reasons).toContainEqual({ kind: 'size', files: 273 });
  });

  it('does not count a slow base or a running pipeline against the branch', () => {
    expect(projectOverviewIntegrationRisk({ behind: 3, changedFiles: 2, overlapFiles: 0, overlapBranches: 0, baseCommitsPerDay: 9.4, latestPipeline: 'running' }))
      .toStrictEqual({ level: 'low', gitOnly: false, reasons: [{ kind: 'behind', commits: 3 }] });
  });
});
