import { describe, expect, it } from 'vitest';
import type { InteractivePlan } from '@workspace/core/interactive-plan';
import {
  interactivePlanFrame,
  planFrameAnswers,
} from '../interactive-plan-frame';
const hostile =
  '</textarea><script>parent.electron.run()</script><img src="https://attacker.test">';
const plan: InteractivePlan = {
  agentId: 'owner',
  conversationId: 'thread',
  id: 'p',
  revision: 1,
  answerVersion: 0,
  submitted: false,
  history: [],
  answers: { choices: {}, comments: { claim: hostile } },
  document: {
    title: hostile,
    sections: [
      {
        id: 'claim',
        claim: hostile,
        exhibit: { title: 'Exhibit', text: hostile },
      },
    ],
  },
};
describe('plan sandbox generation', () => {
  it('renders hostile document and user strings as text with no injected elements or handlers', () => {
    const html = interactivePlanFrame(
      plan,
      'nonce',
      {
        background: 'red;url(https://attacker.test)',
        foreground: 'black',
        primary: 'blue',
        border: 'gray',
      },
      { comment: 'Comment', proposed: 'Proposed', clear: 'Clear' },
    );
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(document.querySelectorAll('script')).toHaveLength(1);
    expect(
      document.querySelectorAll('img,a,iframe,form,[onclick]'),
    ).toHaveLength(0);
    expect(document.querySelector('h1')!.textContent).toBe(hostile);
    expect(document.querySelector('textarea')!.textContent).toBe(hostile);
    expect(document.querySelector('pre')!.textContent).toBe(hostile);
    expect(document.querySelector('style')!.textContent).not.toContain(
      'attacker.test',
    );
    expect(
      document.querySelector('meta[http-equiv]')!.getAttribute('content'),
    ).toContain("connect-src 'none'");
  });
  it('refuses a nonopaque origin and submitted revisions even from the correct frame', () => {
    const payload = {
      type: 'plan-answers',
      agentId: 'owner',
      conversationId: 'thread',
      planId: 'p',
      revision: 1,
      nonce: 'nonce',
      answers: { choices: {}, comments: { claim: 'Why?' } },
    };
    const event = new MessageEvent('message', {
      source: window,
      origin: 'https://example.test',
      data: payload,
    });
    expect(planFrameAnswers(event, window, plan, 'nonce')).toBeNull();
    expect(
      planFrameAnswers(
        new MessageEvent('message', {
          source: window,
          origin: 'null',
          data: payload,
        }),
        window,
        { ...plan, submitted: true },
        'nonce',
      ),
    ).toBeNull();
  });
});
