import { mount } from '@vue/test-utils';
import { computed, nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { Agent, AgentBackend, WorkItem } from '@workspace/core/contracts';
import CockpitAgentCard from '../CockpitAgentCard.vue';
import { backendChoicesKey } from '../backend-selection';

type CockpitAgentCardProps = {
  agent: Agent;
  draggedWorkItem: WorkItem | null;
  dropTarget: boolean;
  showLastActivity?: boolean;
  responsePreview?: string;
};

describe('CockpitAgentCard', () => {
  it.each([
    ['codex', 'Codex', '.backend-icon--monochrome'],
    ['claude', 'Claude Code', 'img.backend-icon'],
  ] as const)('shows the %s icon above status only with multiple enabled backends', async (backend, label, iconSelector) => {
    const enabled = ref<AgentBackend[]>([backend]);
    const wrapper = mount(CockpitAgentCard, {
      props: { agent: { ...idleAgent(), backend }, draggedWorkItem: null, dropTarget: false },
      global: { provide: { [backendChoicesKey as symbol]: computed(() => enabled.value) } },
    });

    expect(wrapper.find('[role="img"]').exists()).toBe(false);
    enabled.value = ['codex', 'claude'];
    await nextTick();
    const backendIcon = wrapper.get(`[role="img"][aria-label="${label}"]`);
    expect(backendIcon.attributes('title')).toBe(label);
    expect(backendIcon.find(iconSelector).exists()).toBe(true);
    expect(backendIcon.element.nextElementSibling?.textContent?.trim()).toBe('Idle');

    enabled.value = [backend];
    await nextTick();
    expect(wrapper.find('[role="img"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('uses the default repository icon when no custom icon is configured', async () => {
    const wrapper = mountCard();

    expect(wrapper.find('.cockpit-view__repository-icon').exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'AgentAvatar' }).exists()).toBe(false);

    await wrapper.setProps({ repositoryIcon: '🦞' });

    expect(wrapper.find('.cockpit-view__repository-icon').exists()).toBe(false);
    expect(wrapper.getComponent({ name: 'AgentAvatar' }).props('avatar')).toBe('🦞');
  });

  it('submits prompts for idle agents and clears the draft', async () => {
    const agent = idleAgent();
    const wrapper = mountCard({ agent });

    const input = wrapper.get<HTMLInputElement>('[aria-label="Prompt Dina"]');
    await input.setValue('  inspect this  ');
    await wrapper.get('.cockpit-view__prompt').trigger('submit');

    expect(wrapper.emitted('prompt')).toStrictEqual([[{
      agentId: 'agent-dina',
      prompt: 'inspect this',
    }]]);
    expect(input.element.value).toBe('');
  });

  it('emits assignment and clear intents when an idle agent receives a dropped work item', async () => {
    const item = workItem();
    const wrapper = mountCard({
      agent: idleAgent(),
      draggedWorkItem: item,
    });

    const dragEnter = dragEvent('dragenter');
    wrapper.get('.cockpit-view__agent-card').element.dispatchEvent(dragEnter);
    wrapper.get('.cockpit-view__agent-card').element.dispatchEvent(dragEvent('drop'));

    expect(dragEnter.defaultPrevented).toBe(true);
    expect(wrapper.emitted('drop-target-enter')).toStrictEqual([['agent-dina']]);
    expect(wrapper.emitted('assign-work-item')).toStrictEqual([[{
      agentId: 'agent-dina',
      item,
    }]]);
    expect(wrapper.emitted('clear-dragged-work-item')).toStrictEqual([[]]);
  });

  it('keeps the drop target active while dragging across card children', () => {
    const wrapper = mountCard({
      agent: idleAgent(),
      draggedWorkItem: workItem(),
    });
    const card = wrapper.get('.cockpit-view__agent-card');
    const child = document.createElement('div');
    card.element.appendChild(child);
    vi.spyOn(card.element, 'getBoundingClientRect').mockReturnValue({
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      toJSON: vi.fn(),
      top: 0,
      width: 100,
      x: 0,
      y: 0,
    });

    card.element.dispatchEvent(dragEvent('dragenter'));
    card.element.dispatchEvent(dragEvent('dragleave', { relatedTarget: child }));
    card.element.dispatchEvent(dragEvent('dragleave', { clientX: 50, clientY: 50 }));

    expect(wrapper.emitted('drop-target-enter')).toStrictEqual([['agent-dina']]);
    expect(wrapper.emitted('drop-target-leave')).toBeUndefined();

    card.element.dispatchEvent(dragEvent('dragleave', { clientX: 150, clientY: 50 }));

    expect(wrapper.emitted('drop-target-leave')).toStrictEqual([['agent-dina']]);
  });

  it('emits the agent menu intent on right click without selecting the card', async () => {
    const wrapper = mountCard({ agent: idleAgent() });

    await wrapper.get('.cockpit-view__agent-card').trigger('contextmenu', {
      clientX: 24,
      clientY: 48,
    });

    expect(wrapper.emitted('open-agent-menu')).toStrictEqual([[{
      agentId: 'agent-dina',
      x: 24,
      y: 48,
    }]]);
    expect(wrapper.emitted('select')).toBeUndefined();
  });

  it('does not accept prompts or drops while the agent is busy', async () => {
    const agent = idleAgent();
    agent.status = { type: 'working' };
    const wrapper = mountCard({
      agent,
      draggedWorkItem: workItem(),
    });

    expect(wrapper.get<HTMLInputElement>('[aria-label="Prompt Dina"]').element.disabled).toBe(true);

    const dragEnter = dragEvent('dragenter');
    wrapper.get('.cockpit-view__agent-card').element.dispatchEvent(dragEnter);
    wrapper.get('.cockpit-view__agent-card').element.dispatchEvent(dragEvent('drop'));

    expect(dragEnter.defaultPrevented).toBe(false);
    expect(wrapper.emitted('assign-work-item')).toBeUndefined();
  });

  it('shows the response preview instead of activity time in recent mode', async () => {
    const agent = idleAgent();
    agent.lastActivityAt = new Date().toISOString();
    agent.updatedAt = '2020-01-01T00:00:00.000Z';
    const wrapper = mountCard({ agent, responsePreview: 'The provider cleanup is complete.' });

    expect(wrapper.text()).not.toContain('The provider cleanup is complete.');

    await wrapper.setProps({ showLastActivity: true });

    expect(wrapper.get('.cockpit-view__agent-body span').text()).toBe('The provider cleanup is complete.');
    expect(wrapper.text()).not.toContain('Active now');

    await wrapper.setProps({ responsePreview: '' });
    expect(wrapper.get('.cockpit-view__agent-body span').text()).toBe('Active now');
  });
});

function mountCard(props: Partial<CockpitAgentCardProps> = {}) {
  return mount(CockpitAgentCard, {
    props: {
      agent: idleAgent(),
      draggedWorkItem: null,
      dropTarget: false,
      ...props,
    },
  });
}

function idleAgent(): Agent {
  const agent = { ...createInitialSnapshot().agents[0] };
  agent.status = { type: 'idle' };
  return agent;
}

function workItem(): WorkItem {
  return {
    provider: 'github',
    id: 'nbonamy/agent-workspace#12',
    sourceId: 'nbonamy/agent-workspace',
    sourceName: 'nbonamy/agent-workspace',
    number: 12,
    title: 'Fix cockpit drag target',
    url: 'https://github.com/nbonamy/agent-workspace/issues/12',
    state: 'open',
    authorName: 'nbonamy',
    body: 'Make issue assignment feel obvious.',
    labels: [],
    createdAt: '2026-06-09T12:00:00.000Z',
    updatedAt: '2026-06-09T12:30:00.000Z',
  };
}

type DragEventOptions = {
  clientX?: number;
  clientY?: number;
  relatedTarget?: EventTarget | null;
};

function dragEvent(type: string, options: DragEventOptions = {}): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      dropEffect: 'copy',
    },
  });
  if ('clientX' in options) {
    Object.defineProperty(event, 'clientX', {
      value: options.clientX,
    });
  }
  if ('clientY' in options) {
    Object.defineProperty(event, 'clientY', {
      value: options.clientY,
    });
  }
  if ('relatedTarget' in options) {
    Object.defineProperty(event, 'relatedTarget', {
      value: options.relatedTarget,
    });
  }
  return event;
}
