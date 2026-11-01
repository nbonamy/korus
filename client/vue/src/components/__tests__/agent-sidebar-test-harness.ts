import { product } from '@workspace/core/product';
import { flushPromises } from '@vue/test-utils';
import { afterEach, expect, vi } from 'vitest';
import type { Agent, Team } from '@workspace/core/contracts';

export function pointerEvent(type: string, clientX: number): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event as PointerEvent;
}

export function dragEvent(type: string, clientY: number): DragEvent {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  }) as DragEvent;
  const dataTransfer = {
    dropEffect: '',
    effectAllowed: '',
    setData: vi.fn(),
  };

  Object.defineProperty(event, 'clientY', { value: clientY });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event;
}

export function mockRect(element: Element, rect: { top: number; height: number }): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    top: rect.top,
    bottom: rect.top + rect.height,
    height: rect.height,
    left: 0,
    right: 280,
    width: 280,
    x: 0,
    y: rect.top,
    toJSON: () => undefined,
  });
}

export function portaledMenuItems(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('.agent-context-menu [role="menuitem"]'));
}

export async function clickPortaledMenuItem(label: string): Promise<void> {
  const item = portaledMenuItems().find((candidate) => candidate.textContent?.trim() === label);
  expect(item).toBeDefined();
  item!.click();
  await flushPromises();
}

export const agents: Agent[] = [
  {
    id: 'agent-dina',
    name: 'Dina',
    avatar: 'DI',
    folder: '~/src/id8',
    workspace: {
      kind: 'git',
      folder: '~/src/id8',
      repositoryName: 'id8',
      repositoryRoot: '~/src/id8',
      branch: 'main',
      isLinkedWorktree: false,
      primaryWorktreeRoot: '~/src/id8',
      originUrl: 'git@github.com:nbonamy/id8.git',
      updatedAt: '2026-06-05T00:00:00.000Z',
    },
    backend: 'codex',
    backendDefaults: { kind: 'codex' },
    status: { type: 'idle' },
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:00:00.000Z',
  },
  {
    id: 'agent-jesse',
    name: 'Jesse',
    folder: '~/src/multi-llm-ts',
    workspace: {
      kind: 'git',
      folder: '~/src/multi-llm-ts',
      repositoryName: 'multi-llm-ts',
      repositoryRoot: '~/src/multi-llm-ts',
      branch: 'feat/testing',
      isLinkedWorktree: false,
      primaryWorktreeRoot: '~/src/multi-llm-ts',
      updatedAt: '2026-06-05T00:00:00.000Z',
    },
    backend: 'codex',
    backendDefaults: { kind: 'codex' },
    status: { type: 'working', detail: 'Testing' },
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:00:00.000Z',
  },
];

export const teams: Team[] = [
  {
    id: 'team-app',
    name: `${product.name}`,
    avatar: 'CC',
    color: '#1B4FB2',
    agentIds: ['agent-dina', 'agent-jesse'],
  },
  {
    id: 'team-skwad',
    name: 'Skwad',
    avatar: 'SK',
    color: '#46A857',
    agentIds: [],
  },
];

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = '';
});
