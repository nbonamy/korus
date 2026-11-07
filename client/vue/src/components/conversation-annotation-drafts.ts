import { hasInjectionContext, inject, provide, type InjectionKey } from 'vue';

// A conversation can move between panes or be temporarily unmounted. Keep its
// unsent annotations for the lifetime of the workspace, shared by all pane hosts.
const annotationDraftsKey: InjectionKey<Map<string, unknown>> = Symbol('conversation-annotation-drafts');
export function provideConversationAnnotationDrafts(): void {
  provide(annotationDraftsKey, new Map());
}
export function conversationAnnotationDrafts<T>(kind: string, create: () => T): T {
  const drafts = hasInjectionContext() ? inject(annotationDraftsKey, null) : null;
  if (!drafts) return create();
  if (!drafts.has(kind)) drafts.set(kind, create());
  return drafts.get(kind) as T;
}
