import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Replaces an installed package's files with the contents of an `npm pack` tarball. */
export function installPacked(tarball, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', destination, '--strip-components=1']);
}

/** Every installed copy of an SDK package: the hoisted one and any a workspace nested under its own node_modules. */
export function installedCopies(projectRoot, packageName, workspaces) {
  return ['.', ...workspaces]
    .map(workspace => path.join(projectRoot, workspace, 'node_modules', packageName))
    .filter(copy => fs.existsSync(path.join(copy, 'package.json')));
}

/** `name@range` for each dependency of a packed SDK that the project has not installed, such as one added since its release. */
export function missingDependencies(projectRoot, dependencies = {}) {
  return Object.entries(dependencies)
    .filter(([name]) => !name.startsWith('@korus-dev/') && !fs.existsSync(path.join(projectRoot, 'node_modules', name, 'package.json')))
    .map(([name, range]) => `${name}@${range}`);
}
