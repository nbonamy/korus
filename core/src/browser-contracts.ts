import type { BrowserAnnotation as OwnerAnnotation } from 'ai-app-sdk/browser/contracts';
import type { BrowserViewportRequest as OwnerViewportRequest } from 'ai-app-sdk/browser/viewport';
export type { BrowserBounds, BrowserViewportBounds, BrowserState } from 'ai-app-sdk/browser/contracts';

/** Product wire identities remain compatible with released clients. */
export type BrowserAnnotation = Omit<OwnerAnnotation, 'ownerId'> & { agentId: string };
export type BrowserViewportRequest = Omit<OwnerViewportRequest, 'ownerId'> & { agentId: string };

export function annotationFromBrowserOwner({ ownerId, ...annotation }: OwnerAnnotation): BrowserAnnotation {
  return { ...annotation, agentId: ownerId };
}
export function annotationToBrowserOwner({ agentId, ...annotation }: BrowserAnnotation): OwnerAnnotation {
  return { ...annotation, ownerId: agentId };
}
export function viewportFromBrowserOwner({ ownerId, ...request }: OwnerViewportRequest): BrowserViewportRequest {
  return { ...request, agentId: ownerId };
}
export function viewportToBrowserOwner({ agentId, ...request }: BrowserViewportRequest): OwnerViewportRequest {
  return { ...request, ownerId: agentId };
}
