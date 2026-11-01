import { flushPromises, mount } from '@vue/test-utils';
import { expect, it, vi } from 'vitest';
import LocalClaudeAuthenticationDialog from '../LocalClaudeAuthenticationDialog.vue';

it('copies each displayed login command and reports clipboard failures', async () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    const wrapper = mount(LocalClaudeAuthenticationDialog, {
      props: { modelValue: true, configDirectory: '/app/claude-home', loading: false, error: null },
      global: { stubs: { teleport: true } },
    });
    await flushPromises();
    const rows = wrapper.findAll('.claude-login-command');
    for (const row of rows) {
      await row.get('button').trigger('click');
      await flushPromises();
      expect(writeText).toHaveBeenLastCalledWith(row.get('code').text());
      expect(row.get('button').attributes('aria-label')).toContain('copied');
    }
    writeText.mockRejectedValueOnce(new Error('Clipboard denied'));
    await rows[0]!.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('copy');
    expect(rows[0]!.get('button').attributes('aria-label')).toContain('Copy');
  } finally {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});


it('copies a quoted bundled executable path when no CLI is installed', async () => {
  const wrapper = mount(LocalClaudeAuthenticationDialog, {
    props: { modelValue: true, configDirectory: null, executablePath: "/Applications/Korus Beta's.app/Contents/Resources/claude/claude", loading: false, error: null },
    global: { stubs: { teleport: true } },
  });
  await flushPromises();
  expect(wrapper.findAll('code').map(row => row.text())).toStrictEqual([
    "env -u CLAUDE_CONFIG_DIR '/Applications/Korus Beta'\\''s.app/Contents/Resources/claude/claude' auth login --claudeai",
    "env -u CLAUDE_CONFIG_DIR '/Applications/Korus Beta'\\''s.app/Contents/Resources/claude/claude' auth login --console",
  ]);
  wrapper.unmount();
});
