import path from 'node:path';
import { skillMetadata } from './skill-metadata';

const limit = 32 * 1024 * 1024;
export type DownloadedSkill = { name: string; description: string; source: string; revision: string; files: Map<string, { bytes: Buffer; mode: number }> };
type TreeEntry = { path: string; type: string; mode: string; size?: number };

/** Resolve a pasted source to a GitHub revision and its full file tree, without downloading any files. */
async function resolveTree(input: string) {
  const signal = AbortSignal.timeout(100_000);
  const get = (url: string) => boundedFetch(url, signal);
  const tokens = (input.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(token => token.replace(/^['"]|['"]$/g, ''));
  const raw = tokens.find(token => /^https:\/\//i.test(token)) ?? tokens.find(token => /^[\w.-]+\/[\w.-]+$/.test(token));
  let url: URL;
  try { url = new URL(raw?.startsWith('https://') ? raw : `https://github.com/${raw}`); }
  catch { throw new Error('Enter a GitHub URL, skills.sh URL or skills add command.'); }
  const parts = url.pathname.split('/').filter(Boolean);
  const directory = url.hostname === 'skills.sh' || url.hostname === 'www.skills.sh';
  if (url.protocol !== 'https:' || (!directory && url.hostname !== 'github.com') || url.port || url.username || url.password || parts.length < 2
    || parts.some(part => !/^[\w.@-]+$/.test(part)) || (!directory && parts.length > 2 && parts[2] !== 'tree') || (directory && parts.length !== 3)) {
    throw new Error('Only GitHub repository, skill-folder and skills.sh URLs are supported.');
  }
  const repo = `${parts[0]}/${parts[1]!.replace(/\.git$/, '')}`;
  const ref = !directory && parts[2] === 'tree' ? parts[3] : 'HEAD';
  if (!ref) throw new Error('The GitHub URL is missing its branch or revision.');
  const subpath = directory ? '' : parts.slice(4).join('/');
  const selectorAt = tokens.findIndex(token => token === '--skill' || token === '-s');
  const selector = directory ? parts[2] : selectorAt >= 0 ? tokens[selectorAt + 1] : tokens.find(token => token.startsWith('--skill='))?.slice(8);
  if (selectorAt >= 0 && !selector) throw new Error('The skill name is missing.');
  const metadata = JSON.parse((await get(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`)).toString()) as { sha?: string };
  if (!metadata.sha || !/^[a-f0-9]{40}$/.test(metadata.sha)) throw new Error('Could not resolve the GitHub revision.');
  const revision = metadata.sha;
  const tree = JSON.parse((await get(`https://api.github.com/repos/${repo}/git/trees/${revision}?recursive=1`)).toString()) as { truncated?: boolean; tree?: TreeEntry[] };
  if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('GitHub could not return the complete repository tree.');
  const entries = tree.tree;
  return { get, parts, repo, revision, entries, subpath, selector };
}

/** Interpret pasted installer commands as data; never execute them. Download only selected skill folders. */
export async function downloadSkills(input: string): Promise<DownloadedSkill[]> {
  const { get, parts, repo, revision, entries, subpath, selector } = await resolveTree(input);
  const roots = entries.filter(file => file.type === 'blob' && (file.path === 'SKILL.md' || file.path.endsWith('/SKILL.md')) && (!subpath || file.path.startsWith(`${subpath}/`)));
  if (roots.length > 1000) throw new Error('This repository has too many skills. Paste a skill-folder URL.');
  const skills: DownloadedSkill[] = [];
  let bytes = 0;
  const read = async (file: TreeEntry) => {
    if (!['100644', '100755'].includes(file.mode) || file.path.split('/').some(part => !part || part === '.' || part === '..' || /[\\:\0]/.test(part))) throw new Error('The skill contains an unsafe path or symbolic link.');
    if ((file.size ?? 0) > 8 * 1024 * 1024) throw new Error('A skill file exceeds the 8 MB size limit.');
    const value = await get(`https://raw.githubusercontent.com/${repo}/${revision}/${file.path.split('/').map(encodeURIComponent).join('/')}`);
    bytes += value.length;
    if (bytes > limit) throw new Error('The selected skills exceed the 32 MB size limit.');
    return { bytes: value, mode: file.mode === '100755' ? 0o700 : 0o600 };
  };
  for (const file of roots) {
    const folder = path.posix.dirname(file.path) === '.' ? '' : path.posix.dirname(file.path);
    const skillFile = await read(file);
    const { name, description } = skillMetadata(skillFile.bytes.toString('utf8'), path.posix.basename(folder || parts[1]!.replace(/\.git$/, '')));
    if (selector && name !== selector && path.posix.basename(folder) !== selector) continue;
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error(`Invalid skill name: ${name}`);
    const files = new Map([['SKILL.md', skillFile]]);
    const children = entries.filter(entry => entry.type === 'blob' && entry.path.startsWith(folder ? `${folder}/` : '') && entry.path !== file.path);
    if (children.length > 1000) throw new Error('This skill contains too many files.');
    for (let offset = 0; offset < children.length; offset += 8) await Promise.all(children.slice(offset, offset + 8).map(async child => files.set(child.path.slice(folder ? folder.length + 1 : 0), await read(child))));
    for (const license of entries.filter(entry => /^(LICENSE(?:\.[\w-]+)?|NOTICE(?:\.md)?)$/i.test(entry.path) && entry.type === 'blob')) {
      if (!files.has(license.path)) files.set(license.path, await read(license));
    }
    skills.push({ name, description, source: `https://github.com/${repo}/tree/${revision}/${folder}`, revision, files });
    if (skills.length > 200) throw new Error('This pack exceeds the 200-skill limit. Choose a skill-folder URL.');
  }
  if (!skills.length) throw new Error(selector ? `Skill not found: ${selector}` : 'No SKILL.md files found.');
  if (new Set(skills.map(skill => skill.name)).size !== skills.length) throw new Error('The repository contains duplicate skill names. Choose a skill-folder URL.');
  return skills;
}

async function boundedFetch(url: string, signal: AbortSignal): Promise<Buffer> {
  const response = await fetch(url, { signal, redirect: 'error' });
  if (!response.ok || !response.body) throw new Error(`GitHub download failed (${response.status}). Check the URL and try again.`);
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > limit) throw new Error('The skill download exceeds the 32 MB size limit.');
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel(); }
}
