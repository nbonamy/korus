import { createEntityId } from '@workspace/core/ids';
import { designNodes, type DesignContent } from '@workspace/core/design';
import { designTweakCss, type DesignTweakEdit } from '@workspace/core/design-tweaks';

export function applyTweakEdit(content: DesignContent, edit: DesignTweakEdit): void {
  const tweaks = content.tweaks ??= [];
  if (edit.type === 'tweak-set') {
    const index = tweaks.findIndex(tweak => tweak.id === edit.tweak.id);
    if (index < 0) tweaks.push(structuredClone(edit.tweak));
    else tweaks[index] = structuredClone(edit.tweak);
    return;
  }
  const index = tweaks.findIndex(tweak => tweak.id === edit.tweakId);
  if (index < 0) throw new Error('Design tweak not found.');
  if (edit.type === 'tweak-remove') { tweaks.splice(index, 1); return; }
  const tweak = tweaks[index];
  const node = designNodes(content).find(item => item.id === tweak.nodeId);
  if (!node) throw new Error('Design tweak target not found.');
  node.styles = { ...node.styles, [tweak.property]: designTweakCss(tweak, edit.value) };
}

export function copyTweaks(content: DesignContent, ids: Map<string, string>): void {
  if (!content.tweaks) return;
  const copies = content.tweaks.filter(tweak => ids.has(tweak.nodeId)).map(tweak => ({ ...structuredClone(tweak), id: createEntityId('tweak'), nodeId: ids.get(tweak.nodeId)! }));
  content.tweaks.push(...copies);
}

export function removeTweaks(content: DesignContent, ids: Set<string>): void {
  if (content.tweaks) content.tweaks = content.tweaks.filter(tweak => !ids.has(tweak.nodeId));
}
