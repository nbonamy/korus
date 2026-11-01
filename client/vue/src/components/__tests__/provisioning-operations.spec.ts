import { describe, expect, it, vi } from 'vitest';
import {
  activeProvisioningOperation,
  backgroundProvisioningOperation,
  closeProvisioningOperation,
  isProvisioningBackgrounded,
  publishProvisioningOperation,
} from '../provisioning-operations';

const progress = (id: string, state: 'running' | 'success' | 'error' = 'running') => ({
  id, state, backend: 'codex' as const, repositoryName: 'korus', createWorktree: true, hasPrompt: true,
});

describe('provisioning operations', () => {
  it('shows one operation at a time and routes close to the source that published it', () => {
    const onClose = vi.fn();
    publishProvisioningOperation('a', { mode: 'single', progress: progress('a-1') }, { onClose });
    publishProvisioningOperation('b', { mode: 'single', progress: progress('b-1') });
    expect(activeProvisioningOperation.value).toMatchObject({ progress: { id: 'a-1' } });
    closeProvisioningOperation('a-1');
    expect(onClose).toHaveBeenCalledWith('a-1');
    publishProvisioningOperation('a', null);
    expect(activeProvisioningOperation.value).toMatchObject({ progress: { id: 'b-1' } });
  });

  it('hides a backgrounded operation until it fails, and forgets it once it is gone', () => {
    const onBackground = vi.fn();
    publishProvisioningOperation('a', { mode: 'single', progress: progress('a-1') }, { onBackground });
    backgroundProvisioningOperation('a-1');
    expect(onBackground).toHaveBeenCalledWith('a-1');
    expect(isProvisioningBackgrounded('a-1')).toBe(true);
    expect(activeProvisioningOperation.value).toBeNull();

    publishProvisioningOperation('a', { mode: 'single', progress: progress('a-1', 'success') });
    expect(activeProvisioningOperation.value).toBeNull();
    publishProvisioningOperation('a', { mode: 'single', progress: progress('a-1', 'error') });
    expect(activeProvisioningOperation.value).toMatchObject({ progress: { state: 'error' } });

    publishProvisioningOperation('a', null);
    expect(isProvisioningBackgrounded('a-1')).toBe(false);
  });

  it('keeps a batch hidden only while every entry in it was backgrounded', () => {
    publishProvisioningOperation('delegated', { mode: 'batch', progress: [progress('x'), progress('y')] });
    backgroundProvisioningOperation('x');
    expect(activeProvisioningOperation.value).not.toBeNull();
    backgroundProvisioningOperation('y');
    expect(activeProvisioningOperation.value).toBeNull();
    publishProvisioningOperation('delegated', { mode: 'batch', progress: [progress('x'), progress('y'), progress('z')] });
    expect(activeProvisioningOperation.value).not.toBeNull();
  });
});
