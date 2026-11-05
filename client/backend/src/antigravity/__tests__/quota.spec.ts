import { describe, expect, it } from 'vitest';
import { parseQuotaMessage } from '../quota';

// Captured from the qualified ACP's `/usage` reply (personal Google sign-in).
const message = `### Session Usage
- **Session total:** data not available yet

### Quota Limits
- **Gemini Models**
  *(Models within this group: Gemini Flash, Gemini Pro)*
  - **Weekly Limit Remaining:** 97% remaining (resets Nov 12, 2026, 19:59 UTC)
- **Claude and GPT models**
  *(Models within this group: Claude Opus, Claude Sonnet, GPT-OSS)*
  - **Weekly Limit Remaining:** 100% remaining (resets Nov 12, 2026, 22:02 UTC)`;

describe('Antigravity quota message', () => {
  it('maps each model group to a labelled usage window', () => {
    expect(parseQuotaMessage(message)).toStrictEqual({
      limitId: null, limitName: null, credits: null, individualLimit: null, planType: null, rateLimitReachedType: null,
      primary: { label: 'Gemini', usedPercent: 3, windowDurationMins: 10_080, resetsAt: Date.parse('2026-11-12T19:59:00Z') / 1000 },
      secondary: { label: 'Claude and GPT', usedPercent: 0, windowDurationMins: 10_080, resetsAt: Date.parse('2026-11-12T22:02:00Z') / 1000 },
    });
  });

  it('keeps a window usable when the reset time or period is not stated', () => {
    const limits = parseQuotaMessage('### Quota Limits\n- **Gemini Models**\n  - **Limit:** 40% remaining')!;
    expect(limits.primary).toStrictEqual({ label: 'Gemini', usedPercent: 60, windowDurationMins: null, resetsAt: null });
    expect(limits.secondary).toBeNull();
  });

  it('reports nothing when the runtime has no quota to show', () => {
    for (const text of ['', '### Session Usage\n- **Session total:** 10\n\n### Quota Limits\n- Quota limits are not applicable for this authentication method.',
      '### Quota Limits\n- **Gemini Models**\n  - **Weekly Limit Remaining:** soon']) expect(parseQuotaMessage(text)).toBeNull();
  });
});
