import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@workspace/core/app-error';
import type { SourceRepository } from '@workspace/core/contracts';
import { resolveSourceFolderPath } from './source-repositories';

export async function createSourceRepository(
  sourceFolderPath: string,
  name: string,
): Promise<SourceRepository> {
  const configuredSourceRoot = sourceFolderPath.trim();
  const repositoryName = requireRepositoryName(name);
  if (!configuredSourceRoot) throw new AppError('createRepository.sourceFolderMissing', 'Source folder is not configured.');

  const sourceRoot = resolveSourceFolderPath(configuredSourceRoot);
  const destinationPath = path.join(sourceRoot, repositoryName);
  await mkdir(sourceRoot, { recursive: true });
  if (await pathExists(destinationPath)) {
    throw new AppError('createRepository.alreadyExists', `${repositoryName} already exists in the source folder.`, { repository: repositoryName });
  }

  await mkdir(destinationPath);
  return { name: repositoryName, path: destinationPath, worktrees: [] };
}

export function requireRepositoryName(value: string): string {
  const name = value.trim();
  if (!name) throw new AppError('createRepository.nameRequired', 'Project name is required.');
  if (name === '.' || name === '..' || /[/\\]/u.test(name)) {
    throw new AppError('createRepository.invalidName', 'Project name must be a single folder name.');
  }
  return name;
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await stat(value);
    return true;
  } catch {
    return false;
  }
}
