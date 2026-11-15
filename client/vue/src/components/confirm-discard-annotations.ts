import { ElMessageBox } from 'element-plus';

/** Annotations only travel with Revise; approving drops them, so the user confirms first. */
export async function confirmDiscardAnnotations(count: number, t: (key: string, named?: Record<string, unknown>, plural?: number) => string): Promise<boolean> {
  try {
    await ElMessageBox.confirm(t('planFeedback.discardMessage', { count }, count), t('planFeedback.discardTitle'), {
      confirmButtonText: t('planFeedback.approveAnyway'), cancelButtonText: t('planFeedback.goBack'), type: 'warning',
    });
    return true;
  } catch { return false; }
}
