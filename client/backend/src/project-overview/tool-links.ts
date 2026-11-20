import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectFlowStationKinds, type ProjectFlowStationKind, type ProjectToolKind, type ProjectToolLinks } from '@workspace/core/project-overview';

/** A tool the commit history points at, offered for the user to accept by editing the config file. */
export type ProjectToolProposal = {
  tool: ProjectToolKind;
  label: string;
  station: ProjectFlowStationKind;
  /** Null when only issue keys were seen and the tracker's address is unknown. */
  url: string | null;
  keys: string[];
  reason: string;
};

const configFileName = 'project.json';
const maxLabel = 60;
const minimumMentions = 3;
/** Uppercase prefixes that read like issue keys but are standards and encodings. */
const notIssueKeys = new Set(['UTF', 'SHA', 'ISO', 'CVE', 'RFC', 'GPT', 'TLS', 'AES', 'HTTP', 'ECMA', 'ES', 'MD', 'PEP', 'IPV', 'X', 'TS', 'ARM']);

const stationPages = {
  gitlab: { backlog: ['GitLab issues', '/-/issues'], building: ['GitLab repository', ''], review: ['GitLab merge requests', '/-/merge_requests'], ci: ['GitLab CI', '/-/pipelines'], shipped: ['GitLab releases', '/-/releases'] },
  github: { backlog: ['GitHub issues', '/issues'], building: ['GitHub repository', ''], review: ['GitHub pull requests', '/pulls'], ci: ['GitHub Actions', '/actions'], shipped: ['GitHub releases', '/releases'] },
} as const satisfies Record<'gitlab' | 'github', Record<ProjectFlowStationKind, readonly [string, string]>>;

function projectToolKindOf(url: string): ProjectToolKind {
  const host = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();
  if (host === 'github.com' || host.endsWith('.github.com')) return 'github';
  if (host.includes('gitlab')) return 'gitlab';
  if (host.endsWith('atlassian.net') || host.includes('jira')) return 'jira';
  if (host === 'linear.app') return 'linear';
  return 'link';
}

/** Links for every station when the remote is a GitHub or GitLab host; nothing for a host this cannot recognize. */
export function inferProjectToolLinks(remoteIdentity: string | undefined): ProjectToolLinks {
  const host = remoteIdentity?.split('/')[0]?.toLowerCase() ?? '';
  const kind = host === 'github.com' ? 'github' : host.includes('gitlab') ? 'gitlab' : null;
  if (!remoteIdentity || !kind) return {};
  const base = `https://${remoteIdentity}`;
  return Object.fromEntries(projectFlowStationKinds.map(station => {
    const [label, suffix] = stationPages[kind][station];
    return [station, { label, url: `${base}${suffix}`, tool: kind }];
  }));
}

/** Trackers the commit messages refer to: by the links they contain, or by issue keys seen often enough. */
export function proposeProjectTools(messages: readonly string[]): ProjectToolProposal[] {
  const keys = new Map<string, { messages: number; numbers: Set<string> }>();
  const sites = new Map<string, { tool: 'jira' | 'linear'; host: string; url: string; keys: Set<string> }>();
  for (const message of messages) {
    const seen = new Set<string>();
    for (const [, prefix, number] of message.matchAll(/\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/gu)) {
      if (notIssueKeys.has(prefix!)) continue;
      const entry = keys.get(prefix!) ?? { messages: 0, numbers: new Set<string>() };
      entry.numbers.add(number!);
      if (!seen.has(prefix!)) entry.messages += 1;
      seen.add(prefix!);
      keys.set(prefix!, entry);
    }
    for (const [url] of message.matchAll(/https:\/\/[^\s)>\]"']+/gu)) {
      const jira = /^https:\/\/([a-z0-9-]+\.atlassian\.net)\/browse\/([A-Z][A-Z0-9]{1,9})-\d+/u.exec(url);
      const linear = /^https:\/\/linear\.app\/([a-z0-9-]+)\/issue\/([A-Z][A-Z0-9]{1,9})-\d+/u.exec(url);
      const site = jira ? { tool: 'jira' as const, host: jira[1]!, url: `https://${jira[1]}/browse`, key: jira[2]! }
        : linear ? { tool: 'linear' as const, host: 'linear.app', url: `https://linear.app/${linear[1]}`, key: linear[2]! } : null;
      if (!site) continue;
      const entry = sites.get(site.url) ?? { tool: site.tool, host: site.host, url: site.url, keys: new Set<string>() };
      entry.keys.add(site.key);
      sites.set(site.url, entry);
    }
  }
  const frequent = new Set([...keys].filter(([, entry]) => entry.messages >= minimumMentions && entry.numbers.size >= 2).map(([prefix]) => prefix));
  const mentions = (prefixes: string[]) => prefixes.reduce((sum, prefix) => sum + (keys.get(prefix)?.messages ?? 0), 0);
  const proposals: ProjectToolProposal[] = [];
  const claimed = new Set<string>();
  for (const site of sites.values()) {
    const siteKeys = [...site.keys].filter(prefix => frequent.has(prefix)).sort();
    if (!siteKeys.length) continue;
    siteKeys.forEach(prefix => claimed.add(prefix));
    proposals.push({
      tool: site.tool, label: site.tool === 'jira' ? 'Jira' : 'Linear', station: 'backlog', url: site.url, keys: siteKeys,
      reason: `${mentions(siteKeys)} commit messages mention ${siteKeys.join(', ')} keys and link to ${site.host}.`,
    });
  }
  for (const prefix of [...frequent].filter(prefix => !claimed.has(prefix)).sort()) {
    proposals.push({
      tool: 'link', label: `Issue tracker for ${prefix}`, station: 'backlog', url: null, keys: [prefix],
      reason: `${mentions([prefix])} commit messages mention ${prefix} keys. Add the tracker URL to use it.`,
    });
  }
  return proposals;
}

function validLinks(value: unknown): ProjectToolLinks {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const links: ProjectToolLinks = {};
  for (const station of projectFlowStationKinds) {
    const entry = (value as Record<string, unknown>)[station];
    if (!entry || typeof entry !== 'object') continue;
    const { label, url } = entry as Record<string, unknown>;
    if (typeof label !== 'string' || !label.trim() || label.length > maxLabel || typeof url !== 'string') continue;
    let parsed: URL;
    try { parsed = new URL(url); } catch { continue; }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
    links[station] = { label: label.trim(), url: parsed.toString(), tool: projectToolKindOf(url) };
  }
  return links;
}

/**
 * The project's own tool links, kept at `<repository>/<home directory>/project.json` so people can read,
 * edit and share them. Written once from what the git remote and commits show; never rewritten after.
 */
export class ProjectToolConfigFile {
  constructor(private readonly directoryName: string) {}

  async load(repositoryRoot: string, infer: () => { links: ProjectToolLinks; proposals: ProjectToolProposal[] }): Promise<ProjectToolLinks> {
    const directory = path.join(repositoryRoot, this.directoryName);
    const file = path.join(directory, configFileName);
    let text: string | null = null;
    try { text = await readFile(file, 'utf8'); } catch { /* No config yet. */ }
    if (text !== null) {
      // A file the user is still editing is left alone; its links return when it parses again.
      try { return validLinks((JSON.parse(text) as { tools?: unknown }).tools); } catch { return {}; }
    }
    const inferred = infer();
    try {
      await mkdir(directory).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify({
        schemaVersion: 1,
        about: 'Links from the project overview to the tools behind each stage. Edit them freely; this file is never rewritten. Proposals were found in commit messages: copy one into tools to use it.',
        tools: Object.fromEntries(Object.entries(inferred.links).map(([station, link]) => [station, { label: link.label, url: link.url }])),
        proposals: inferred.proposals,
      }, null, 2)}\n`, { flag: 'wx' });
      await rename(temporary, file);
    } catch {
      // A read-only or vanished checkout still gets its inferred links for this read.
    }
    return inferred.links;
  }
}

