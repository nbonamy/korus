import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectToolConfigFile, inferProjectToolLinks, proposeProjectTools } from '../tool-links';

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });
async function repository() {
  const folder = await mkdtemp(join(tmpdir(), 'korus-tools-'));
  folders.push(folder);
  return folder;
}

describe('tool links from the git remote', () => {
  it('links each station to the matching GitLab page, including a self-hosted GitLab', () => {
    expect(inferProjectToolLinks('gitlab.com/acme/platform/api')).toStrictEqual({
      backlog: { label: 'GitLab issues', url: 'https://gitlab.com/acme/platform/api/-/issues', tool: 'gitlab' },
      building: { label: 'GitLab repository', url: 'https://gitlab.com/acme/platform/api', tool: 'gitlab' },
      review: { label: 'GitLab merge requests', url: 'https://gitlab.com/acme/platform/api/-/merge_requests', tool: 'gitlab' },
      ci: { label: 'GitLab CI', url: 'https://gitlab.com/acme/platform/api/-/pipelines', tool: 'gitlab' },
      shipped: { label: 'GitLab releases', url: 'https://gitlab.com/acme/platform/api/-/releases', tool: 'gitlab' },
    });
    expect(inferProjectToolLinks('gitlab.acme.dev/team/app').ci).toStrictEqual({ label: 'GitLab CI', url: 'https://gitlab.acme.dev/team/app/-/pipelines', tool: 'gitlab' });
  });

  it('links each station to the matching GitHub page', () => {
    expect(inferProjectToolLinks('github.com/nbonamy/korus')).toStrictEqual({
      backlog: { label: 'GitHub issues', url: 'https://github.com/nbonamy/korus/issues', tool: 'github' },
      building: { label: 'GitHub repository', url: 'https://github.com/nbonamy/korus', tool: 'github' },
      review: { label: 'GitHub pull requests', url: 'https://github.com/nbonamy/korus/pulls', tool: 'github' },
      ci: { label: 'GitHub Actions', url: 'https://github.com/nbonamy/korus/actions', tool: 'github' },
      shipped: { label: 'GitHub releases', url: 'https://github.com/nbonamy/korus/releases', tool: 'github' },
    });
  });

  it('infers nothing from a host it cannot recognize or a missing remote', () => {
    expect(inferProjectToolLinks('git.acme.dev/team/app')).toStrictEqual({});
    expect(inferProjectToolLinks(undefined)).toStrictEqual({});
  });
});

describe('tools proposed from commit messages', () => {
  it('proposes Jira at the site its links point to, with the keys it saw', () => {
    const messages = [
      'fix: handle empty carts\n\nhttps://acme.atlassian.net/browse/SHOP-12',
      'feat: add coupons (SHOP-15)', 'SHOP-18 retry payments', 'chore: bump UTF-8 handling and SHA-256 hashes',
      'fix: SHA-256 again', 'fix: UTF-8 again', 'docs: ISO-8601 dates',
    ];
    expect(proposeProjectTools(messages)).toStrictEqual([
      { tool: 'jira', label: 'Jira', station: 'backlog', url: 'https://acme.atlassian.net/browse', keys: ['SHOP'], reason: '3 commit messages mention SHOP keys and link to acme.atlassian.net.' },
    ]);
  });

  it('proposes Linear from its links, and an unknown tracker from keys alone', () => {
    expect(proposeProjectTools(['fix: ENG-4 crash https://linear.app/acme/issue/ENG-4/crash', 'ENG-7 polish', 'ENG-9 tidy'])).toStrictEqual([
      { tool: 'linear', label: 'Linear', station: 'backlog', url: 'https://linear.app/acme', keys: ['ENG'], reason: '3 commit messages mention ENG keys and link to linear.app.' },
    ]);
    expect(proposeProjectTools(['OPS-1 deploy', 'OPS-2 deploy', 'OPS-3 rollback'])).toStrictEqual([
      { tool: 'link', label: 'Issue tracker for OPS', station: 'backlog', url: null, keys: ['OPS'], reason: '3 commit messages mention OPS keys. Add the tracker URL to use it.' },
    ]);
  });

  it('ignores a key seen too rarely or always with the same number', () => {
    expect(proposeProjectTools(['ENG-4 a', 'ENG-4 b', 'ENG-4 c'])).toStrictEqual([]);
    expect(proposeProjectTools(['ENG-4 a', 'ENG-5 b'])).toStrictEqual([]);
  });
});

describe('the project tool config file', () => {
  const inferred = () => ({ links: inferProjectToolLinks('gitlab.com/acme/api'), proposals: proposeProjectTools(['OPS-1 a', 'OPS-2 b', 'OPS-3 c']) });

  it('writes what it inferred the first time, so the user can edit it, and reads it from then on', async () => {
    const root = await repository();
    const file = new ProjectToolConfigFile('.korus');
    const links = await file.load(root, inferred);
    expect(links.backlog).toStrictEqual({ label: 'GitLab issues', url: 'https://gitlab.com/acme/api/-/issues', tool: 'gitlab' });
    const written = JSON.parse(await readFile(join(root, '.korus', 'project.json'), 'utf8'));
    expect(written).toMatchObject({ schemaVersion: 1, tools: { ci: { label: 'GitLab CI', url: 'https://gitlab.com/acme/api/-/pipelines' } }, proposals: [{ keys: ['OPS'], url: null }] });

    // The user edits the file: their links win, and the file is never rewritten.
    written.tools.backlog = { label: 'Jira board', url: 'https://acme.atlassian.net/jira/software/projects/OPS/boards/1' };
    delete written.tools.shipped;
    const edited = `${JSON.stringify(written, null, 2)}\n`;
    await writeFile(join(root, '.korus', 'project.json'), edited);
    const reread = await file.load(root, inferred);
    expect(reread.backlog).toStrictEqual({ label: 'Jira board', url: 'https://acme.atlassian.net/jira/software/projects/OPS/boards/1', tool: 'jira' });
    expect(reread.shipped).toBeUndefined();
    expect(await readFile(join(root, '.korus', 'project.json'), 'utf8')).toBe(edited);
  });

  it('keeps only safe web links and leaves a file it cannot read untouched', async () => {
    const root = await repository();
    await mkdir(join(root, '.korus'));
    await writeFile(join(root, '.korus', 'project.json'), JSON.stringify({ schemaVersion: 1, tools: {
      backlog: { label: 'Board', url: 'javascript:alert(1)' },
      building: { label: 'Repo', url: 'file:///etc/passwd' },
      review: { label: 'x'.repeat(200), url: 'https://example.com/reviews' },
      ci: { label: 'Builds', url: 'https://ci.example.com/app' },
      unknown: { label: 'Other', url: 'https://example.com' },
    } }));
    expect(await new ProjectToolConfigFile('.korus').load(root, inferred)).toStrictEqual({ ci: { label: 'Builds', url: 'https://ci.example.com/app', tool: 'link' } });

    await writeFile(join(root, '.korus', 'project.json'), '{ not json');
    expect(await new ProjectToolConfigFile('.korus').load(root, inferred)).toStrictEqual({});
    expect(await readFile(join(root, '.korus', 'project.json'), 'utf8')).toBe('{ not json');
  });

  it('still answers the inferred links when the repository cannot be written', async () => {
    const links = await new ProjectToolConfigFile('.korus').load(join(await repository(), 'missing', 'deeper'), inferred);
    expect(links.review).toStrictEqual({ label: 'GitLab merge requests', url: 'https://gitlab.com/acme/api/-/merge_requests', tool: 'gitlab' });
  });
});
