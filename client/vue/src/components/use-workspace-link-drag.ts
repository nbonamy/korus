import { onScopeDispose, ref } from 'vue';
import { codexConversationLinkFromHref, type CodexConversationLink } from '@codex-app-sdk/vue';

/** Captures the raw chat href and source agent before the browser resolves relative file links. */
export function useWorkspaceLinkDrag(options: {
  browserAvailable: boolean;
  open: (agentId: string, link: CodexConversationLink) => void;
}) {
  const draggedLink = ref<{ agentId: string; link: CodexConversationLink } | null>(null);
  const clear = () => { draggedLink.value = null; };
  window.addEventListener('dragend', clear);
  window.addEventListener('drop', clear);
  window.addEventListener('blur', clear);
  onScopeDispose(() => {
    window.removeEventListener('dragend', clear);
    window.removeEventListener('drop', clear);
    window.removeEventListener('blur', clear);
  });

  function start(event: DragEvent): void {
    clear();
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    const agentId = anchor?.closest('[data-conversation-agent-id]')?.getAttribute('data-conversation-agent-id');
    const href = anchor?.getAttribute('href');
    if (!agentId || !href || !event.dataTransfer || href.startsWith('#')) return;
    const link = codexConversationLinkFromHref(href);
    if (!link || (link.kind === 'external' && (!options.browserAvailable || !/^https?:\/\//i.test(link.href)))) return;
    draggedLink.value = { agentId, link };
    event.dataTransfer.effectAllowed = 'copy';
  }

  function over(event: DragEvent): void {
    if (!draggedLink.value) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  function drop(event: DragEvent): void {
    const dragged = draggedLink.value;
    if (!dragged) return;
    event.preventDefault();
    event.stopPropagation();
    clear();
    options.open(dragged.agentId, dragged.link);
  }

  return { draggedLink, start, over, drop };
}
