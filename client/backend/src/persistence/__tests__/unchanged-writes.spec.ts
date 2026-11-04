import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnchangedWrites } from '../unchanged-writes';

let directory: string;
let files: UnchangedWrites;
beforeEach(async () => { files = new UnchangedWrites(); directory = await mkdtemp(path.join(os.tmpdir(), 'unchanged-writes-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const file = () => path.join(directory, 'state.json');
const write = () => vi.fn(async (target: string, content: string) => writeFile(target, content));

describe('UnchangedWrites', () => {
  it('writes the first time and skips identical content afterwards', async () => {
    const writer = write();
    expect(await files.writeIfChanged(file(), 'a', writer)).toBe(true);
    expect(await files.writeIfChanged(file(), 'a', writer)).toBe(false);
    expect(await files.writeIfChanged(file(), 'b', writer)).toBe(true);
    expect(await files.writeIfChanged(file(), 'b', writer)).toBe(false);
    expect(writer).toHaveBeenCalledTimes(2);
    expect(await readFile(file(), 'utf8')).toBe('b');
  });
  it('skips content that was just loaded from disk', async () => {
    const writer = write();
    files.remember(file(), 'loaded');
    expect(await files.writeIfChanged(file(), 'loaded', writer)).toBe(false);
    expect(writer).not.toHaveBeenCalled();
  });
  it('writes again when a write failed, instead of trusting content that never reached the disk', async () => {
    const failing = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    await expect(files.writeIfChanged(file(), 'a', failing)).rejects.toThrow('disk full');
    expect(await files.writeIfChanged(file(), 'a', failing)).toBe(true);
    expect(failing).toHaveBeenCalledTimes(2);
  });
  it('writes after the file was forgotten, for files deleted or replaced outside the app', async () => {
    const writer = write();
    await files.writeIfChanged(file(), 'a', writer);
    files.forget(file());
    expect(await files.writeIfChanged(file(), 'a', writer)).toBe(true);
  });
  it('does not carry memory from one owner to another, so a fresh store rewrites files deleted behind its back', async () => {
    const writer = write();
    await files.writeIfChanged(file(), 'a', writer);
    expect(await new UnchangedWrites().writeIfChanged(file(), 'a', writer)).toBe(true);
  });
  it('keeps files independent', async () => {
    const writer = write();
    await files.writeIfChanged(path.join(directory, 'one.json'), 'same', writer);
    expect(await files.writeIfChanged(path.join(directory, 'two.json'), 'same', writer)).toBe(true);
  });
});
