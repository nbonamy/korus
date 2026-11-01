import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MissionTicket } from '@workspace/core/missions';
import MissionTicketBoard from '../MissionTicketBoard.vue';

const tickets: MissionTicket[] = [
  {
    id: 'mission-ticket-foundation',
    title: 'Create the billing account',
    body: 'Introduce the account model and cover its persistence behavior.',
    repositoryPath: '/Users/nicolas/src/billing-service',
    done: false,
  },
  {
    id: 'mission-ticket-checkout',
    title: 'Add owner checkout',
    body: '## What to build\n\nLet a team owner purchase seats.\n\n## Acceptance criteria\n\n- Payment succeeds',
    repositoryPath: '/Users/nicolas/src/checkout-app',
    done: false,
    dependsOn: [0],
    reference: 'https://example.com/tickets/BILL-2',
  },
];

describe('MissionTicketBoard', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps a streaming backlog scannable and opens the full selected ticket', async () => {
    const wrapper = mountBoard({ tickets });
    const cards = wrapper.findAll('.mission-ticket-board__card');

    expect(cards).toHaveLength(2);
    expect(cards[0]!.text()).toContain('01');
    expect(cards[0]!.text()).toContain('Create the billing account');
    expect(cards[0]!.text()).toContain('billing-service');
    expect(cards[1]!.text()).toContain('After 01');
    expect(wrapper.find('[aria-label="Ticket details"]').exists()).toBe(false);

    await cards[1]!.trigger('click');
    await flushPromises();

    expect(cards[1]!.attributes('aria-expanded')).toBe('true');
    const dialog = getDocumentElement<HTMLElement>('.mission-ticket-dialog');
    const details = getDocumentElement<HTMLElement>('[aria-label="Ticket details"]');
    expect(dialog.querySelector('.mission-ticket-dialog__header')?.textContent).toContain('Add owner checkout');
    expect(details.textContent).toContain('What to build');
    expect(details.textContent).toContain('Payment succeeds');
    expect(details.textContent).toContain('Blocked by tickets: 01');
    expect(details.textContent).toContain('Repository: /Users/nicolas/src/checkout-app');
    expect(details.querySelector('a')?.getAttribute('href')).toBe('https://example.com/tickets/BILL-2');

    getDocumentElement<HTMLButtonElement>('[aria-label="Close ticket details"]').click();
    await flushPromises();

    expect(document.querySelector('[aria-label="Ticket details"]')).toBeNull();
    expect(document.activeElement).toBe(cards[1]!.element);
    wrapper.unmount();
  });

  it('adds newly created tickets without replacing cards already on the board', async () => {
    const wrapper = mountBoard({ tickets: tickets.slice(0, 1) });
    const firstCard = wrapper.get('.mission-ticket-board__card').element;

    await wrapper.setProps({ tickets });

    const cards = wrapper.findAll('.mission-ticket-board__card');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.element).toBe(firstCard);
    expect(cards[1]!.text()).toContain('Add owner checkout');
    wrapper.unmount();
  });

  it('uses the build section as the compact preview without repeating its heading', () => {
    const wrapper = mountBoard({ tickets: [{
      title: 'Connect Linear',
      body: '**What to build** Add a read-only connection.\n\n**Acceptance criteria** The user can disconnect it.',
      done: false,
    }] });

    const preview = wrapper.get('.mission-ticket-board__preview');
    expect(preview.text()).toBe('Add a read-only connection.');
    wrapper.unmount();
  });

  it('keeps annotations across ticket dialogs and sends them together', async () => {
    const wrapper = mountBoard({ tickets, annotatable: true });
    const cards = wrapper.findAll('.mission-ticket-board__card');

    await cards[0]!.trigger('click');
    await flushPromises();
    await annotateSelectedTicket('account model', 'Call out the migration path.');
    expect(cards[0]!.text()).toContain('1 comment');

    getDocumentElement<HTMLButtonElement>('[aria-label="Close ticket details"]').click();
    await flushPromises();
    await cards[1]!.trigger('click');
    await flushPromises();
    await annotateSelectedTicket('Payment succeeds', 'Define the failure behavior.');

    expect(wrapper.get('.mission-ticket-board__review-bar').text()).toContain('2 comments across 2 tickets');
    getDocumentElement<HTMLButtonElement>('[aria-label="Send 2 ticket comments"]').click();

    expect(wrapper.emitted('sendComments')).toStrictEqual([[[
      expect.objectContaining({ ticketNumber: '01', ticketTitle: 'Create the billing account', quote: 'account model', body: 'Call out the migration path.' }),
      expect.objectContaining({ ticketNumber: '02', ticketTitle: 'Add owner checkout', quote: 'Payment succeeds', body: 'Define the failure behavior.' }),
    ]]]);
    wrapper.unmount();
  });
});

function mountBoard(props: InstanceType<typeof MissionTicketBoard>['$props']) {
  return mount(MissionTicketBoard, {
    props,
    attachTo: document.body,
  });
}

function getDocumentElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing document element: ${selector}`);
  return element;
}

async function annotateSelectedTicket(quote: string, body: string): Promise<void> {
  const markdown = getDocumentElement<HTMLElement>('.mission-ticket-dialog .markdown-panel');
  vi.spyOn(window, 'getSelection').mockReturnValue({
    rangeCount: 1,
    toString: () => quote,
    getRangeAt: () => ({
      commonAncestorContainer: markdown,
      getBoundingClientRect: () => ({ left: 120, top: 180, width: 120, height: 20 } as DOMRect),
    } as unknown as Range),
    removeAllRanges: vi.fn(),
  } as unknown as Selection);
  getDocumentElement<HTMLElement>('.mission-ticket-dialog__document').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  await flushPromises();
  const input = getDocumentElement<HTMLInputElement>('.annotation-popup__input');
  input.value = body;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  getDocumentElement<HTMLFormElement>('form.annotation-popup').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flushPromises();
}
