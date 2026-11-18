import { ElMessageBox, type ElMessageBoxOptions } from 'element-plus';

/** Generated toolkit buttons opt into the same interaction primitive as authored controls. */
function withButtons(options: ElMessageBoxOptions = {}): ElMessageBoxOptions {
  const destructive = options.confirmButtonType === 'danger' || /danger|destructive/.test(options.confirmButtonClass ?? '');
  return {
    ...options,
    customClass: ['app-message-box agent-ui-scope', options.customClass].filter(Boolean).join(' '),
    confirmButtonClass: ['agent-ui-interactive', `agent-ui-interactive--${destructive ? 'destructive' : 'primary'}`,
      'agent-ui-interactive--solid', options.confirmButtonClass].filter(Boolean).join(' '),
    cancelButtonClass: ['agent-ui-interactive', options.cancelButtonClass].filter(Boolean).join(' '),
  };
}

function shortcut(method: 'confirm' | 'alert' | 'prompt'): typeof ElMessageBox.confirm {
  return ((...args: unknown[]) => {
    const optionsIndex = typeof args[1] === 'string' || args.length >= 3 && args[1] === undefined ? 2 : 1;
    args[optionsIndex] = withButtons(args[optionsIndex] as ElMessageBoxOptions | undefined);
    return Reflect.apply(ElMessageBox[method], ElMessageBox, args);
  }) as typeof ElMessageBox.confirm;
}

export const appMessageBox = {
  confirm: shortcut('confirm'),
  alert: shortcut('alert'),
  prompt: shortcut('prompt'),
  close: () => ElMessageBox.close(),
};
