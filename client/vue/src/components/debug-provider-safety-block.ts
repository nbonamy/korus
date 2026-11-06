import { provide, shallowRef, type InjectionKey, type ShallowRef } from 'vue';

export const providerSafetyBlockPreviewKey: InjectionKey<ShallowRef<{ agentId: string; message: string } | null>> = Symbol('providerSafetyBlockPreview');

export function useDebugProviderSafetyBlock() {
  const preview = shallowRef<{ agentId: string; message: string } | null>(null);
  provide(providerSafetyBlockPreviewKey, preview);
  return (agentId: string) => {
    preview.value = preview.value?.agentId === agentId ? null : {
      agentId,
      message: 'This request was blocked by our safety systems. Reason: Potentially unintended activity.',
    };
  };
}
